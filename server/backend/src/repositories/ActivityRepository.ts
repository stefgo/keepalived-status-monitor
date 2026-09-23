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
    seen_by: string;
}

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
            .prepare("SELECT * FROM activity ORDER BY occurred_at DESC")
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
                (id, source, client_id, kind, level, correlation_id, subject, data, occurred_at, received_at, seen_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')
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

        const ids = events.map((e) => e.id);
        const placeholders = ids.map(() => "?").join(", ");
        const rows = db
            .prepare(`SELECT * FROM activity WHERE id IN (${placeholders})`)
            .all(...ids) as ActivityRow[];
        return rows.map(rowToRecord);
    }

    /** Marks the given events seen by `userId`; ids that are not there are skipped. */
    static markManySeen(ids: string[], userId: number): void {
        const placeholders = ids.map(() => "?").join(",");
        const rows = db
            .prepare(`SELECT id, seen_by FROM activity WHERE id IN (${placeholders})`)
            .all(...ids) as {
            id: string;
            seen_by: string;
        }[];
        const stmt = db.prepare("UPDATE activity SET seen_by = ? WHERE id = ?");
        const update = db.transaction(() => {
            for (const row of rows) {
                const seenBy: number[] = JSON.parse(row.seen_by);
                if (!seenBy.includes(userId)) {
                    seenBy.push(userId);
                    stmt.run(JSON.stringify(seenBy), row.id);
                }
            }
        });
        update();
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
