import db from "../core/Database.js";

/** A row of the `registration_tokens` table. */
export interface RegistrationTokenRow {
    token: string;
    created_at: string;
    expires_at: string | null;
    used_at: string | null;
    /** Name the client is created under. Null means the agent's hostname is used. */
    display_name: string | null;
    /** Address or network the client is restricted to. Null means the registering address. */
    allowed_ip: string | null;
}

export class TokenRepository {
    static findAll(): RegistrationTokenRow[] {
        return db
            .prepare(
                "SELECT * FROM registration_tokens ORDER BY created_at DESC",
            )
            .all() as RegistrationTokenRow[];
    }

    static findValidByToken(token: string): RegistrationTokenRow | undefined {
        return db
            .prepare(
                "SELECT * FROM registration_tokens WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')",
            )
            .get(token) as RegistrationTokenRow | undefined;
    }

    /**
     * Stores a new registration token together with what the operator already knows about
     * the client it is meant for. Both defaults are optional; null keeps the behaviour the
     * token had before they existed.
     */
    static create(
        token: string,
        expiresAt: string,
        displayName: string | null = null,
        allowedIp: string | null = null,
    ): void {
        db.prepare(
            "INSERT INTO registration_tokens (token, expires_at, display_name, allowed_ip) VALUES (?, ?, ?, ?)",
        ).run(token, expiresAt, displayName, allowedIp);
    }

    static markUsed(token: string): { changes: number } {
        return db
            .prepare(
                "UPDATE registration_tokens SET used_at = datetime('now') WHERE token = ?",
            )
            .run(token);
    }

    static delete(token: string): { changes: number } {
        return db
            .prepare("DELETE FROM registration_tokens WHERE token = ?")
            .run(token);
    }

    /**
     * Removes registration tokens that have become invalid (used or expired)
     * and whose invalidation timestamp is older than the given TTL in days.
     *
     * An invalid token is considered invalidated at COALESCE(used_at, expires_at).
     */
    static cleanupInvalidTokens(ttlDays: number): number {
        const days = Number.isFinite(ttlDays) && ttlDays >= 0 ? Math.floor(ttlDays) : 0;

        const result = db.prepare(`
            DELETE FROM registration_tokens
            WHERE (used_at IS NOT NULL OR expires_at <= datetime('now'))
              AND COALESCE(used_at, expires_at) < datetime('now', ?)
        `).run(`-${days} days`);
        return result.changes;
    }
}
