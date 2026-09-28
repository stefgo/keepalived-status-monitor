import db from "../core/Database.js";

/** A cluster condition the server can confirm. `unknown` is never stored: it confirms nothing. */
export type ConfirmedCondition = "single" | "split-brain" | "no-master";

/** One row of `vrrp_cluster_state` (migration 09), in the shape the service works with. */
export interface VrrpClusterStateRow {
    clusterKey: string;
    condition: ConfirmedCondition;
    masterClientId: string | null;
    masterInstance: string | null;
    masterHost: string | null;
    pendingCondition: ConfirmedCondition | null;
    pendingSince: string | null;
    /** Members (`clientId\ninstance`) whose next reading the pending condition waits for. */
    pendingWaiting: string[];
}

interface Row {
    cluster_key: string;
    condition: string;
    master_client_id: string | null;
    master_instance: string | null;
    master_host: string | null;
    pending_condition: string | null;
    pending_since: string | null;
    pending_waiting: string | null;
}

const CONDITIONS: readonly string[] = ["single", "split-brain", "no-master"];

function waitingColumn(text: string | null): string[] {
    if (!text) return [];
    try {
        const value = JSON.parse(text);
        return Array.isArray(value) ? value.filter((key): key is string => typeof key === "string") : [];
    } catch {
        return [];
    }
}

function fromRow(row: Row): VrrpClusterStateRow | null {
    // A row edited into something unknown is dropped rather than guessed at; the cluster is
    // then seen as new and stored again without an event.
    if (!CONDITIONS.includes(row.condition)) return null;
    return {
        clusterKey: row.cluster_key,
        condition: row.condition as ConfirmedCondition,
        masterClientId: row.master_client_id,
        masterInstance: row.master_instance,
        masterHost: row.master_host,
        pendingCondition: CONDITIONS.includes(row.pending_condition ?? "")
            ? (row.pending_condition as ConfirmedCondition)
            : null,
        pendingSince: row.pending_since,
        pendingWaiting: waitingColumn(row.pending_waiting),
    };
}

export class VrrpClusterStateRepository {
    static findAll(): VrrpClusterStateRow[] {
        const rows = db.prepare("SELECT * FROM vrrp_cluster_state").all() as Row[];
        return rows.map(fromRow).filter((row): row is VrrpClusterStateRow => row !== null);
    }

    static upsert(state: VrrpClusterStateRow): void {
        db.prepare(`
            INSERT INTO vrrp_cluster_state
                (cluster_key, condition, master_client_id, master_instance, master_host,
                 pending_condition, pending_since, pending_waiting, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(cluster_key) DO UPDATE SET
                condition = excluded.condition,
                master_client_id = excluded.master_client_id,
                master_instance = excluded.master_instance,
                master_host = excluded.master_host,
                pending_condition = excluded.pending_condition,
                pending_since = excluded.pending_since,
                pending_waiting = excluded.pending_waiting,
                updated_at = excluded.updated_at
        `).run(
            state.clusterKey,
            state.condition,
            state.masterClientId,
            state.masterInstance,
            state.masterHost,
            state.pendingCondition,
            state.pendingSince,
            state.pendingWaiting.length > 0 ? JSON.stringify(state.pendingWaiting) : null,
            new Date().toISOString(),
        );
    }

    /** Forgets clusters that no longer exist: a client deleted, a site or network changed. */
    static deleteExcept(keys: string[]): void {
        db.prepare("DELETE FROM vrrp_cluster_state WHERE cluster_key NOT IN (SELECT value FROM json_each(?))").run(
            JSON.stringify(keys),
        );
    }
}
