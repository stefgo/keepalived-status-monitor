/**
 * The schema kasm starts from. It is where docker-instance-manager's migrations 00-16 had
 * brought users, clients, registration tokens and the activity log, without the Docker
 * tables and columns -- a fresh history rather than seventeen steps nobody here ever ran.
 *
 * A migration must not depend on today's code, so the connection-mode literal is spelled
 * out instead of read from CONNECTION_MODE.
 */
export const migration00 = {
    up: async ({ context: db }: { context: any }) => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT,
            auth_methods TEXT DEFAULT 'local',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS clients (
            id TEXT PRIMARY KEY,
            hostname TEXT,
            display_name TEXT,
            auth_token TEXT UNIQUE,
            connection_mode TEXT NOT NULL DEFAULT 'inbound',
            inbound_allowed_ip TEXT,
            inbound_last_ip TEXT,
            outbound_target_address TEXT,
            version TEXT,
            last_seen DATETIME,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS registration_tokens (
            token TEXT PRIMARY KEY,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            used_at DATETIME,
            display_name TEXT,
            allowed_ip TEXT
          );

          CREATE TABLE IF NOT EXISTS activity (
            id             TEXT PRIMARY KEY,
            source         TEXT NOT NULL,
            client_id      TEXT,
            kind           TEXT NOT NULL,
            level          TEXT NOT NULL,
            correlation_id TEXT,
            subject        TEXT,
            data           TEXT,
            occurred_at    TEXT NOT NULL,
            received_at    TEXT NOT NULL,
            seen_by        TEXT NOT NULL DEFAULT '[]'
          );

          CREATE INDEX IF NOT EXISTS activity_corr     ON activity (correlation_id);
          CREATE INDEX IF NOT EXISTS activity_occurred ON activity (occurred_at DESC);
        `);
    },
    down: async ({ context: db }: { context: any }) => {
        db.exec(`
          DROP TABLE IF EXISTS activity;
          DROP TABLE IF EXISTS registration_tokens;
          DROP TABLE IF EXISTS clients;
          DROP TABLE IF EXISTS users;
        `);
    },
};
