import type { MigrationContext } from "./context.js";

/**
 * The registration token becomes a property of the client it registers. An inbound client
 * is created when its token is issued and waits for its agent; the token's hash and expiry
 * sit on that row and are cleared once an agent has registered with it. The same two
 * columns let an agent be registered anew under a client that already has one.
 *
 * `registration_tokens` goes, and with it the list, the retention setting and the cleanup
 * job: a token used up or replaced leaves nothing behind to clean. Tokens still open at the
 * upgrade are dropped -- they were valid for 30 minutes at most.
 *
 * `down` cannot give a waiting client back its token, so it removes the clients that never
 * registered, and the table comes back empty.
 */
export const migration12 = {
    up: async ({ context: db }: MigrationContext) => {
        db.transaction(() => {
            db.exec(`
                ALTER TABLE clients ADD COLUMN registration_token_hash TEXT;
                ALTER TABLE clients ADD COLUMN registration_expires_at DATETIME;
                CREATE UNIQUE INDEX idx_clients_registration_token_hash
                    ON clients(registration_token_hash);
                DROP TABLE IF EXISTS registration_tokens;
                DELETE FROM scheduler_state WHERE scheduler = 'token-cleanup';
            `);
        })();
    },
    down: async ({ context: db }: MigrationContext) => {
        db.transaction(() => {
            db.exec(`
                DELETE FROM clients WHERE connection_mode = 'inbound' AND auth_token IS NULL;
                DROP INDEX IF EXISTS idx_clients_registration_token_hash;
                ALTER TABLE clients DROP COLUMN registration_expires_at;
                ALTER TABLE clients DROP COLUMN registration_token_hash;
                CREATE TABLE IF NOT EXISTS registration_tokens (
                    token_hash TEXT PRIMARY KEY,
                    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    expires_at DATETIME,
                    used_at DATETIME,
                    display_name TEXT,
                    allowed_ip TEXT
                );
            `);
        })();
    },
};
