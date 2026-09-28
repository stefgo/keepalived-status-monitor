import type { MigrationContext } from "./context.js";

/**
 * What the server last confirmed about each VRRP cluster, so it can tell a change from a
 * repeat -- across restarts too, or every cluster would be reported anew after each one.
 *
 * One row holds both things the cluster events are about, confirmed together:
 *
 * - Who holds the cluster: `condition` (`single`, `split-brain` or `no-master`; NULL until
 *   anything could be said) and the `master_*` columns, the last host that was master alone.
 *   They stay while there is none, as the "previous master" of the next change.
 * - How it is doing: `health` (the incident health, `ok` while there is no incident),
 *   `reasons` (JSON, the findings behind it) and the open incident (`incident_id`,
 *   `opened_at`, `history`). `last_cluster` is the cluster as the last confirmation saw it,
 *   for the closing event of a cluster that disappears.
 *
 * `pending_*` is a state that has been seen but not yet confirmed: `pending_state` (JSON) is
 * what was seen, `pending_waiting` lists the members (`clientId\ninstance`) whose next reading
 * is still owed.
 *
 * Replaces `vrrp_cluster_state` and `vrrp_cluster_incident`, which kept the two apart and
 * confirmed them twice. Neither was ever released; a database that ran them loses what they
 * held, and the clusters are taken up again without events.
 */
export const migration09 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`
          DROP TABLE IF EXISTS vrrp_cluster_state;
          DROP TABLE IF EXISTS vrrp_cluster_incident;
          DELETE FROM umzug_migrations
            WHERE name IN ('09_vrrp_cluster_state', '10_vrrp_cluster_incident', '11_vrrp_incident_reasons_key');

          CREATE TABLE vrrp_cluster (
            cluster_key      TEXT PRIMARY KEY,
            condition        TEXT,
            master_client_id TEXT,
            master_instance  TEXT,
            master_host      TEXT,
            health           TEXT NOT NULL,
            reasons          TEXT,
            incident_id      TEXT,
            opened_at        TEXT,
            history          TEXT,
            last_cluster     TEXT,
            pending_state    TEXT,
            pending_since    TEXT,
            pending_waiting  TEXT,
            updated_at       TEXT NOT NULL
          );
        `);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`DROP TABLE vrrp_cluster;`);
    },
};
