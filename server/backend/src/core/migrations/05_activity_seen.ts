import type { MigrationContext } from "./context.js";

/**
 * Moves the seen state out of the JSON array in `activity.seen_by` into a table of its own.
 *
 * The array could only be changed by reading, parsing and writing back each row, and nothing
 * could ask SQL what a user has not seen. One row per event and user makes marking a single
 * `INSERT OR IGNORE`, and the foreign keys clear the rows away with the event (retention,
 * "Delete all") and with the user -- the array kept the ids of deleted users for good. Those
 * are the ids left behind here.
 */
export const migration05 = {
    up: async ({ context: db }: MigrationContext) => {
        db.transaction(() => {
            db.exec(`
              CREATE TABLE activity_seen (
                activity_id TEXT    NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
                user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
                PRIMARY KEY (activity_id, user_id)
              ) WITHOUT ROWID;
              INSERT OR IGNORE INTO activity_seen (activity_id, user_id)
                SELECT a.id, j.value
                FROM activity a, json_each(a.seen_by) j
                WHERE j.value IN (SELECT id FROM users);
              ALTER TABLE activity DROP COLUMN seen_by;
            `);
        })();
    },
    down: async ({ context: db }: MigrationContext) => {
        db.transaction(() => {
            db.exec(`
              ALTER TABLE activity ADD COLUMN seen_by TEXT NOT NULL DEFAULT '[]';
              UPDATE activity SET seen_by = (
                SELECT json_group_array(s.user_id) FROM activity_seen s WHERE s.activity_id = activity.id
              );
              DROP TABLE activity_seen;
            `);
        })();
    },
};
