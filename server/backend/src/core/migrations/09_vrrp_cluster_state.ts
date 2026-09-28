import type { MigrationContext } from "./context.js";

/**
 * What the server last confirmed about each VRRP cluster, so it can tell a change from a
 * repeat -- across restarts too, or every cluster would be reported anew after each one.
 *
 * `condition` is the confirmed one: `single`, `split-brain` or `no-master`. The `master_*`
 * columns keep the last host that was master alone, also while the cluster has none, since
 * that is the "previous master" of the next change. `pending_*` is a split brain or a missing
 * master that has been seen but not yet confirmed: `pending_waiting` lists the members
 * (`clientId\ninstance`) whose next reading is still owed.
 */
export const migration09 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          CREATE TABLE vrrp_cluster_state (
            cluster_key       TEXT PRIMARY KEY,
            condition         TEXT NOT NULL,
            master_client_id  TEXT,
            master_instance   TEXT,
            master_host       TEXT,
            pending_condition TEXT,
            pending_since     TEXT,
            pending_waiting   TEXT,
            updated_at        TEXT NOT NULL
          );
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`DROP TABLE vrrp_cluster_state;`);
    },
};
