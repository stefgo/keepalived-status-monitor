import type { MigrationContext } from "./context.js";

/**
 * The run a scheduler has planned. Until a scheduler has run once, it is the only thing its
 * first run can be placed from after a restart: without it, every start planned the first
 * run one interval ahead again, and a server restarted more often than that never ran it.
 *
 * NULL while the scheduler is switched off, and for every row until its timer next plans.
 */
export const migration06 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`ALTER TABLE scheduler_state ADD COLUMN next_run_at TEXT;`);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`ALTER TABLE scheduler_state DROP COLUMN next_run_at;`);
    },
};
