import type { MigrationContext } from "./context.js";

/**
 * One row per scheduler: the run in progress, the last run it finished, and what it has to
 * remember from one run to the next. Written over on every run -- there is no history. What
 * is worth looking back on, a run that failed or was cut short, goes to the activity list.
 *
 * `running_*` is set while a run is in progress and cleared when it ends, so `last_*` always
 * describes a finished run and the page keeps showing it during a long sweep. A row still
 * carrying `running_since` at startup belongs to a run the server did not live to finish.
 */
export const migration03 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          CREATE TABLE scheduler_state (
            scheduler        TEXT PRIMARY KEY,
            running_since    TEXT,
            running_trigger  TEXT,
            last_started_at  TEXT,
            last_finished_at TEXT,
            last_trigger     TEXT,
            last_status      TEXT,
            last_result      TEXT,
            last_error       TEXT,
            state            TEXT
          );
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`DROP TABLE IF EXISTS scheduler_state`);
    },
};
