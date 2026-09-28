import { clusterCondition, type ActivityLevel, type VrrpCluster, type VrrpClusterMember } from "@kasm/shared";
import { logger } from "@kasm/shared/node";
import { ClientRepository } from "../repositories/ClientRepository.js";
import { VrrpClusterStateRepository, type ConfirmedCondition } from "../repositories/VrrpClusterStateRepository.js";
import { ActivityService } from "./ActivityService.js";
import { KeepalivedStateService } from "./KeepalivedStateService.js";
import { ProxyService } from "./ProxyService.js";

/**
 * Reports what happens to a VRRP cluster as a whole: a new master (`vrrp.master_changed`), a
 * split brain (`vrrp.split_brain`), no master at all (`vrrp.master_lost`).
 *
 * The one place the server reports something it derived rather than something a host saw.
 * No host can: under VRRP only the master speaks, and the backups are silent, so the state of
 * every member is known only where every reading arrives. The hosts' own events stay as they
 * are; these come on top.
 *
 * **No waiting period.** A cluster is evaluated whenever a reading is stored or an agent
 * connects or goes, and an event is made as soon as the readings say something for certain:
 *
 * - A new master is certain once it is the only live one. During a failover the old master's
 *   last reading still says MASTER, so there are two -- nothing is reported until its next
 *   reading arrives or its agent is gone.
 * - A split brain or a missing master is normal for a moment while roles change. It counts
 *   once every member it is about has delivered another reading and it still holds. It is
 *   confirmed by readings, not by a timer, so a dead host whose last reading said MASTER never
 *   confirms a split brain: it drops out when its connection does.
 *   A reading only counts once VRRP itself would have settled the matter: after the master
 *   down interval (3 × advert_int plus skew) since the condition was first seen. Within it, a
 *   backup is still entitled to wait before taking over, and a reading taken then proves
 *   nothing.
 * - No master while an offline member last reported MASTER is not reported: that host may
 *   well go on serving while only its agent is away.
 *
 * What the server confirmed is stored (`vrrp_cluster_state`), so a restart reports neither
 * every cluster anew nor misses a failover that happened in between.
 */

type Trigger = { reading: string } | { connection: string };

const noPending = { pendingCondition: null, pendingSince: null, pendingWaiting: [] as string[] };

/**
 * How long VRRP gives a backup before it must take over: 3 × advert_int plus a skew below one
 * second (RFC 5798). The longest of the cluster's members, with keepalived's default of one
 * second where a member does not report its interval.
 */
function masterDownMs(cluster: VrrpCluster): number {
    const advert = Math.max(1, ...cluster.members.map((member) => member.instance.advertInterval ?? 1));
    return (3 * advert + 1) * 1000;
}

const memberKey = (member: VrrpClusterMember) => `${member.clientId}\n${member.instance.name}`;

function hostNames(): Map<string, string> {
    return new Map(
        ClientRepository.findAll().map((client) => [client.id, client.display_name || client.hostname || client.id]),
    );
}

/** The cluster as the event carries it: every member, with how fresh its state is. */
function describe(
    cluster: VrrpCluster,
    nameOf: (clientId: string) => string,
    readAt: Map<string, string>,
    masters: VrrpClusterMember[],
    previousMaster: string | null,
) {
    return {
        site: cluster.site,
        vrid: cluster.vrid,
        networks: cluster.networks,
        vips: cluster.vips,
        health: cluster.health,
        master: masters.length === 1 ? nameOf(masters[0].clientId) : null,
        masters: masters.map((member) => nameOf(member.clientId)),
        previousMaster,
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
        })),
    };
}

/** What the members the pending condition is about are: the masters, or every live member. */
function involved(condition: ConfirmedCondition, live: VrrpClusterMember[], masters: VrrpClusterMember[]) {
    return (condition === "split-brain" ? masters : live).map(memberKey);
}

export class ClusterEventService {
    /** Wires the evaluation to the two things that change a cluster. */
    static start(): void {
        KeepalivedStateService.onReadingStored((clientId) => this.evaluate({ reading: clientId }));
        ProxyService.onConnectionChange((clientId) => this.evaluate({ connection: clientId }));
    }

    /** Compares every cluster with what was confirmed. Never throws into its caller. */
    static evaluate(trigger: Trigger): void {
        try {
            this.evaluateAll(trigger);
        } catch (err) {
            logger.error({ err }, "Could not evaluate the VRRP clusters");
        }
    }

    private static evaluateAll(trigger: Trigger): void {
        const clusters = KeepalivedStateService.getClusters();
        const stored = new Map(VrrpClusterStateRepository.findAll().map((row) => [row.clusterKey, row]));
        const names = hostNames();
        const nameOf = (clientId: string) => names.get(clientId) ?? clientId;
        const readAt = new Map(KeepalivedStateService.getAll().map((state) => [state.clientId, state.receivedAt]));
        const readingFrom = "reading" in trigger ? trigger.reading : null;

        for (const cluster of clusters) {
            const { condition, live, masters, unseenMasters } = clusterCondition(cluster);
            const row = stored.get(cluster.key);

            // Nobody live, or nobody live is master while an offline member may still be:
            // nothing can be said, and nothing is changed.
            if (condition === "unknown" || (condition === "no-master" && unseenMasters.length > 0)) {
                if (row?.pendingCondition) {
                    VrrpClusterStateRepository.upsert({ ...row, ...noPending });
                }
                continue;
            }

            const master = condition === "single" ? masters[0] : null;

            // Seen for the first time: remembered, not reported -- it is no change.
            if (!row) {
                VrrpClusterStateRepository.upsert({
                    clusterKey: cluster.key,
                    condition,
                    masterClientId: master?.clientId ?? null,
                    masterInstance: master?.instance.name ?? null,
                    masterHost: master ? nameOf(master.clientId) : null,
                    ...noPending,
                });
                continue;
            }

            if (condition === "single" && master) {
                const changed =
                    row.condition !== "single" ||
                    row.masterClientId !== master.clientId ||
                    row.masterInstance !== master.instance.name;
                if (changed) {
                    // keepalived's own transition time when the master is new. The same host
                    // after a split brain or a gap has an old one, and is dated now instead.
                    const newHost = row.masterClientId !== master.clientId || row.masterInstance !== master.instance.name;
                    this.record("vrrp.master_changed", cluster.health === "ok" ? "info" : "warning", {
                        clientId: master.clientId,
                        instanceName: master.instance.name,
                        vrid: cluster.vrid,
                        occurredAt: newHost ? (master.instance.lastTransition ?? null) : null,
                        data: describe(cluster, nameOf, readAt, masters, row.masterHost),
                    });
                }
                VrrpClusterStateRepository.upsert({
                    ...row,
                    condition: "single",
                    masterClientId: master.clientId,
                    masterInstance: master.instance.name,
                    masterHost: nameOf(master.clientId),
                    ...noPending,
                });
                continue;
            }

            // Split brain or no master. Confirmed already: nothing new to say.
            if (row.condition === condition) {
                if (row.pendingCondition) VrrpClusterStateRepository.upsert({ ...row, ...noPending });
                continue;
            }

            const members = involved(condition, live, masters);
            if (row.pendingCondition !== condition) {
                // First seen. The reading that showed it does not count as its confirmation.
                VrrpClusterStateRepository.upsert({
                    ...row,
                    pendingCondition: condition,
                    pendingSince: new Date(Date.now()).toISOString(),
                    pendingWaiting: members,
                });
                continue;
            }

            // Pending: this reading pays what it owes -- if VRRP has had its time to settle --
            // and a member no longer involved (gone offline, no longer master) owes nothing.
            const settled =
                row.pendingSince !== null &&
                Date.now() - Date.parse(row.pendingSince) >= masterDownMs(cluster);
            const waiting = row.pendingWaiting.filter(
                (key) => members.includes(key) && !(settled && key.split("\n")[0] === readingFrom),
            );
            if (waiting.length > 0) {
                VrrpClusterStateRepository.upsert({ ...row, pendingWaiting: waiting });
                continue;
            }

            const kind = condition === "split-brain" ? "vrrp.split_brain" : "vrrp.master_lost";
            // The row names a host the reader can find the cluster by: one of the masters, or
            // the one that was master last.
            const about = masters[0] ?? null;
            this.record(kind, "error", {
                clientId: about?.clientId ?? row.masterClientId,
                instanceName: about?.instance.name ?? row.masterInstance,
                vrid: cluster.vrid,
                occurredAt: null,
                data: describe(cluster, nameOf, readAt, masters, row.masterHost),
            });
            // The last master is kept: it is the "previous master" of the next change.
            VrrpClusterStateRepository.upsert({ ...row, condition, ...noPending });
        }

        VrrpClusterStateRepository.deleteExcept(clusters.map((cluster) => cluster.key));
    }

    private static record(
        kind: "vrrp.master_changed" | "vrrp.split_brain" | "vrrp.master_lost",
        level: ActivityLevel,
        event: {
            clientId: string | null;
            instanceName: string | null;
            vrid: number | null;
            occurredAt: string | null;
            data: Record<string, unknown>;
        },
    ): void {
        ActivityService.record({
            kind,
            level,
            clientId: event.clientId,
            occurredAt: event.occurredAt ?? undefined,
            subject: {
                ...(event.instanceName ? { instanceName: event.instanceName } : {}),
                ...(event.vrid !== null ? { vrid: event.vrid } : {}),
            },
            data: event.data,
        });
        logger.info({ kind, cluster: event.data.vrid, site: event.data.site }, "VRRP cluster event");
    }
}
