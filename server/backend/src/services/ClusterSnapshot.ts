import { clusterCondition, type VrrpCluster, type VrrpClusterMember } from "@kasm/shared";
import { ClientRepository } from "../repositories/ClientRepository.js";
import { KeepalivedStateService } from "./KeepalivedStateService.js";

/**
 * What one evaluation of the clusters looks at -- the clusters as they stand -- and the
 * `cluster` block every cluster event carries.
 */

/**
 * What started an evaluation: a stored reading, an agent connecting or going, or a pending
 * state that is confirmed by time rather than by a reading (a cluster without any agent).
 */
export type Trigger = { reading: string } | { connection: string } | { recheck: true };

export interface ClusterSnapshot {
    clusters: VrrpCluster[];
    nameOf: (clientId: string) => string;
    /** When the server received each client's last reading. */
    readAt: Map<string, string>;
    /** The client whose reading started this evaluation; null for a connection change. */
    readingFrom: string | null;
}

export function takeSnapshot(trigger: Trigger): ClusterSnapshot {
    const names = new Map(
        ClientRepository.findAll().map((client) => [client.id, client.display_name || client.hostname || client.id]),
    );
    return {
        clusters: KeepalivedStateService.getClusters(),
        nameOf: (clientId) => names.get(clientId) ?? clientId,
        readAt: new Map(KeepalivedStateService.getAll().map((state) => [state.clientId, state.receivedAt])),
        readingFrom: "reading" in trigger ? trigger.reading : null,
    };
}

/**
 * How long VRRP gives a backup before it must take over: 3 × advert_int plus a skew below one
 * second (RFC 5798). The longest of the cluster's members, with keepalived's default of one
 * second where a member does not report its interval.
 */
export function masterDownMs(cluster: VrrpCluster): number {
    const advert = Math.max(1, ...cluster.members.map((member) => member.instance.advertInterval ?? 1));
    return (3 * advert + 1) * 1000;
}

export const memberKey = (member: VrrpClusterMember) => `${member.clientId}\n${member.instance.name}`;

/**
 * The cluster as its events carry it (`data.cluster`): what was observed, every member with
 * how fresh its state is. `health` is the dashboard's; an incident's own is `data.incident`.
 */
export function describeCluster(cluster: VrrpCluster, snapshot: ClusterSnapshot) {
    const { nameOf, readAt } = snapshot;
    const { masters } = clusterCondition(cluster);
    return {
        site: cluster.site,
        vrid: cluster.vrid,
        networks: cluster.networks,
        vips: cluster.vips,
        health: cluster.health,
        master: masters.length === 1 ? nameOf(masters[0].clientId) : null,
        masters: masters.map((member) => nameOf(member.clientId)),
        members: cluster.members.map((member) => ({
            host: nameOf(member.clientId),
            clientId: member.clientId,
            instanceName: member.instance.name,
            state: member.instance.state,
            priority: member.instance.priority ?? null,
            effectivePriority: member.instance.effectivePriority ?? null,
            online: member.online,
            reporting: member.reporting,
            readAt: readAt.get(member.clientId) ?? null,
            vips: member.instance.vips ?? [],
        })),
    };
}
