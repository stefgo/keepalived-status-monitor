import { CLIENT_STATUS } from "./constants.js";
import type { KeepalivedState, VrrpCluster, VrrpClusterHealth, VrrpClusterMember } from "./types.js";
import { buildVrrpClusters, mismatchedVips } from "./vrrpCluster.js";

/**
 * What is wrong with the clusters, and the fleet's verdict -- what the dashboard shows and
 * what the server's status report (`GET /api/v1/status`) answers with. One implementation for
 * both, so the two cannot disagree.
 */

/** How a client is named everywhere: its display name, or its hostname while it has none. */
export const clientName = (client: { displayName?: string | null; hostname: string }): string =>
    client.displayName || client.hostname;

/** The VRID is unique per site only, so the site leads it. */
export function clusterLabel(cluster: Pick<VrrpCluster, "site" | "vrid">): string {
    return `${cluster.site ? `${cluster.site} / ` : ""}VRID ${cluster.vrid ?? "?"}`;
}

/** A cluster member with the name its host goes by, see `nameMembers`. */
export interface NamedClusterMember extends VrrpClusterMember {
    hostName: string;
}

/** A cluster as the dashboard holds it: every member knows what its host is called. */
export interface NamedVrrpCluster extends VrrpCluster {
    members: NamedClusterMember[];
}

/**
 * The clusters with each member's host named -- once, so that a table, its search and a
 * sentence about the same host cannot call it three different things. `nameOf` has no name
 * for a client that is gone; its id stands in, which is still what the host's page is under.
 */
export function nameMembers(
    clusters: VrrpCluster[],
    nameOf: (clientId: string) => string | undefined,
): NamedVrrpCluster[] {
    return clusters.map((cluster) => ({
        ...cluster,
        members: cluster.members.map((member) => ({
            ...member,
            hostName: nameOf(member.clientId) ?? member.clientId,
        })),
    }));
}

/** What `buildNamedClusters` needs to know of a client. */
export interface ClusterClient {
    id: string;
    hostname: string;
    displayName?: string | null;
    site?: string | null;
    status?: string | null;
}

/**
 * The clusters as the dashboard shows them, from the clients and their last readings: a
 * member is online while its client is, and a reading of a client that has since been
 * deleted is not part of any cluster.
 */
export function buildNamedClusters(
    clients: readonly ClusterClient[],
    states: readonly KeepalivedState[],
): NamedVrrpCluster[] {
    const sites = new Map(clients.map((client) => [client.id, client.site ?? null]));
    const names = new Map(clients.map((client) => [client.id, clientName(client)]));
    const online = clients.filter((client) => client.status === CLIENT_STATUS.ONLINE).map((client) => client.id);
    const current = states.filter((state) => sites.has(state.clientId));
    return nameMembers(
        buildVrrpClusters(current, online, (clientId) => sites.get(clientId) ?? null),
        (clientId) => names.get(clientId),
    );
}

export type FindingSeverity = "error" | "warning";

export type ClusterFindingType =
    | "split-brain"
    | "no-master"
    | "vip-missing"
    | "agent-offline"
    | "keepalived-not-reporting"
    | "instance-fault"
    | "single-member";

/** One thing that is wrong with a cluster, in a sentence. */
export interface ClusterFinding {
    /**
     * What makes this finding this finding, from one evaluation to the next: its type, the
     * cluster's key and, for one about a member, which member. Never its text.
     */
    id: string;
    type: ClusterFindingType;
    severity: FindingSeverity;
    /** The sentence after the cluster's label, as the dashboard writes it. */
    text: string;
}

const isLive = (member: NamedClusterMember) => member.online && member.reporting;

/** How a member is told apart in a finding's id: a host may take part with several instances. */
const memberId = (member: VrrpClusterMember) => `${member.clientId}:${member.instance.name}`;

/**
 * What is wrong with a cluster, one finding per thing. Counted as the cluster's health is
 * (`healthOf`), so the two cannot disagree: a healthy cluster has none, a degraded one has a
 * warning, and one whose badge is red has an error. That is why an agent that is offline is a
 * finding here, while the incidents leave it out.
 *
 * Errors come first.
 */
export function clusterFindings(cluster: NamedVrrpCluster): ClusterFinding[] {
    const findings: ClusterFinding[] = [];
    const add = (type: ClusterFindingType, severity: FindingSeverity, text: string, member?: VrrpClusterMember) =>
        findings.push({ id: `${type}:${cluster.key}${member ? `:${memberId(member)}` : ""}`, type, severity, text });
    const live = cluster.members.filter(isLive);
    const masters = live.filter((member) => member.instance.state === "MASTER");

    if (live.length > 0 && masters.length > 1) {
        add("split-brain", "error", `Split brain: ${masters.map((member) => member.hostName).join(", ")} are MASTER`);
    } else if (live.length > 0 && masters.length === 0) {
        add("no-master", "error", "No host is MASTER");
    }

    // Like `healthOf`, over every member: a statement about the configuration.
    for (const { member, missing } of mismatchedVips(cluster.members)) {
        add("vip-missing", "error", `${member.hostName} lacks ${missing.join(", ")}`, member);
    }

    for (const member of cluster.members) {
        const last = member.instance.state;
        if (!member.online) {
            add("agent-offline", "warning", `${member.hostName}: agent offline, last ${last}`, member);
        } else if (!member.reporting) {
            add("keepalived-not-reporting", "warning", `${member.hostName}: keepalived not reporting, last ${last}`, member);
        } else if (last === "FAULT") {
            add("instance-fault", "warning", `${member.hostName} in FAULT`, member);
        }
    }

    if (cluster.members.length < 2) {
        add("single-member", "warning", "Only one host in the cluster");
    }

    return findings;
}

/** A finding together with the cluster it is about. */
export interface FleetFinding extends ClusterFinding {
    cluster: NamedVrrpCluster;
}

/**
 * Every finding across the fleet: the errors of every cluster first, then the warnings, each
 * in the order the clusters come in -- which puts the worst cluster on top.
 */
export function fleetFindings(clusters: readonly NamedVrrpCluster[]): FleetFinding[] {
    const all = clusters.flatMap((cluster) => clusterFindings(cluster).map((finding) => ({ ...finding, cluster })));
    return [...all.filter((f) => f.severity === "error"), ...all.filter((f) => f.severity === "warning")];
}

/** A finding's whole line, as the dashboard's list shows it: the cluster's label, then the sentence. */
export const fleetFindingText = (finding: FleetFinding): string => `${clusterLabel(finding.cluster)}: ${finding.text}`;

/** How VRRP is doing across the fleet, in one word -- the dashboard's first card. */
export type FleetStatus = "healthy" | "degraded" | "critical" | "unknown";

/**
 * How bad each cluster health is. The dashboard's badge colours (`CLUSTER_HEALTH`) follow
 * this, and a test holds them to it: a red badge is an error here.
 */
export const CLUSTER_HEALTH_SEVERITY: Record<VrrpClusterHealth, FindingSeverity | "ok" | "unknown"> = {
    ok: "ok",
    degraded: "warning",
    "no-master": "error",
    "split-brain": "error",
    "vip-mismatch": "error",
    unknown: "unknown",
};

/**
 * The fleet's status from its clusters' health. `critical` once a cluster's badge is red,
 * `degraded` while one is degraded or out of sight while others are not, `unknown` while
 * nothing is in sight at all.
 */
export function fleetStatus(clusters: readonly { health: VrrpClusterHealth }[]): FleetStatus {
    if (clusters.some((cluster) => CLUSTER_HEALTH_SEVERITY[cluster.health] === "error")) return "critical";
    if (clusters.every((cluster) => cluster.health === "unknown")) return "unknown";
    if (clusters.some((cluster) => cluster.health !== "ok")) return "degraded";
    return "healthy";
}

/** How many of the hosts are online, of how many. */
export interface OnlineCount {
    online: number;
    total: number;
}

/** How many hosts are online: the dashboard's card, the sidebar's badge and the status report count with this. */
export const clientCount = (clients: readonly { status?: string | null }[]): OnlineCount => ({
    online: clients.filter((c) => c.status === CLIENT_STATUS.ONLINE).length,
    total: clients.length,
});

export interface InstanceCount {
    instances: number;
    masters: number;
    faults: number;
}

/**
 * The VRRP instances of the hosts that are connected. An instance of an offline host is not
 * counted: its last reading is not its present, and the card on the hosts says that the
 * host is gone.
 */
export function instanceCount(
    clients: readonly { id: string; status?: string | null }[],
    states: Readonly<Record<string, KeepalivedState | undefined>>,
): InstanceCount {
    const instances = clients
        .filter((client) => client.status === CLIENT_STATUS.ONLINE)
        .flatMap((client) => states[client.id]?.instances ?? []);
    return {
        instances: instances.length,
        masters: instances.filter((instance) => instance.state === "MASTER").length,
        faults: instances.filter((instance) => instance.state === "FAULT").length,
    };
}

/** The clusters the dashboard shows a card for: every one whose health is known and not ok. */
export const needsAttention = <C extends VrrpCluster>(clusters: readonly C[]): C[] =>
    clusters.filter((cluster) => cluster.health !== "ok" && cluster.health !== "unknown");
