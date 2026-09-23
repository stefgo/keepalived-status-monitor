import db from "../core/Database.js";
import { ActivityEvent, ActivityLevel, ActivityRecord, ActivitySource } from "@kasm/shared";

interface ActivityRow {
    id: string;
    source: string;
    client_id: string | null;
    kind: string;
    level: string;
    correlation_id: string | null;
    subject: string | null;
    data: string | null;
    occurred_at: string;
    received_at: string;
    /** Not a column: the JSON array `SELECT_RECORD` builds out of `activity_seen`. */
    seen_by: string;
}

/** An event with the ids of the users who have seen it, as `rowToRecord` reads it. */
const SELECT_RECORD = `
    SELECT a.*,
        (SELECT json_group_array(s.user_id) FROM activity_seen s WHERE s.activity_id = a.id) AS seen_by
    FROM activity a`;

function rowToRecord(row: ActivityRow): ActivityRecord {
    return {
        id: row.id,
        source: row.source as ActivitySource,
        clientId: row.client_id,
        kind: row.kind,
        level: row.level as ActivityLevel,
        correlationId: row.correlation_id,
        subject: row.subject ? JSON.parse(row.subject) : null,
        data: row.data ? JSON.parse(row.data) : null,
        occurredAt: row.occurred_at,
        receivedAt: row.received_at,
        seenBy: JSON.parse(row.seen_by),
    };
}

export class ActivityRepository {
    /** Newest first by the originator's clock -- see `ActivityRecord` on the two times. */
    static list(): ActivityRecord[] {
        const rows = db
            .prepare(`${SELECT_RECORD} ORDER BY a.occurred_at DESC`)
            .all() as ActivityRow[];
        return rows.map(rowToRecord);
    }

    /**
     * Stores a batch under the ids their originator gave them, and returns the records as
     * they now stand. Delivery is at-least-once, so a repeat is expected rather than an
     * error: `ON CONFLICT DO NOTHING` makes the second copy a no-op, and the caller still
     * gets the id back so the sender can stop offering it.
     *
     * One transaction: a batch is what an agent handed over in one go, and half of it
     * stored with the other half rolled back would be acknowledged as a whole.
     */
    static insertMany(events: ActivityEvent[], receivedAt: string): ActivityRecord[] {
        const stmt = db.prepare(`
            INSERT INTO activity
                (id, source, client_id, kind, level, correlation_id, subject, data, occurred_at, received_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
        `);
        const insert = db.transaction((batch: ActivityEvent[]) => {
            for (const event of batch) {
                stmt.run(
                    event.id,
                    event.source,
                    event.clientId ?? null,
                    event.kind,
                    event.level,
                    event.correlationId ?? null,
                    event.subject ? JSON.stringify(event.subject) : null,
                    event.data ? JSON.stringify(event.data) : null,
                    event.occurredAt,
                    receivedAt,
                );
            }
        });
        insert(events);

        const ids = JSON.stringify(events.map((e) => e.id));
        const rows = db
            .prepare(`${SELECT_RECORD} WHERE a.id IN (SELECT value FROM json_each(?))`)
            .all(ids) as ActivityRow[];
        return rows.map(rowToRecord);
    }

    /**
     * Marks the given events seen by `userId`; ids that are not there are skipped. Returns
     * how many events were not seen by that user before.
     *
     * One statement. The ids go in as a single JSON parameter, so the length of the list is
     * bounded by the request body, not by SQLite's limit on bound variables. A user deleted
     * while their session is still valid marks nothing instead of failing the foreign key.
     */
    static markManySeen(ids: string[], userId: number): number {
        return db
            .prepare(`
                INSERT OR IGNORE INTO activity_seen (activity_id, user_id)
                SELECT a.id, u.id
                FROM activity a, users u
                WHERE a.id IN (SELECT value FROM json_each(?)) AND u.id = ?
            `)
            .run(JSON.stringify(ids), userId).changes;
    }

    static deleteAll(): void {
        db.prepare("DELETE FROM activity").run();
    }

    static count(): number {
        const row = db.prepare("SELECT COUNT(*) as c FROM activity").get() as { c: number };
        return row.c;
    }

    /**
     * Removes events older than ttlDays while keeping at least minKeep of the most recent
     * ones. Age is the event's own `occurred_at`, not when it reached the server: a batch
     * handed over after a week offline is a week old, whatever its arrival time says.
     */
    static cleanupOld(ttlDays: number, minKeep: number): number {
        const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString();

        const anchor = db
            .prepare("SELECT occurred_at FROM activity ORDER BY occurred_at DESC LIMIT 1 OFFSET ?")
            .get(Math.max(0, minKeep - 1)) as { occurred_at: string } | undefined;

        let sql = "DELETE FROM activity WHERE occurred_at < ?";
        const params: string[] = [cutoff];

        if (anchor) {
            sql += " AND occurred_at < ?";
            params.push(anchor.occurred_at);
        }

        return db.prepare(sql).run(...params).changes;
    }
}
