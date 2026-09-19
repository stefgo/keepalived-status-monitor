import type {
    KeepalivedState,
    VrrpCluster,
    VrrpClusterHealth,
    VrrpClusterMember,
    VrrpInstance,
} from "./types.js";

/**
 * Which cluster an instance answers for. A VRID is unique only per network segment, so two
 * unrelated clusters may share one; the set of virtual addresses tells them apart. An
 * instance without addresses falls back to its name, which is what keepalived.conf files
 * of the same cluster usually share.
 */
export function vrrpClusterKey(instance: VrrpInstance): string {
    const vrid = instance.vrid ?? "?";
    const vips = [...(instance.vips ?? [])].map(stripPrefix).sort();
    return vips.length > 0 ? `${vrid}|${vips.join(",")}` : `${vrid}|name:${instance.name}`;
}

/** `192.168.1.100/24` and `192.168.1.100` are the same address on two differently written configs. */
function stripPrefix(address: string): string {
    return address.replace(/\/\d+$/, "");
}

function healthOf(members: VrrpClusterMember[]): VrrpClusterHealth {
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
}

/**
 * Groups the instances of every host into clusters. Pure, so the server's endpoint and the
 * dashboard -- which recomputes on every status change -- cannot come to different answers.
 * Ordered with the clusters that need attention first.
 */
export function buildVrrpClusters(
    states: KeepalivedState[],
    onlineClientIds: Iterable<string>,
): VrrpCluster[] {
    const online = new Set(onlineClientIds);
    const clusters = new Map<string, VrrpCluster>();

    for (const state of states) {
        for (const instance of state.instances ?? []) {
            const key = vrrpClusterKey(instance);
            let cluster = clusters.get(key);
            if (!cluster) {
                cluster = {
                    key,
                    vrid: instance.vrid ?? null,
                    vips: [...(instance.vips ?? [])],
                    members: [],
                    health: "unknown",
                };
                clusters.set(key, cluster);
            }
            cluster.members.push({
                clientId: state.clientId,
                online: online.has(state.clientId),
                instance,
            });
        }
    }

    const rank: Record<VrrpClusterHealth, number> = {
        "split-brain": 0,
        "no-master": 1,
        degraded: 2,
        unknown: 3,
        ok: 4,
    };
    return [...clusters.values()]
        .map((cluster) => ({ ...cluster, health: healthOf(cluster.members) }))
        .sort((a, b) => rank[a.health] - rank[b.health] || (a.vrid ?? 0) - (b.vrid ?? 0));
}
