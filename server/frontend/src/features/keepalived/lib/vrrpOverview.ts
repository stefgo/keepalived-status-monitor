import type { BadgeProps, StatusDotTone } from "@stefgo/react-ui-components";
import type { KeepalivedState, VrrpClusterHealth, VrrpState } from "@kasm/shared";
import { plural } from "../../../utils";
import { virtualIpRows, VIP_STATE } from "./virtualIps";
import { CLUSTER_HEALTH, clusterLabel, type NamedClusterMember, type NamedVrrpCluster } from "./vrrp";

/** How VRRP is doing across the fleet, in one word -- the dashboard's first card. */
export type FleetStatus = "healthy" | "degraded" | "critical" | "unknown";

export const FLEET_STATUS: Record<
    FleetStatus,
    { label: string; variant: NonNullable<BadgeProps["variant"]>; description: string }
> = {
    healthy: { label: "Healthy", variant: "success", description: "Every cluster has one MASTER and every member reporting." },
    degraded: {
        label: "Degraded",
        variant: "warning",
        description: "Every cluster is served, but a member is missing, in FAULT or out of sight.",
    },
    critical: {
        label: "Critical",
        variant: "error",
        description: "A cluster is split, has no MASTER, or its members carry different addresses.",
    },
    unknown: { label: "Unknown", variant: "neutral", description: "No agent reports a VRRP instance." },
};

/**
 * The fleet's status from its clusters' health. `critical` once a cluster's badge is red,
 * `degraded` while one is degraded or out of sight while others are not, `unknown` while
 * nothing is in sight at all.
 */
export function fleetStatus(clusters: readonly { health: VrrpClusterHealth }[]): FleetStatus {
    if (clusters.some((cluster) => CLUSTER_HEALTH[cluster.health].variant === "error")) return "critical";
    if (clusters.every((cluster) => cluster.health === "unknown")) return "unknown";
    if (clusters.some((cluster) => cluster.health !== "ok")) return "degraded";
    return "healthy";
}

/** The dot next to a cluster: its badge's colour. */
export function clusterTone(health: VrrpClusterHealth): StatusDotTone {
    const variant = CLUSTER_HEALTH[health].variant;
    return variant === "success" || variant === "warning" || variant === "error" ? variant : "unknown";
}

export type FactTone = "warning" | "error";

/** A fact that may be a warning in itself. */
export interface Fact {
    text: string;
    tone: FactTone | null;
}

/** What the VRRP card lists about the fleet, written out. Null for a fact with nothing to say. */
export interface VrrpOverview {
    clusters: string;
    instances: string;
    masters: string;
    vips: Fact;
    syncGroups: Fact | null;
    versions: Fact | null;
    lastFailover: { text: string; at: string } | null;
    sites: string | null;
}

/** The order the clusters line is written in: the healthy ones, then what needs a look. */
const HEALTH_ORDER: VrrpClusterHealth[] = ["ok", "degraded", "vip-mismatch", "no-master", "split-brain", "unknown"];

const STATE_ORDER: VrrpState[] = ["MASTER", "BACKUP", "FAULT", "INIT", "STOP", "DELETED", "UNKNOWN"];

const isLive = (member: NamedClusterMember) => member.online && member.reporting;

/** `lb-01: 2 · lb-03: 1` -- the most first, then by name. */
const countedBy = <T>(items: readonly T[], key: (item: T) => string) => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
    return [...counts].sort(([a, m], [b, n]) => n - m || a.localeCompare(b));
};

/** The instance that changed state last, of those that have a time. */
const latest = <T extends { member: NamedClusterMember }>(entries: T[]): T | undefined =>
    entries
        .filter((entry) => entry.member.instance.lastTransition)
        .reduce<T | undefined>(
            (best, entry) =>
                !best || entry.member.instance.lastTransition! > best.member.instance.lastTransition! ? entry : best,
            undefined,
        );

/**
 * When a cluster last changed: when its MASTER became MASTER, or, without a MASTER, the last
 * change of any member that reports. Null where keepalived gives no time.
 */
export function clusterLastChange(cluster: NamedVrrpCluster): string | null {
    const live = cluster.members.filter(isLive).map((member) => ({ member }));
    const masters = live.filter(({ member }) => member.instance.state === "MASTER");
    return latest(masters.length > 0 ? masters : live)?.member.instance.lastTransition ?? null;
}

/** A sync group whose instances on one host are not all in one state. */
function outOfStep(reading: KeepalivedState): number {
    return reading.syncGroups.filter((group) => {
        const states = new Set(
            reading.instances
                .filter((instance) => instance.syncGroup === group.name || group.instances.includes(instance.name))
                .map((instance) => instance.state),
        );
        return states.size > 1;
    }).length;
}

/**
 * The facts the VRRP card lists. The clusters' members count where they are live -- online,
 * with keepalived reporting -- as the clusters' health counts them. `readings` are those of
 * the hosts that are online: the sync groups and keepalived's version are a host's, not a
 * cluster's.
 */
export function vrrpOverview(clusters: readonly NamedVrrpCluster[], readings: readonly KeepalivedState[]): VrrpOverview {
    const byHealth = HEALTH_ORDER.map((health) => [health, clusters.filter((c) => c.health === health).length] as const)
        .filter(([, count]) => count > 0)
        .map(([health, count]) => `${count} ${CLUSTER_HEALTH[health].label.toLowerCase()}`);

    const live = clusters.flatMap((cluster) => cluster.members.filter(isLive).map((member) => ({ cluster, member })));
    const hosts = new Set(live.map(({ member }) => member.clientId)).size;
    const byState = STATE_ORDER.map((state) => [state, live.filter(({ member }) => member.instance.state === state).length] as const)
        .filter(([, count]) => count > 0)
        .map(([state, count]) => `${count} ${state}`);
    const masters = live.filter(({ member }) => member.instance.state === "MASTER");

    const vips = virtualIpRows(clusters);
    const vipProblems = (Object.keys(VIP_STATE) as (keyof typeof VIP_STATE)[])
        .filter((state) => state !== "served")
        .map((state) => [state, vips.filter((row) => row.state === state).length] as const)
        .filter(([, count]) => count > 0);

    const groups = new Set(readings.flatMap((reading) => reading.syncGroups.map((group) => group.name)));
    const stray = readings.reduce((sum, reading) => sum + outOfStep(reading), 0);

    const versioned = readings.filter((reading) => reading.version);
    const versions = countedBy(versioned, (reading) => reading.version!);

    const failover = latest(masters);
    const sites = [...new Set(clusters.map((cluster) => cluster.site).filter((site) => site !== null))].sort();

    return {
        clusters: clusters.length === 0 ? "None" : [String(clusters.length), byHealth.join(", ")].join(" · "),
        instances:
            live.length === 0
                ? "None reporting"
                : `${live.length} on ${plural(hosts, "host")} · ${byState.join(", ")}`,
        masters:
            masters.length === 0
                ? "None"
                : countedBy(masters, ({ member }) => member.hostName)
                      .map(([host, count]) => `${host}: ${count}`)
                      .join(" · "),
        vips:
            vips.length === 0
                ? { text: "None", tone: null }
                : vipProblems.length === 0
                  ? { text: `${vips.length} · all served`, tone: null }
                  : {
                        text: `${vips.length} · ${vipProblems.map(([state, n]) => `${n} ${VIP_STATE[state].label.toLowerCase()}`).join(", ")}`,
                        // An address nobody reports on is not known to be wrong.
                        tone: vipProblems.some(([state]) => VIP_STATE[state].tone === "error")
                            ? "error"
                            : vipProblems.some(([state]) => VIP_STATE[state].tone === "warning")
                              ? "warning"
                              : null,
                    },
        syncGroups:
            groups.size === 0
                ? null
                : stray === 0
                  ? { text: `${groups.size} · in step`, tone: null }
                  : { text: `${groups.size} · ${stray} out of step`, tone: "warning" },
        versions:
            versions.length === 0
                ? null
                : versions.length === 1
                  ? {
                        text:
                            versioned.length === readings.length && readings.length > 1
                                ? `${versions[0][0]} on every host`
                                : `${versions[0][0]} on ${plural(versioned.length, "host")}`,
                        tone: null,
                    }
                  : { text: versions.map(([version, n]) => `${version} (${n})`).join(" · "), tone: "warning" },
        lastFailover: failover
            ? {
                  text: `${failover.member.hostName} became MASTER of ${clusterLabel(failover.cluster)}`,
                  at: failover.member.instance.lastTransition!,
              }
            : null,
        sites: sites.length > 0 ? sites.join(", ") : null,
    };
}

/** More clusters than this and the card shows only those that are not healthy. */
export const TILE_LIMIT = 12;

/**
 * The clusters the VRRP card draws a tile for: all of them up to `TILE_LIMIT`, beyond it the
 * ones that are not healthy -- every one of those, however many. `hidden` counts the rest.
 */
export function visibleTiles<C extends { health: VrrpClusterHealth }>(
    clusters: readonly C[],
    limit = TILE_LIMIT,
): { shown: C[]; hidden: number } {
    const shown = clusters.length <= limit ? [...clusters] : clusters.filter((cluster) => cluster.health !== "ok");
    return { shown, hidden: clusters.length - shown.length };
}
