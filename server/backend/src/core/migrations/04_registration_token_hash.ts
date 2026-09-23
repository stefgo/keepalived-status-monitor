import crypto from "crypto";
import type { MigrationContext } from "./context.js";

/**
 * Registration tokens are kept as their SHA-256 hash, not in the clear: the value is shown
 * once when it is issued, and the server only has to recognise it again. Existing rows are
 * hashed in place, so a token issued before the upgrade still registers its agent.
 *
 * The hash cannot be turned back, so `down` drops the rows it cannot restore.
 */
export const migration04 = {
    up: async ({ context: db }: MigrationContext) => {
        db.transaction(() => {
            db.exec(`ALTER TABLE registration_tokens RENAME COLUMN token TO token_hash;`);
            const rows = db
                .prepare("SELECT token_hash FROM registration_tokens")
                .all() as { token_hash: string }[];
            const update = db.prepare(
                "UPDATE registration_tokens SET token_hash = ? WHERE token_hash = ?",
            );
            for (const { token_hash: token } of rows) {
                update.run(crypto.createHash("sha256").update(token, "utf8").digest("hex"), token);
            }
        })();
    },
    down: async ({ context: db }: MigrationContext) => {
        db.transaction(() => {
            db.exec(`DELETE FROM registration_tokens;`);
            db.exec(`ALTER TABLE registration_tokens RENAME COLUMN token_hash TO token;`);
        })();
    },
};
