import type { MigrationContext } from "./context.js";

/**
 * The targets events are reported to. `headers` and `kinds` are JSON; `body_template` is the
 * operator's text as written, checked on save and parsed on every delivery. The last three
 * `last_*` columns are the only record of how deliveries go: a failure is not an activity
 * event, or a broken target would report its own failures to itself.
 */
export const migration08 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          CREATE TABLE webhooks (
            id              TEXT    PRIMARY KEY,
            name            TEXT    NOT NULL,
            enabled         INTEGER NOT NULL DEFAULT 1,
            url             TEXT    NOT NULL,
            method          TEXT    NOT NULL DEFAULT 'POST',
            headers         TEXT    NOT NULL DEFAULT '{}',
            body_template   TEXT    NOT NULL,
            min_level       TEXT    NOT NULL DEFAULT 'warning',
            kinds           TEXT    NOT NULL DEFAULT '[]',
            timeout_ms      INTEGER NOT NULL DEFAULT 10000,
            last_status     INTEGER,
            last_error      TEXT,
            last_attempt_at TEXT,
            created_at      TEXT    NOT NULL,
            updated_at      TEXT
          );
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`DROP TABLE webhooks;`);
    },
};
