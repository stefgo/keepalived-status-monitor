import type { MigrationContext } from "./context.js";

/**
 * The site of a client: the network segment or location the operator put it in. Part of
 * the VRRP cluster key, because a VRID is unique only per segment. Null for every existing
 * client, which keeps the grouping they had.
 */
export const migration02 = {
    up: async ({ context: db }: MigrationContext) => {
        db.exec(`ALTER TABLE clients ADD COLUMN site TEXT;`);
    },
    down: async ({ context: db }: MigrationContext) => {
        db.exec(`ALTER TABLE clients DROP COLUMN site;`);
    },
};
