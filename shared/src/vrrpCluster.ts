import { ipNetwork, networkContains, networksOverlap } from "./network.js";
import type {
    KeepalivedState,
    VrrpCluster,
    VrrpClusterHealth,
    VrrpClusterMember,
    VrrpIncidentHealth,
    VrrpIncidentReason,
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
 * How a cluster is doing. The states are counted over live members only -- online, with
 * keepalived reporting; any other member's state is its last report, not its present one --
 * with the address mismatch as the documented exception, since a configuration is wrong
 * whether or not its host answers.
 *
 * A running outage outranks a misconfiguration: `split-brain` and `no-master` keep their
 * place, and the cluster's page names the mismatch either way.
 */
function healthOf(members: VrrpClusterMember[]): VrrpClusterHealth {
    const base = ((): VrrpClusterHealth => {
        const live = members.filter((member) => member.online && member.reporting);
        if (live.length === 0) return "unknown";
        const masters = live.filter((member) => member.instance.state === "MASTER").length;
        if (masters > 1) return "split-brain";
        if (masters === 0) return "no-master";
        const troubled =
            live.length < members.length ||
            live.some((member) => member.instance.state === "FAULT") ||
            members.length < 2;
        return troubled ? "degraded" : "ok";
    })();

    return OVERRULED_BY_MISMATCH.has(base) && mismatchedVips(members).length > 0 ? "vip-mismatch" : base;
}

/**
 * Who holds a cluster, counted like `healthOf`: over live members only. `single` has exactly
 * one MASTER, `unknown` has no live member. Unlike the health it ignores the addresses, since
 * it says who serves them rather than whether they agree.
 */
export type VrrpClusterCondition = "single" | "split-brain" | "no-master" | "unknown";

export function clusterCondition(cluster: VrrpCluster): {
    condition: VrrpClusterCondition;
    live: VrrpClusterMember[];
    masters: VrrpClusterMember[];
    /**
     * Members whose agent is offline and whose last report was MASTER. Nobody can tell
     * whether they still are: keepalived goes on serving while its agent is away.
     */
    unseenMasters: VrrpClusterMember[];
} {
    const live = cluster.members.filter((member) => member.online && member.reporting);
    const masters = live.filter((member) => member.instance.state === "MASTER");
    const unseenMasters = cluster.members.filter(
        (member) => !member.online && member.instance.state === "MASTER",
    );
    const condition: VrrpClusterCondition =
        live.length === 0
            ? "unknown"
            : masters.length === 1
              ? "single"
              : masters.length > 1
                ? "split-brain"
                : "no-master";
    return { condition, live, masters, unseenMasters };
}

/** The health of a cluster as its incidents see it, and every finding behind it. */
export interface VrrpIncidentState {
    health: VrrpIncidentHealth;
    /** Empty for `ok`. */
    reasons: VrrpIncidentReason[];
}

/**
 * How a cluster is doing as its incidents see it. `null` when nothing can be said.
 *
 * Unlike `healthOf`, a member whose agent is offline does not count at all: an agent going
 * away says nothing about VRRP, whose keepalived goes on running without it. Its last report
 * is neither a finding nor evidence -- not its roles, not its addresses. Only when no agent
 * of the cluster is connected is the cluster itself out of sight, which is `unreachable`.
 *
 * - No live MASTER while an offline member last reported MASTER is `null`: that host may well
 *   go on serving, and there is no telling -- the same rule `vrrp.master_lost` follows.
 * - A cluster of one host is `degraded` by what it is configured as, counted over **every**
 *   member: a two-host cluster with one agent offline is not a single-host cluster.
 * - Addresses are compared among the online members only.
 *
 * `nameOf` names a member's host.
 */
export function clusterIncidentState(
    cluster: VrrpCluster,
    nameOf: (clientId: string) => string,
): VrrpIncidentState | null {
    const online = cluster.members.filter((member) => member.online);
    if (online.length === 0) {
        const hosts = cluster.members.map((member) => nameOf(member.clientId));
        return {
            health: "unreachable",
            reasons: [{ type: "unreachable", hosts, text: `all agents offline: ${hosts.join(", ")}` }],
        };
    }

    const { live, masters, unseenMasters } = clusterCondition(cluster);
    if (masters.length === 0 && unseenMasters.length > 0) return null;

    const reasons: VrrpIncidentReason[] = [];
    if (masters.length > 1) {
        const hosts = masters.map((member) => nameOf(member.clientId));
        reasons.push({ type: "split-brain", hosts, text: `split brain: ${hosts.join(", ")} are MASTER` });
    } else if (masters.length === 0) {
        reasons.push({ type: "no-master", text: "no host is MASTER" });
    }

    let troubled = false;
    for (const member of online) {
        const host = nameOf(member.clientId);
        const lastState = member.instance.state;
        if (!member.reporting) {
            troubled = true;
            reasons.push({
                type: "not-reporting",
                host,
                lastState,
                text: `${host}: keepalived not reporting, last ${lastState}`,
            });
        } else if (lastState === "FAULT") {
            troubled = true;
            reasons.push({ type: "fault", host, text: `${host} in FAULT` });
        }
    }

    if (cluster.members.length < 2 && live.length > 0) {
        troubled = true;
        reasons.push({ type: "single-member", text: "only one host in the cluster" });
    }

    const mismatched = mismatchedVips(online);
    for (const { member, missing } of mismatched) {
        const host = nameOf(member.clientId);
        reasons.push({ type: "vip-mismatch", host, missing, text: `${host} lacks ${missing.join(", ")}` });
    }

    // A running outage outranks a misconfiguration, as in `healthOf`.
    const health: VrrpIncidentHealth =
        masters.length > 1
            ? "split-brain"
            : masters.length === 0
              ? "no-master"
              : mismatched.length > 0
                ? "vip-mismatch"
                : troubled
                  ? "degraded"
                  : "ok";
    return { health, reasons };
}

/**
 * What makes two reasons the same finding: its type, the host, and what it is about -- the
 * masters of a split brain, the missing addresses of a mismatch. Not the host's last state and
 * not the wording: "not reporting, last MASTER" and "not reporting, last BACKUP" are one
 * finding.
 */
export function incidentReasonKey(reason: VrrpIncidentReason): string {
    switch (reason.type) {
        case "unreachable":
        case "split-brain":
            return `${reason.type}::${[...reason.hosts].sort().join(",")}`;
        case "vip-mismatch":
            return `vip-mismatch:${reason.host}:${[...reason.missing].sort().join(",")}`;
        case "not-reporting":
        case "fault":
            return `${reason.type}:${reason.host}`;
        default:
            return reason.type;
    }
}

/** The findings of a whole cluster as one comparable string, in a stable order. */
export function incidentReasonsKey(reasons: VrrpIncidentReason[]): string {
    return [...new Set(reasons.map(incidentReasonKey))].sort().join("\n");
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
        // A host whose keepalived stopped or cannot be read reports no instances. It stays in
        // its clusters with the ones it last reported, marked as not reporting -- dropping it
        // would leave the rest looking healthy with a node gone.
        const reporting = (state.instances ?? []).length > 0 || !state.lastKnownInstances?.length;
        const instances = reporting ? (state.instances ?? []) : (state.lastKnownInstances ?? []);
        for (const instance of instances) {
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
                reporting,
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
