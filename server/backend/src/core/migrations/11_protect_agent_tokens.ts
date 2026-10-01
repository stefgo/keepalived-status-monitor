import crypto from "crypto";
import type { MigrationContext } from "./context.js";
import { decryptSecret, encryptSecret } from "../../services/SecretCrypto.js";

function sha256(value: string): string {
    return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * No agent auth token stays in the database in the clear:
 *
 * - An inbound client's token becomes its SHA-256 hash. The server only has to recognise
 *   the token an agent presents -- the same reasoning as migration 04 for the registration
 *   tokens. Agents keep their token and connect as before.
 * - An outbound client's token is encrypted instead: the server presents it itself when it
 *   dials the agent, so it has to get the value back.
 *
 * The encryption uses `secretKey` from config.yaml, which lives outside the data volume.
 * encryptSecret() refuses while that key exists only in memory, so a server that cannot
 * write its config fails here, with the database untouched, instead of encrypting with a
 * key that is gone after the restart.
 *
 * `down` decrypts the outbound tokens. The hashes cannot be turned back, so inbound clients
 * lose their token and have to be registered again.
 */
export const migration11 = {
    up: async ({ context: db }: MigrationContext) => {
        db.transaction(() => {
            const clients = db
                .prepare(
                    "SELECT id, connection_mode, auth_token FROM clients WHERE auth_token IS NOT NULL",
                )
                .all() as { id: string; connection_mode: string; auth_token: string }[];
            const update = db.prepare("UPDATE clients SET auth_token = ? WHERE id = ?");
            for (const client of clients) {
                update.run(
                    client.connection_mode === "outbound"
                        ? encryptSecret(client.auth_token)
                        : sha256(client.auth_token),
                    client.id,
                );
            }
        })();
    },
    down: async ({ context: db }: MigrationContext) => {
        db.transaction(() => {
            db.exec(
                "UPDATE clients SET auth_token = NULL WHERE connection_mode != 'outbound'",
            );
            const clients = db
                .prepare(
                    "SELECT id, auth_token FROM clients WHERE connection_mode = 'outbound' AND auth_token IS NOT NULL",
                )
                .all() as { id: string; auth_token: string }[];
            const update = db.prepare("UPDATE clients SET auth_token = ? WHERE id = ?");
            for (const client of clients) {
                update.run(decryptSecret(client.auth_token), client.id);
            }
        })();
    },
};
