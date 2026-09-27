import db from "../core/Database.js";

/**
 * A row of `keepalived_state` (migrations 01 and 07). `status` is the agent's reading as
 * JSON, `last_instances` the instances of its last reading that had any.
 */
export interface KeepalivedStateRow {
    client_id: string;
    status: string;
    received_at: string;
    last_instances: string | null;
}

export class KeepalivedStateRepository {
    static findAll(): KeepalivedStateRow[] {
        return db.prepare("SELECT * FROM keepalived_state").all() as KeepalivedStateRow[];
    }

    static findByClientId(clientId: string): KeepalivedStateRow | undefined {
        return db
            .prepare("SELECT * FROM keepalived_state WHERE client_id = ?")
            .get(clientId) as KeepalivedStateRow | undefined;
    }

    static upsert(clientId: string, status: string, receivedAt: string, lastInstances: string | null): void {
        db.prepare(
            `INSERT INTO keepalived_state (client_id, status, received_at, last_instances) VALUES (?, ?, ?, ?)
             ON CONFLICT(client_id) DO UPDATE SET status = excluded.status, received_at = excluded.received_at,
                last_instances = excluded.last_instances`,
        ).run(clientId, status, receivedAt, lastInstances);
    }

    /**
     * Called when a client is deleted. The foreign key cascades already -- better-sqlite3 is
     * built with SQLITE_DEFAULT_FOREIGN_KEYS=1 -- so this only keeps the delete from resting
     * on a compile-time default of the driver.
     */
    static delete(clientId: string): void {
        db.prepare("DELETE FROM keepalived_state WHERE client_id = ?").run(clientId);
    }
}
