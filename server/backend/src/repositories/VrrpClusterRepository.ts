import type { VrrpIncidentHealth, VrrpIncidentReason } from "@kasm/shared";
import db from "../core/Database.js";

/** A role the server can confirm. `unknown` is never stored: it confirms nothing. */
export type ConfirmedCondition = "single" | "split-brain" | "no-master";

/** What a cluster was seen as, in the terms it is confirmed in. */
export interface ObservedClusterState {
    condition: ConfirmedCondition | null;
    masterClientId: string | null;
    masterInstance: string | null;
    health: VrrpIncidentHealth;
    /** `incidentReasonsKey` of the findings. */
    reasonsKey: string;
}

/** One row of `vrrp_cluster` (migration 09), in the shape the service works with. */
export interface VrrpClusterRow {
    clusterKey: string;
    /** The confirmed role; null until anything could be said about it. */
    condition: ConfirmedCondition | null;
    masterClientId: string | null;
    masterInstance: string | null;
    masterHost: string | null;
    /** The confirmed incident health; anything but `ok` means an incident is open. */
    health: VrrpIncidentHealth;
    reasons: VrrpIncidentReason[];
    incidentId: string | null;
    openedAt: string | null;
    /** Every health the open incident was confirmed in, oldest first. */
    history: VrrpIncidentHealth[];
    /** The `cluster` block of the last confirmation. */
    lastCluster: Record<string, unknown> | null;
    pendingState: ObservedClusterState | null;
    pendingSince: string | null;
    /** Members (`clientId\ninstance`) whose next reading the pending state waits for. */
    pendingWaiting: string[];
}

interface Row {
    cluster_key: string;
    condition: string | null;
    master_client_id: string | null;
    master_instance: string | null;
    master_host: string | null;
    health: string;
    reasons: string | null;
    incident_id: string | null;
    opened_at: string | null;
    history: string | null;
    last_cluster: string | null;
    pending_state: string | null;
    pending_since: string | null;
    pending_waiting: string | null;
}

const CONDITIONS: readonly string[] = ["single", "split-brain", "no-master"];
const HEALTHS: readonly string[] = ["ok", "degraded", "vip-mismatch", "split-brain", "no-master", "unreachable"];

const isCondition = (value: unknown): value is ConfirmedCondition =>
    typeof value === "string" && CONDITIONS.includes(value);
const isHealth = (value: unknown): value is VrrpIncidentHealth => typeof value === "string" && HEALTHS.includes(value);

function parse(text: string | null): unknown {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function list(text: string | null): unknown[] {
    const value = parse(text);
    return Array.isArray(value) ? value : [];
}

function record(text: string | null): Record<string, unknown> | null {
    const value = parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function observed(text: string | null): ObservedClusterState | null {
    const value = record(text);
    if (!value || !isHealth(value.health) || typeof value.reasonsKey !== "string") return null;
    return {
        condition: isCondition(value.condition) ? value.condition : null,
        masterClientId: typeof value.masterClientId === "string" ? value.masterClientId : null,
        masterInstance: typeof value.masterInstance === "string" ? value.masterInstance : null,
        health: value.health,
        reasonsKey: value.reasonsKey,
    };
}

function fromRow(row: Row): VrrpClusterRow | null {
    // A row edited into something unknown is dropped rather than guessed at; the cluster is
    // then seen as new and taken up again without an event.
    if (!isHealth(row.health)) return null;
    return {
        clusterKey: row.cluster_key,
        condition: isCondition(row.condition) ? row.condition : null,
        masterClientId: row.master_client_id,
        masterInstance: row.master_instance,
        masterHost: row.master_host,
        health: row.health,
        reasons: list(row.reasons).filter(
            (reason): reason is VrrpIncidentReason =>
                typeof reason === "object" && reason !== null && typeof (reason as { type?: unknown }).type === "string",
        ),
        incidentId: row.incident_id,
        openedAt: row.opened_at,
        history: list(row.history).filter(isHealth),
        lastCluster: record(row.last_cluster),
        pendingState: observed(row.pending_state),
        pendingSince: row.pending_since,
        pendingWaiting: list(row.pending_waiting).filter((key): key is string => typeof key === "string"),
    };
}

const json = (value: unknown) => (value === null ? null : JSON.stringify(value));

export class VrrpClusterRepository {
    static findAll(): VrrpClusterRow[] {
        const rows = db.prepare("SELECT * FROM vrrp_cluster").all() as Row[];
        return rows.map(fromRow).filter((row): row is VrrpClusterRow => row !== null);
    }

    static find(clusterKey: string): VrrpClusterRow | null {
        const row = db.prepare("SELECT * FROM vrrp_cluster WHERE cluster_key = ?").get(clusterKey) as Row | undefined;
        return row ? fromRow(row) : null;
    }

    static upsert(state: VrrpClusterRow): void {
        db.prepare(`
            INSERT INTO vrrp_cluster
                (cluster_key, condition, master_client_id, master_instance, master_host, health, reasons,
                 incident_id, opened_at, history, last_cluster, pending_state, pending_since, pending_waiting,
                 updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cluster_key) DO UPDATE SET
                condition = excluded.condition,
                master_client_id = excluded.master_client_id,
                master_instance = excluded.master_instance,
                master_host = excluded.master_host,
                health = excluded.health,
                reasons = excluded.reasons,
                incident_id = excluded.incident_id,
                opened_at = excluded.opened_at,
                history = excluded.history,
                last_cluster = excluded.last_cluster,
                pending_state = excluded.pending_state,
                pending_since = excluded.pending_since,
                pending_waiting = excluded.pending_waiting,
                updated_at = excluded.updated_at
        `).run(
            state.clusterKey,
            state.condition,
            state.masterClientId,
            state.masterInstance,
            state.masterHost,
            state.health,
            state.reasons.length > 0 ? JSON.stringify(state.reasons) : null,
            state.incidentId,
            state.openedAt,
            state.history.length > 0 ? JSON.stringify(state.history) : null,
            json(state.lastCluster),
            json(state.pendingState),
            state.pendingSince,
            state.pendingWaiting.length > 0 ? JSON.stringify(state.pendingWaiting) : null,
            new Date().toISOString(),
        );
    }

    /** Forgets clusters that no longer exist: a client deleted, a site or network changed. */
    static deleteExcept(keys: string[]): void {
        db.prepare("DELETE FROM vrrp_cluster WHERE cluster_key NOT IN (SELECT value FROM json_each(?))").run(
            JSON.stringify(keys),
        );
    }
}
