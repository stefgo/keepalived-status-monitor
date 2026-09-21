import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "@kasm/shared/node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../../");

/**
 * Where the agent keeps what it has to survive a restart -- its last keepalived reading and
 * the activity events nobody has acknowledged yet.
 *
 * Deliberately *not* next to `config.yaml`. In a container that file is a single bind mount,
 * so anything written beside it lands in the container's own filesystem and is gone with the
 * next recreate. This directory is a named volume
 * (`compose.yaml`), and `KASM_CLIENT_DATA_DIR` moves it for an agent that runs outside one.
 */
export const DATA_DIR =
    process.env.KASM_CLIENT_DATA_DIR?.trim() || path.resolve(ROOT_DIR, "data");

function pathOf(name: string): string {
    return path.join(DATA_DIR, name);
}

/**
 * Reads one file as JSON. A file that is missing, unreadable or not JSON answers `null`:
 * none of this is state worth refusing to start over, and an agent that will not come up
 * because of its own scratch file is the worse failure -- it is the connection the operator
 * would fix it over. The caller validates the shape; this only guarantees it is JSON.
 */
export function readJsonFile(name: string): unknown | null {
    const file = pathOf(name);
    try {
        if (!fs.existsSync(file)) return null;
        return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (err) {
        logger.warn({ err, file }, "Discarding an unreadable data file");
        return null;
    }
}

/**
 * Writes one file as JSON, atomically: a temporary file next to the target, then a rename.
 * A plain write that is cut short -- the host losing power mid-update is exactly the
 * situation this state exists for -- would leave half a file behind, and rename is the one
 * operation the filesystem gives us that cannot.
 *
 * Answers whether it worked. The two callers that write scratch state ignore that -- a lost
 * reading is taken again -- while the identity has to know, because a registration nobody
 * could save is one the operator has to be told about.
 */
export function writeJsonFile(name: string, value: unknown): boolean {
    const file = pathOf(name);
    const temp = `${file}.tmp`;
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(temp, JSON.stringify(value, null, 4));
        fs.renameSync(temp, file);
        return true;
    } catch (err) {
        logger.error({ err, file }, "Failed to write a data file");
        try {
            fs.rmSync(temp, { force: true });
        } catch {
            // Nothing left to do about it; the next write overwrites the leftover.
        }
        return false;
    }
}
