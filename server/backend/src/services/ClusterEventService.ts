import { randomUUID } from "crypto";
import {
    clusterCondition,
    clusterIncidentState,
    incidentReasonKey,
    incidentReasonsKey,
    type ActivityKind,
    type ActivityLevel,
    type VrrpCluster,
    type VrrpClusterMember,
    type VrrpIncidentReason,
} from "@kasm/shared";
import { logger } from "@kasm/shared/node";
import {
    VrrpClusterRepository,
    type ConfirmedCondition,
    type ObservedClusterState,
    type VrrpClusterRow,
} from "../repositories/VrrpClusterRepository.js";
import { ActivityService } from "./ActivityService.js";
import { describeCluster, masterDownMs, memberKey, takeSnapshot, type ClusterSnapshot, type Trigger } from "./ClusterSnapshot.js";
import { KeepalivedStateService } from "./KeepalivedStateService.js";
import { ProxyService } from "./ProxyService.js";
import { PendingFollowUps, READING_REQUEST_MARGIN_MS, requestReadings } from "./ReadingRequests.js";

/**
 * Reports what happens to a VRRP cluster as a whole. The one place the server reports
 * something it derived rather than something a host saw: under VRRP only the master speaks,
 * so the state of every member is known only where every reading arrives.
 *
 * A cluster's state is two things, confirmed together:
 *
 * - **Who holds it** (`clusterCondition`): one MASTER, several, or none. Its changes are the
 *   cluster's history -- `vrrp.master_changed`, `vrrp.split_brain`, `vrrp.master_lost`, all
 *   `info`.
 * - **How it is doing** (`clusterIncidentState`): a health of its own, in which an agent that
 *   is offline does not count -- keepalived runs on without it -- and a cluster with no agent
 *   connected is `unreachable`. Anything but `ok` is an incident: `vrrp.incident_opened` and
 *   `vrrp.incident_updated` (`warning`) while it lasts, `vrrp.incident_resolved` (`info`) when
 *   it ends, all with the incident's id as their `correlationId`. A change of health or of the
 *   findings behind it is an update; a host's last state changing is not.
 *
 * **One confirmation.** What a cluster is seen as differs from what was confirmed: it is
 * pending, and it counts once every live member has delivered another reading after VRRP's
 * master down interval since it was first seen. Those readings are asked for when the interval
 * is over (`PendingFollowUps`), so the wait is the interval and about a second. The events of
 * that change are then made at once, from the difference between the old state and the new
 * one, all with the same `cluster` -- a state every live host confirmed after VRRP settled,
 * not a leftover MASTER of the host that just handed over. A state that goes away while
 * pending is never reported, and a member that stops being live owes nothing.
 *
 * `unreachable` has no agent to confirm it with. It counts once it has lasted
 * `UNREACHABLE_CONFIRM_MS`; a follow-up looks again then, since no reading would.
 *
 * Nothing is said -- and the confirmed part is kept -- about the roles while no member is
 * live, nor about either part while no live member is MASTER but an offline one last reported
 * MASTER: that host may well go on serving. A cluster seen for the first time takes its roles
 * as they are, without an event; its health starts from `ok`, so one that is already unhealthy
 * opens an incident. A cluster that disappears with an incident open closes it
 * (`resolution: "removed"`).
 *
 * **Start-up.** Right after the server starts, the agents have not reconnected yet. Nothing is
 * evaluated until every client with a reading is back, or `STARTUP_GRACE_MS` has passed.
 *
 * What was confirmed is stored (`vrrp_cluster`), so a restart reports neither every cluster
 * anew nor misses a change that happened in between.
 */

const STARTUP_GRACE_MS = 60_000;

/** How long a cluster must have no connected agent at all before that is an incident. */
const UNREACHABLE_CONFIRM_MS = 60_000;

const noPending = { pendingState: null, pendingSince: null, pendingWaiting: [] as string[] };

function sameState(a: ObservedClusterState | null, b: ObservedClusterState): boolean {
    return (
        a !== null &&
        a.condition === b.condition &&
        a.masterClientId === b.masterClientId &&
        a.masterInstance === b.masterInstance &&
        a.health === b.health &&
        a.reasonsKey === b.reasonsKey
    );
}

function confirmedState(row: VrrpClusterRow): ObservedClusterState {
    return {
        condition: row.condition,
        masterClientId: row.masterClientId,
        masterInstance: row.masterInstance,
        health: row.health,
        reasonsKey: incidentReasonsKey(row.reasons),
    };
}

function durationSeconds(from: string | null, to: string): number | null {
    if (!from) return null;
    const ms = Date.parse(to) - Date.parse(from);
    return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : null;
}

export class ClusterEventService {
    private static startedAt = Date.now();
    private static ready = false;
    private static followUps = new PendingFollowUps();

    /** Wires the evaluation to the two things that change a cluster. */
    static start(): void {
        this.startedAt = Date.now();
        this.ready = false;
        KeepalivedStateService.onReadingStored((clientId) => this.evaluate({ reading: clientId }));
        ProxyService.onConnectionChange((clientId) => this.evaluate({ connection: clientId }));
    }

    /** Compares every cluster with what was confirmed. Never throws into its caller. */
    static evaluate(trigger: Trigger): void {
        try {
            if (!this.isReady()) return;
            this.evaluateAll(takeSnapshot(trigger));
        } catch (err) {
            logger.error({ err }, "Could not evaluate the VRRP clusters");
        }
    }

    /** Whether the agents have had their chance to reconnect since the server started. */
    private static isReady(): boolean {
        if (this.ready) return true;
        const connected = new Set(ProxyService.getConnectedClientIds());
        const everyoneBack = KeepalivedStateService.getAll().every((state) => connected.has(state.clientId));
        if (everyoneBack || Date.now() - this.startedAt >= STARTUP_GRACE_MS) {
            this.ready = true;
            logger.info({ everyoneBack }, "Evaluating VRRP clusters from now on");
        }
        return this.ready;
    }

    private static evaluateAll(snapshot: ClusterSnapshot): void {
        const { clusters, nameOf, readingFrom } = snapshot;
        const stored = new Map(VrrpClusterRepository.findAll().map((row) => [row.clusterKey, row]));

        for (const cluster of clusters) {
            const existing = stored.get(cluster.key);
            const { condition, live, masters, unseenMasters } = clusterCondition(cluster);

            // Who holds the cluster, where anything can be said about it.
            const role: { condition: ConfirmedCondition; master: VrrpClusterMember | null } | null =
                condition === "unknown" || (condition === "no-master" && unseenMasters.length > 0)
                    ? null
                    : { condition, master: condition === "single" ? masters[0] : null };
            const incident = clusterIncidentState(cluster, nameOf);

            let row: VrrpClusterRow = existing ?? {
                clusterKey: cluster.key,
                condition: null,
                masterClientId: null,
                masterInstance: null,
                masterHost: null,
                health: "ok",
                reasons: [],
                incidentId: null,
                openedAt: null,
                history: [],
                lastCluster: null,
                ...noPending,
            };
            // Roles seen for the first time are taken as they are: that is no change.
            if (row.condition === null && role) {
                row = { ...row, condition: role.condition, ...this.masterOf(role.master, row, nameOf) };
            }

            const observed: ObservedClusterState = {
                condition: role ? role.condition : row.condition,
                masterClientId: role?.master ? role.master.clientId : row.masterClientId,
                masterInstance: role?.master ? role.master.instance.name : row.masterInstance,
                health: incident ? incident.health : row.health,
                reasonsKey: incident ? incidentReasonsKey(incident.reasons) : incidentReasonsKey(row.reasons),
            };

            // What was confirmed still holds. A pending change that went away is dropped unsaid.
            if (sameState(confirmedState(row), observed)) {
                if (row !== existing || row.pendingState) VrrpClusterRepository.upsert({ ...row, ...noPending });
                this.followUps.cancel(cluster.key);
                continue;
            }

            const liveKeys = live.map(memberKey);
            if (!sameState(row.pendingState, observed) || !row.pendingSince) {
                // First seen, or changed again while pending. The reading that showed it does
                // not count as its confirmation.
                const since = new Date().toISOString();
                VrrpClusterRepository.upsert({ ...row, pendingState: observed, pendingSince: since, pendingWaiting: liveKeys });
                this.planFollowUp(cluster, observed, since);
                continue;
            }

            // Pending: this reading pays what it owes -- once VRRP has had its time to settle --
            // and a member no longer live owes nothing.
            const settled = Date.now() - Date.parse(row.pendingSince) >= this.minimumAge(cluster, observed);
            const waiting = row.pendingWaiting.filter(
                (key) => liveKeys.includes(key) && !(settled && key.split("\n")[0] === readingFrom),
            );
            if (!settled || waiting.length > 0) {
                VrrpClusterRepository.upsert({ ...row, pendingWaiting: waiting });
                // Planned already, unless the server restarted since.
                this.planFollowUp(cluster, observed, row.pendingSince);
                continue;
            }

            this.followUps.cancel(cluster.key);
            this.confirm(cluster, row, observed, role?.master ?? null, incident?.reasons ?? row.reasons, snapshot);
        }

        const keys = clusters.map((cluster) => cluster.key);
        this.closeRemoved(keys, stored);
        this.followUps.cancelExcept(keys);
        VrrpClusterRepository.deleteExcept(keys);
    }

    /** The master columns for a role: the new master, or the last one where there is none. */
    private static masterOf(master: VrrpClusterMember | null, row: VrrpClusterRow, nameOf: (id: string) => string) {
        return master
            ? { masterClientId: master.clientId, masterInstance: master.instance.name, masterHost: nameOf(master.clientId) }
            : { masterClientId: row.masterClientId, masterInstance: row.masterInstance, masterHost: row.masterHost };
    }

    /** How long a pending state must have lasted before a reading can confirm it. */
    private static minimumAge(cluster: VrrpCluster, state: ObservedClusterState): number {
        return state.health === "unreachable" ? UNREACHABLE_CONFIRM_MS : masterDownMs(cluster);
    }

    /**
     * What makes a pending state count without waiting on chance: once it is old enough, the
     * members it waits for are asked for their readings -- or, where nobody owes one, the
     * clusters are looked at again.
     */
    private static planFollowUp(cluster: VrrpCluster, state: ObservedClusterState, since: string): void {
        this.followUps.schedule(cluster.key, since, this.minimumAge(cluster, state) + READING_REQUEST_MARGIN_MS, () => {
            const row = VrrpClusterRepository.find(cluster.key);
            if (!row || row.pendingSince !== since) return;
            const owed = row.pendingWaiting.map((key) => key.split("\n")[0]);
            if (owed.length > 0) requestReadings(owed);
            else this.evaluate({ recheck: true });
        });
    }

    /**
     * Reports the confirmed change of a cluster -- its roles first, then its health -- and
     * stores the new state. Every event carries the same `cluster`.
     */
    private static confirm(
        cluster: VrrpCluster,
        row: VrrpClusterRow,
        state: ObservedClusterState,
        master: VrrpClusterMember | null,
        reasons: VrrpIncidentReason[],
        snapshot: ClusterSnapshot,
    ): void {
        const now = new Date().toISOString();
        const since = row.pendingSince ?? now;
        const summary = describeCluster(cluster, snapshot);
        const { live, masters } = clusterCondition(cluster);

        // Who holds it.
        if (state.condition === "single" && master) {
            const newHost = row.masterClientId !== master.clientId || row.masterInstance !== master.instance.name;
            if (newHost || row.condition !== "single") {
                // keepalived's own transition time when the master is new. The same host after
                // a split brain or a gap has an old one, and is dated by the change instead.
                this.record("vrrp.master_changed", "info", master.clientId, master.instance.name, cluster, {
                    occurredAt: newHost ? (master.instance.lastTransition ?? since) : since,
                    data: { cluster: summary, previousMaster: row.masterHost },
                });
            }
        } else if (state.condition !== null && state.condition !== "single" && state.condition !== row.condition) {
            // Named by one of the masters, or the one that was master last.
            const about = masters[0] ?? null;
            this.record(
                state.condition === "split-brain" ? "vrrp.split_brain" : "vrrp.master_lost",
                "info",
                about?.clientId ?? row.masterClientId,
                about?.instance.name ?? row.masterInstance,
                cluster,
                { occurredAt: since, data: { cluster: summary, previousMaster: row.masterHost } },
            );
        }

        // How it is doing.
        let incidentId = row.incidentId;
        let openedAt = row.openedAt;
        let history = row.history;
        if (state.health !== row.health || state.reasonsKey !== incidentReasonsKey(row.reasons)) {
            // Named by its master, else any live member, else any member at all.
            const about = masters[0] ?? live[0] ?? cluster.members[0] ?? null;
            const report = (kind: ActivityKind, incident: Record<string, unknown>, id: string) =>
                this.record(kind, kind === "vrrp.incident_resolved" ? "info" : "warning", about?.clientId ?? null,
                    about?.instance.name ?? null, cluster, {
                        occurredAt: since,
                        correlationId: id,
                        data: { cluster: summary, incident: { id, health: state.health, previousHealth: row.health, reasons, ...incident } },
                    });

            if (state.health === "ok") {
                // Recovered. Without an id the row was damaged; there is nothing to close then.
                if (row.incidentId) {
                    report("vrrp.incident_resolved", {
                        history: row.history,
                        openedAt: row.openedAt,
                        confirmedAt: now,
                        resolvedAt: since,
                        durationSeconds: durationSeconds(row.openedAt, since),
                        resolution: "recovered",
                    }, row.incidentId);
                }
                incidentId = null;
                openedAt = null;
                history = [];
            } else if (row.health === "ok" || !row.incidentId) {
                // A row without an id is a damaged one; its incident starts over.
                incidentId = randomUUID();
                openedAt = since;
                history = [state.health];
                report("vrrp.incident_opened", { history, openedAt, confirmedAt: now }, incidentId);
            } else {
                history = row.health === state.health ? row.history : [...row.history, state.health];
                // What is new and what went away since the last event of this incident.
                const before = new Set(row.reasons.map(incidentReasonKey));
                const after = new Set(reasons.map(incidentReasonKey));
                report("vrrp.incident_updated", {
                    added: reasons.filter((r) => !before.has(incidentReasonKey(r))).map((r) => r.text),
                    cleared: row.reasons.filter((r) => !after.has(incidentReasonKey(r))).map((r) => r.text),
                    history,
                    openedAt,
                    confirmedAt: now,
                }, row.incidentId);
            }
        }

        VrrpClusterRepository.upsert({
            ...row,
            condition: state.condition,
            ...this.masterOf(state.condition === "single" ? master : null, row, snapshot.nameOf),
            health: state.health,
            reasons,
            incidentId,
            openedAt,
            history,
            lastCluster: summary,
            ...noPending,
        });
        logger.info(
            { cluster: cluster.vrid, site: cluster.site, condition: state.condition, health: state.health },
            "VRRP cluster state confirmed",
        );
    }

    /**
     * Closes the open incident of a cluster that no longer exists -- a client deleted, a site
     * or network changed -- so no receiver keeps an incident open forever. It carries the
     * cluster as its last confirmation saw it; there is no present state, and no health.
     */
    private static closeRemoved(keys: string[], stored: Map<string, VrrpClusterRow>): void {
        const present = new Set(keys);
        for (const row of stored.values()) {
            if (present.has(row.clusterKey) || !row.incidentId) continue;
            const now = new Date().toISOString();
            const last = row.lastCluster ?? {};
            const members = Array.isArray(last.members) ? (last.members as Record<string, unknown>[]) : [];
            const about = members[0];
            ActivityService.record({
                kind: "vrrp.incident_resolved",
                level: "info",
                clientId: typeof about?.clientId === "string" ? about.clientId : null,
                correlationId: row.incidentId,
                subject: {
                    ...(typeof about?.instanceName === "string" ? { instanceName: about.instanceName } : {}),
                    ...(typeof last.vrid === "number" ? { vrid: last.vrid } : {}),
                },
                data: {
                    cluster: last,
                    incident: {
                        id: row.incidentId,
                        health: null,
                        previousHealth: row.health,
                        reasons: [],
                        history: row.history,
                        openedAt: row.openedAt,
                        confirmedAt: now,
                        resolvedAt: now,
                        durationSeconds: durationSeconds(row.openedAt, now),
                        resolution: "removed",
                    },
                },
            });
            logger.info({ cluster: row.clusterKey }, "VRRP incident closed, the cluster no longer exists");
        }
    }

    private static record(
        kind: ActivityKind,
        level: ActivityLevel,
        clientId: string | null,
        instanceName: string | null,
        cluster: VrrpCluster,
        event: { occurredAt: string; correlationId?: string; data: Record<string, unknown> },
    ): void {
        ActivityService.record({
            kind,
            level,
            clientId,
            occurredAt: event.occurredAt,
            correlationId: event.correlationId ?? null,
            subject: {
                ...(instanceName ? { instanceName } : {}),
                ...(cluster.vrid !== null ? { vrid: cluster.vrid } : {}),
            },
            data: event.data,
        });
        logger.info({ kind, cluster: cluster.vrid, site: cluster.site }, "VRRP cluster event");
    }
}
