import type { MigrationContext } from "./context.js";

/**
 * A counter per user that every session token carries as `tv`. A token is honoured only
 * while its `tv` matches the row, so raising the counter ends every session the user has --
 * which a signed JWT cannot do on its own: it stays valid until it expires.
 */
export const migration10 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(
            `ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0`,
        );
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`ALTER TABLE users DROP COLUMN token_version`);
    },
};
