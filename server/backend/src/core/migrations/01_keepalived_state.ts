import type { MigrationContext } from "./context.js";

/**
 * The last keepalived reading per client, as one JSON document. Kept so a dashboard opened
 * after a server restart shows the fleet at once instead of waiting for every agent's next
 * reading -- and so an agent that is offline still shows what it last reported.
 */
export const migration01 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS keepalived_state (
            client_id   TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
            status      TEXT NOT NULL,
            received_at TEXT NOT NULL
          );
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`DROP TABLE IF EXISTS keepalived_state;`);
    },
};
