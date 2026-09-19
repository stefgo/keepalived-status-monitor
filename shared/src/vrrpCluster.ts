import { ipNetwork, networkContains, networksOverlap } from "./network.js";
import type {
    KeepalivedState,
    VrrpCluster,
    VrrpClusterHealth,
    VrrpClusterMember,
    VrrpInstance,
} from "./types.js";

/** `192.168.1.100/24` and `192.168.1.100` are the same address on two differently written configs. */
export function stripPrefix(address: string): string {
    return address.replace(/\/\d+$/, "");
}

/**
 * The networks an instance's virtual addresses sit on, deduplicated. This is what identifies
 * the virtual router: a VRID is unique per broadcast domain, and the network is that domain.
 * The interface name would say the same thing, but it is a local label -- `eth0` on one host
 * and `ens18` on the next may well be one segment.
 *
 * An address written without a prefix yields a host route (`/32`), which only ever matches
 * itself. keepalived hands out no other information about the segment, so such a config is
 * grouped by its exact addresses, as it was before.
 */
export function instanceNetworks(instance: VrrpInstance): string[] {
    const networks = (instance.vips ?? []).map(ipNetwork).filter((net): net is string => net !== null);
    return [...new Set(networks)].sort();
}

/**
 * Which hosts of a cluster do not carry its full set of addresses, and which ones they are
 * missing. keepalived never compares the address lists of a virtual router with its peers, so
 * a host with a short list serves a short list the moment it becomes MASTER -- the addresses
 * named here are the ones that would go down.
 *
 * Counted over every member, online or not: this is a statement about the configuration, not
 * about the present state. A host that is offline with the wrong list is wrong the moment it
 * comes back.
 */
export function mismatchedVips(members: VrrpClusterMember[]): { member: VrrpClusterMember; missing: string[] }[] {
    const served = new Map<string, string>();
    for (const member of members) {
        for (const vip of member.instance.vips ?? []) {
            const bare = stripPrefix(vip);
            // The written form with a prefix is the more informative of the two.
            if (!served.has(bare) || vip.includes("/")) served.set(bare, vip);
        }
    }

    return members
        .map((member) => {
            const own = new Set((member.instance.vips ?? []).map(stripPrefix));
            const missing = [...served].filter(([bare]) => !own.has(bare)).map(([, written]) => written);
            return { member, missing };
        })
        .filter((entry) => entry.missing.length > 0);
}

/** The states a VIP mismatch replaces; the two outages above it stay as they are. */
const OVERRULED_BY_MISMATCH: ReadonlySet<VrrpClusterHealth> = new Set<VrrpClusterHealth>([
    "ok",
    "degraded",
    "unknown",
]);

/**
 * How a cluster is doing. The states are counted over online members only -- an offline
 * member's state is its last report, not its present one -- with the address mismatch as the
 * documented exception, since a configuration is wrong whether or not its host answers.
 *
 * A running outage outranks a misconfiguration: `split-brain` and `no-master` keep their
 * place, and the cluster's page names the mismatch either way.
 */
function healthOf(members: VrrpClusterMember[]): VrrpClusterHealth {
    const base = ((): VrrpClusterHealth => {
        const online = members.filter((member) => member.online);
        if (online.length === 0) return "unknown";
        const masters = online.filter((member) => member.instance.state === "MASTER").length;
        if (masters > 1) return "split-brain";
        if (masters === 0) return "no-master";
        const troubled =
            online.length < members.length ||
            online.some((member) => member.instance.state === "FAULT") ||
            members.length < 2;
        return troubled ? "degraded" : "ok";
    })();

    return OVERRULED_BY_MISMATCH.has(base) && mismatchedVips(members).length > 0 ? "vip-mismatch" : base;
}

/** One cluster while it is still being assembled, before it has a key and a health. */
interface Group {
    networks: string[];
    /**
     * The instance name a cluster of address-less instances is held together by, which is
     * what keepalived.conf files of one cluster usually share. Such a group never gains a
     * network, so the two ways of grouping never meet.
     */
    fallback: string | null;
    vips: string[];
    members: VrrpClusterMember[];
}

/** Whether an instance belongs to a group: a shared segment, or the same name where none. */
function belongsTo(group: Group, networks: string[], instance: VrrpInstance): boolean {
    return networks.length > 0
        ? group.networks.some((theirs) => networks.some((ours) => networksOverlap(theirs, ours)))
        : group.fallback === instance.name;
}

/**
 * Groups the instances of every host into clusters, by site, VRID and the network their
 * virtual addresses sit on. Pure, so the server's endpoint and the dashboard -- which
 * recomputes on every status change -- cannot come to different answers. Ordered with the
 * clusters that need attention first. `siteOf` names the site of a client, or null when it
 * has none.
 *
 * The site comes first because a VRID and a private network say nothing on their own: two
 * sites may run the very same pair of numbers. Every member of a cluster needs the same site,
 * so a host whose client has none, or another one, forms a cluster of its own.
 *
 * The addresses themselves are deliberately *not* part of the identity. They are what this
 * tool watches, and a cluster whose identity changed whenever its addresses did could never
 * report that its hosts disagree about them -- the hosts would simply have become two
 * clusters. See `mismatchedVips`.
 */
export function buildVrrpClusters(
    states: KeepalivedState[],
    onlineClientIds: Iterable<string>,
    siteOf: (clientId: string) => string | null,
): VrrpCluster[] {
    const online = new Set(onlineClientIds);
    // Site and VRID alone; the segments within one bucket are sorted out below.
    const buckets = new Map<string, { site: string | null; vrid: number | null; groups: Group[] }>();

    for (const state of states) {
        const site = siteOf(state.clientId);
        for (const instance of state.instances ?? []) {
            const vrid = instance.vrid ?? null;
            const bucketKey = `${site ?? ""}|${vrid ?? "?"}`;
            let bucket = buckets.get(bucketKey);
            if (!bucket) {
                bucket = { site, vrid, groups: [] };
                buckets.set(bucketKey, bucket);
            }

            const networks = instanceNetworks(instance);
            const member: VrrpClusterMember = {
                clientId: state.clientId,
                online: online.has(state.clientId),
                instance,
            };

            // Several groups may match at once, where this instance is the first to carry
            // addresses from two segments: it joins them into one.
            const matching = bucket.groups.filter((group) => belongsTo(group, networks, instance));
            if (matching.length === 0) {
                bucket.groups.push({
                    networks,
                    fallback: networks.length > 0 ? null : instance.name,
                    vips: [...(instance.vips ?? [])],
                    members: [member],
                });
                continue;
            }

            const [target, ...merged] = matching;
            for (const group of merged) {
                target.networks.push(...group.networks);
                target.vips.push(...group.vips);
                target.members.push(...group.members);
            }
            bucket.groups = bucket.groups.filter((group) => !merged.includes(group));

            target.networks = [...new Set([...target.networks, ...networks])].sort();
            target.vips.push(...(instance.vips ?? []));
            target.members.push(member);
        }
    }

    const rank: Record<VrrpClusterHealth, number> = {
        "split-brain": 0,
        "no-master": 1,
        "vip-mismatch": 2,
        degraded: 3,
        unknown: 4,
        ok: 5,
    };

    return [...buckets.values()]
        .flatMap(({ site, vrid, groups }) =>
            groups.map((group): VrrpCluster => {
                const networks = broadestNetworks(group.networks);
                // The first network tells the segments of one site and VRID apart; within a
                // bucket it is unique, since two groups sharing one would have been merged.
                const discriminator = networks[0] ?? `name:${group.fallback}`;
                return {
                    key: `${site ?? ""}|${vrid ?? "?"}|${discriminator}`,
                    site,
                    vrid,
                    networks,
                    vips: unionOfVips(group.vips),
                    members: group.members,
                    health: healthOf(group.members),
                };
            }),
        )
        .sort(
            (a, b) =>
                rank[a.health] - rank[b.health] ||
                (a.vrid ?? 0) - (b.vrid ?? 0) ||
                (a.site ?? "").localeCompare(b.site ?? ""),
        );
}

/**
 * The segment as few networks as describe it. Where one host wrote `172.28.0.100/24` and the
 * next the bare address, the group carries both `172.28.0.0/24` and `172.28.0.100/32` -- the
 * second says nothing the first does not, and naming it would suggest a second segment.
 */
function broadestNetworks(networks: string[]): string[] {
    const distinct = [...new Set(networks)].sort();
    return distinct.filter(
        (network) => !distinct.some((other) => other !== network && networkContains(other, network)),
    );
}

/** Every address the cluster's hosts carry between them, once each and written with a prefix
 *  where any host wrote one. */
function unionOfVips(vips: string[]): string[] {
    const written = new Map<string, string>();
    for (const vip of vips) {
        const bare = stripPrefix(vip);
        if (!written.has(bare) || vip.includes("/")) written.set(bare, vip);
    }
    return [...written.values()].sort();
}
