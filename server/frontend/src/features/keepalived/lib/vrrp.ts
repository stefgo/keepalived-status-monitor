import type { BadgeProps } from "@stefgo/react-ui-components";
import type { KeepalivedState, VrrpCluster, VrrpClusterHealth, VrrpClusterMember, VrrpState } from "@kasm/shared";

/**
 * One host's reading in a few words: whether keepalived could be read, and how many of its
 * instances serve or have failed. A process the agent found but could not read is running,
 * yet reports nothing -- "Unreadable", so its zero counts are not taken for the truth.
 */
export function summarizeKeepalived(state: KeepalivedState) {
    return {
        status: state.running ? (state.error ? "Unreadable" : "Running") : "Stopped",
        instances: state.instances.length,
        masters: state.instances.filter((instance) => instance.state === "MASTER").length,
        faults: state.instances.filter((instance) => instance.state === "FAULT").length,
    };
}

/**
 * One colour per state, used everywhere a state is shown. MASTER is green because it is the
 * node that serves; BACKUP is the healthy standby, not a warning.
 */
export function vrrpStateVariant(state: VrrpState): NonNullable<BadgeProps["variant"]> {
    switch (state) {
        case "MASTER":
            return "success";
        case "BACKUP":
            return "info";
        case "FAULT":
            return "error";
        case "INIT":
        case "STOP":
            return "warning";
        default:
            return "neutral";
    }
}

/**
 * How a state reads on screen: `MASTER` → `Master`. keepalived and the wire keep the upper
 * case; only the text a reader sees changes. Takes a plain string, because the activity
 * list gets its states from agents of any version.
 */
export function vrrpStateLabel(state: string): string {
    return state.charAt(0).toUpperCase() + state.slice(1).toLowerCase();
}

export const CLUSTER_HEALTH: Record<
    VrrpClusterHealth,
    { label: string; variant: NonNullable<BadgeProps["variant"]>; description: string }
> = {
    ok: { label: "Healthy", variant: "success", description: "One MASTER, every member reporting." },
    degraded: {
        label: "Degraded",
        variant: "warning",
        description: "One MASTER holds, but a member is in FAULT, offline, or the only one left.",
    },
    "no-master": {
        label: "No MASTER",
        variant: "error",
        description: "No online member is MASTER: the virtual addresses are not served.",
    },
    "split-brain": {
        label: "Split brain",
        variant: "error",
        description: "More than one member claims MASTER for the same virtual router.",
    },
    "vip-mismatch": {
        label: "VIP mismatch",
        variant: "error",
        description:
            "The members do not all carry the same virtual addresses: a failover would change which of them are up. Counted over every member, offline ones included.",
    },
    unknown: { label: "Unknown", variant: "neutral", description: "No member of this cluster is online." },
};

/** keepalived reports fractions of a second; whole seconds read better. */
export function formatInterval(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined) return "–";
    return Number.isInteger(seconds) ? `${seconds} s` : `${seconds.toFixed(2)} s`;
}

/** `advertisements_received` → `Advertisements received`. */
export function statLabel(key: string): string {
    const text = key.replace(/_/g, " ");
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The VRID is unique per site only, so the site leads it. */
export function clusterLabel(cluster: VrrpCluster): string {
    return `${cluster.site ? `${cluster.site} / ` : ""}VRID ${cluster.vrid ?? "?"}`;
}

/** A cluster's addresses, or the name of its instances where it has none. */
export function clusterVipLabel(cluster: VrrpCluster): string | undefined {
    return cluster.vips.length > 0 ? cluster.vips.join(", ") : cluster.members[0]?.instance.name;
}

/**
 * The part of a cluster's key after site and VRID: the network its addresses sit on, or the
 * instance name of a cluster that reports none. It tells apart two clusters that share site
 * and VRID -- separate segments reusing the VRID, which is allowed.
 */
export function clusterNetworkKey(cluster: VrrpCluster): string {
    return cluster.key.slice(`${cluster.site ?? ""}|${cluster.vrid ?? "?"}|`.length);
}

/** The clusters behind one site and VRID: one as a rule, several on separate segments of a site. */
export function clustersAt(clusters: VrrpCluster[], site: string | null, vrid: number): VrrpCluster[] {
    return clusters.filter((cluster) => cluster.site === site && cluster.vrid === vrid);
}

/**
 * Where a cluster has its page: `/clusters/<vrid>`, or `/clusters/<site>/<vrid>` for a
 * client with a site. Only where another cluster shares both does `?net=` name the one
 * meant. A cluster without a VRID has no page -- keepalived reports one for every instance.
 */
export function clusterPath(cluster: VrrpCluster, clusters: VrrpCluster[]): string | undefined {
    if (cluster.vrid === null) return undefined;
    const path = cluster.site
        ? `/clusters/${encodeURIComponent(cluster.site)}/${cluster.vrid}`
        : `/clusters/${cluster.vrid}`;
    return clustersAt(clusters, cluster.site, cluster.vrid).length > 1
        ? `${path}?net=${encodeURIComponent(clusterNetworkKey(cluster))}`
        : path;
}

/** The cluster one host's instance takes part in. */
export function clusterOf(
    clusters: VrrpCluster[],
    clientId: string,
    instanceName: string,
): VrrpCluster | undefined {
    return clusters.find((cluster) =>
        cluster.members.some((member) => member.clientId === clientId && member.instance.name === instanceName),
    );
}

interface CounterDef {
    label: string;
    /**
     * The counter's names in both dumps: the text dump's headings in snake case first, then
     * the JSON dump's field. An agent with the JSON dump switched on sends both, and two hosts
     * of one cluster may send one each, so a row has to recognise either.
     */
    keys: string[];
}

interface CounterGroupDef {
    title: string;
    /** Every count above zero is something that went wrong. */
    problem?: boolean;
    counters: CounterDef[];
}

const COUNTER_GROUPS: CounterGroupDef[] = [
    {
        title: "Advertisements",
        counters: [
            { label: "Received", keys: ["advertisements_received", "advert_rcvd"] },
            { label: "Sent", keys: ["advertisements_sent", "advert_sent"] },
        ],
    },
    {
        title: "MASTER role",
        counters: [
            { label: "Became master", keys: ["became_master", "become_master"] },
            { label: "Released master", keys: ["released_master", "release_master"] },
        ],
    },
    {
        title: "Priority zero",
        counters: [
            { label: "Received", keys: ["priority_zero_received", "pri_zero_rcvd"] },
            { label: "Sent", keys: ["priority_zero_sent", "pri_zero_sent"] },
        ],
    },
    {
        title: "Packet errors",
        problem: true,
        counters: [
            { label: "Length", keys: ["packet_errors_length", "packet_len_err"] },
            { label: "TTL", keys: ["packet_errors_ttl", "ip_ttl_err"] },
            { label: "Invalid type", keys: ["packet_errors_invalid_type", "invalid_type_rcvd"] },
            {
                label: "Advertisement interval",
                keys: ["packet_errors_advertisement_interval", "advert_interval_err"],
            },
            { label: "Address list", keys: ["packet_errors_address_list", "addr_list_err"] },
        ],
    },
    {
        title: "Authentication errors",
        problem: true,
        counters: [
            { label: "Invalid type", keys: ["authentication_errors_invalid_type", "invalid_authtype"] },
            { label: "Type mismatch", keys: ["authentication_errors_type_mismatch", "authtype_mismatch"] },
            { label: "Failure", keys: ["authentication_errors_failure", "auth_failure"] },
        ],
    },
];

const KNOWN_COUNTERS = new Set(COUNTER_GROUPS.flatMap((group) => group.counters.flatMap((c) => c.keys)));

export interface CounterRow {
    label: string;
    problem: boolean;
    /** One value per set of counters passed in, in their order; null where it has none. */
    values: (number | null)[];
}

export interface CounterGroup {
    title: string;
    rows: CounterRow[];
}

/**
 * The counters of several hosts side by side, grouped, and under one name whichever dump they
 * came from. A counter nobody reports is left out, as is a group left empty; a counter this
 * build does not know lands in "Other" under its own name rather than being dropped.
 */
export function groupCounters(stats: (Record<string, number> | null | undefined)[]): CounterGroup[] {
    const valueOf = (keys: string[]) =>
        stats.map((counters) => {
            const key = keys.find((k) => counters?.[k] !== undefined);
            return key !== undefined ? (counters?.[key] ?? null) : null;
        });

    const groups: CounterGroup[] = COUNTER_GROUPS.map((group) => ({
        title: group.title,
        rows: group.counters
            .map((counter) => ({
                label: counter.label,
                problem: group.problem ?? false,
                values: valueOf(counter.keys),
            }))
            .filter((row) => row.values.some((value) => value !== null)),
    }));

    const unknown = [
        ...new Set(stats.flatMap((counters) => Object.keys(counters ?? {}))),
    ].filter((key) => !KNOWN_COUNTERS.has(key));
    groups.push({
        title: "Other",
        rows: unknown.sort().map((key) => ({ label: statLabel(key), problem: false, values: valueOf([key]) })),
    });

    return groups.filter((group) => group.rows.length > 0);
}

const PROBLEM_COUNTERS = COUNTER_GROUPS.filter((group) => group.problem).flatMap((group) =>
    group.counters.flatMap((c) => c.keys),
);

/** Whether a host counted any packet or authentication error. */
export function hasProblemCounts(stats: Record<string, number> | null | undefined): boolean {
    return PROBLEM_COUNTERS.some((key) => (stats?.[key] ?? 0) > 0);
}

/** How a cluster member is told apart from the others: a host may take part with several instances. */
export const memberKey = (member: VrrpClusterMember) => `${member.clientId}:${member.instance.name}`;

/**
 * The members whose counters a cluster page compares until the reader picks others: the ones
 * that counted errors, since they are what the comparison is for.
 */
export function defaultCompareSelection(members: VrrpClusterMember[]): Set<string> {
    return new Set(members.filter((m) => hasProblemCounts(m.instance.stats)).map(memberKey));
}
