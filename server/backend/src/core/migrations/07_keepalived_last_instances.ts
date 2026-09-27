import type { MigrationContext } from "./context.js";

/**
 * The instances of a client's last reading that had any, as JSON. A reading of a stopped or
 * unreadable keepalived carries none, and without this column it overwrote the only record
 * of which clusters the host belongs to -- the host dropped out of them.
 *
 * NULL until a reading with instances arrives, and again once keepalived runs, is readable
 * and has none configured.
 */
export const migration07 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`ALTER TABLE keepalived_state ADD COLUMN last_instances TEXT;`);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`ALTER TABLE keepalived_state DROP COLUMN last_instances;`);
    },
};
