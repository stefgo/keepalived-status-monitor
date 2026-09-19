import fs from "fs";
import path from "path";
import { KeepalivedStatus, VrrpInstance } from "@kasm/shared";
import { logger } from "@kasm/shared/node";
import { config } from "../core/Config.js";
import { readJsonFile, writeJsonFile } from "../core/DataStore.js";
import { ActivityService } from "./ActivityService.js";
import { ParsedDump } from "./parsers/common.js";
import { parseDataDump } from "./parsers/dataDump.js";
import { parseJsonDump } from "./parsers/jsonDump.js";
import { parseStatsDump } from "./parsers/statsDump.js";

/**
 * The host's process table. The agent runs with `pid: host`, so this is the host's view;
 * `KASM_PROC_DIR` points it elsewhere for a test against a copied tree.
 */
const PROC_DIR = process.env.KASM_PROC_DIR?.trim() || "/proc";

/** The last reading, kept on disk so a restart can still tell what changed while it was away. */
const LAST_STATUS_FILE = "keepalived-last.json";

/**
 * A reading goes to the server when it differs from the last one sent, or after this long
 * anyway. Counters move with every advertisement, and sending each 5-second reading because
 * of them would be a broadcast to every dashboard for nothing anyone looks at that often.
 */
const RESEND_AFTER_MS = 30_000;

/** How often the dump file is checked for a new version after the signal. */
const DUMP_POLL_MS = 50;

type Listener = (status: KeepalivedStatus) => void;

/**
 * Reads keepalived's state, on a timer and on request.
 *
 * keepalived has no status API. It writes its state to a file when it receives a signal:
 * SIGUSR1 for the data dump, SIGUSR2 for the counters, a real-time signal for JSON. The agent
 * sends that signal to keepalived's parent process, waits for the file to be rewritten and
 * reads it through `/proc/<pid>/root` -- that path is keepalived's own view of the file
 * system, so a systemd `PrivateTmp=true` changes nothing. It needs `pid: host`, and the
 * capabilities KILL (signal a process of another user) and SYS_PTRACE (read another
 * process's root).
 */
export class KeepalivedService {
    private static current: KeepalivedStatus | null = null;
    private static lastSent: { at: number; signature: string } | null = null;
    private static inFlight: Promise<KeepalivedStatus> | null = null;
    private static timer: NodeJS.Timeout | null = null;
    private static listener: Listener | null = null;
    /** keepalived's version, read once per process out of its binary. */
    private static versionCache: { pid: number; version: string | null } | null = null;

    /** The most recent reading, or null before the first one has finished. */
    static latest(): KeepalivedStatus | null {
        return this.current;
    }

    /** Starts the poll loop. `listener` receives every reading worth sending. */
    static start(listener: Listener): void {
        this.listener = listener;
        if (this.timer) return;
        const loop = async () => {
            await this.poll(false);
            this.timer = setTimeout(loop, config.keepalived.pollInterval * 1000);
            this.timer.unref?.();
        };
        void loop();
    }

    /** Reads now and hands the result on regardless of whether anything changed. */
    static async refresh(): Promise<KeepalivedStatus> {
        return this.poll(true);
    }

    /**
     * One reading. Concurrent callers share it: a REQUEST_STATE_UPDATE that lands while the
     * timer's reading is still waiting for its dump would otherwise signal keepalived twice.
     */
    private static poll(force: boolean): Promise<KeepalivedStatus> {
        if (!this.inFlight) {
            this.inFlight = this.read().finally(() => {
                this.inFlight = null;
            });
        }
        return this.inFlight.then((status) => {
            this.publish(status, force);
            return status;
        });
    }

    private static publish(status: KeepalivedStatus, force: boolean): void {
        const signature = signatureOf(status);
        const now = Date.now();
        const due =
            force ||
            !this.lastSent ||
            this.lastSent.signature !== signature ||
            now - this.lastSent.at >= RESEND_AFTER_MS;
        if (!due) return;
        this.lastSent = { at: now, signature };
        this.listener?.(status);
    }

    /** Marks everything as unsent, so the next reading goes out -- after a reconnect. */
    static resetSent(): void {
        this.lastSent = null;
    }

    private static async read(): Promise<KeepalivedStatus> {
        const collectedAt = new Date().toISOString();
        const pid = findKeepalivedPid();

        let status: KeepalivedStatus;
        if (pid === null) {
            status = {
                running: false,
                pid: null,
                version: null,
                source: null,
                collectedAt,
                error: null,
                instances: [],
                syncGroups: [],
            };
        } else {
            try {
                status = await this.readDumps(pid, collectedAt);
            } catch (err) {
                const message = describeError(err);
                logger.warn({ pid, err: message }, "Could not read keepalived's state");
                status = {
                    running: true,
                    pid,
                    version: this.versionOf(pid),
                    source: null,
                    collectedAt,
                    error: message,
                    instances: [],
                    syncGroups: [],
                };
            }
        }

        const previous = this.current ?? loadLastStatus();
        reportChanges(previous, status);
        this.current = status;
        writeJsonFile(LAST_STATUS_FILE, status);
        return status;
    }

    private static async readDumps(pid: number, collectedAt: string): Promise<KeepalivedStatus> {
        const settings = config.keepalived;
        const useJson = settings.jsonSignal !== null && settings.jsonSignal !== undefined;

        // Both signals at once: keepalived handles them one after the other anyway, and
        // waiting for each in turn would double the time a reading takes.
        const [main, statsText] = await Promise.all([
            useJson
                ? signalAndRead(pid, settings.jsonSignal as number, settings.jsonFile)
                : signalAndRead(pid, "SIGUSR1", settings.dataFile),
            signalAndRead(pid, "SIGUSR2", settings.statsFile).catch((err) => {
                // The counters are a bonus; a reading without them is still a reading.
                logger.debug({ err: describeError(err) }, "No keepalived stats dump");
                return null;
            }),
        ]);

        let dump: ParsedDump;
        const stats = statsText ? parseStatsDump(statsText) : new Map<string, Record<string, number>>();
        if (useJson) {
            const parsed = parseJsonDump(main);
            dump = parsed.dump;
            // The JSON dump carries its own counters; the text ones fill in where it does not.
            for (const [name, counters] of parsed.stats) stats.set(name, { ...stats.get(name), ...counters });
        } else {
            dump = parseDataDump(main);
        }

        const instances: VrrpInstance[] = dump.instances.map((instance) => ({
            ...instance,
            stats: stats.get(instance.name) ?? null,
        }));

        return {
            running: true,
            pid,
            version: this.versionOf(pid),
            source: useJson ? "json" : "data",
            collectedAt,
            error: null,
            instances,
            syncGroups: dump.syncGroups.map((group) => ({ ...group })),
        };
    }

    /**
     * keepalived prints its version only when run with `-v`, which the agent cannot do -- the
     * binary belongs to the host and may not even run here. The string is in the binary,
     * though, and reading it once per process is cheap.
     */
    private static versionOf(pid: number): string | null {
        if (this.versionCache?.pid === pid) return this.versionCache.version;
        let version: string | null = null;
        try {
            const binary = fs.readFileSync(path.join(PROC_DIR, String(pid), "exe"));
            const match = /Keepalived v(\d+\.\d+(?:\.\d+)?)/.exec(binary.toString("latin1"));
            version = match ? match[1] : null;
        } catch (err) {
            logger.debug({ pid, err: describeError(err) }, "Could not read keepalived's binary");
        }
        this.versionCache = { pid, version };
        return version;
    }
}

/**
 * The PID of keepalived's parent process: the one `keepalived` whose own parent is not a
 * `keepalived`. Its children (VRRP, checker) handle the dumps, but the parent is the one that
 * forwards the signals and the one that survives a child being restarted.
 */
function findKeepalivedPid(): number | null {
    let entries: string[];
    try {
        entries = fs.readdirSync(PROC_DIR);
    } catch {
        return null;
    }

    const candidates = new Map<number, number>();
    for (const entry of entries) {
        if (!/^\d+$/.test(entry)) continue;
        try {
            const comm = fs.readFileSync(path.join(PROC_DIR, entry, "comm"), "utf-8").trim();
            if (comm !== "keepalived") continue;
            const status = fs.readFileSync(path.join(PROC_DIR, entry, "status"), "utf-8");
            const ppid = Number(/^PPid:\s*(\d+)/m.exec(status)?.[1] ?? 0);
            candidates.set(Number(entry), ppid);
        } catch {
            // The process ended between readdir and read.
        }
    }

    const parents = [...candidates.entries()]
        .filter(([, ppid]) => !candidates.has(ppid))
        .map(([pid]) => pid)
        .sort((a, b) => a - b);
    if (parents.length > 1) {
        logger.debug({ parents }, "Several keepalived parents found, using the lowest PID");
    }
    return parents[0] ?? null;
}

/**
 * Sends one signal and waits for keepalived to rewrite the file it answers with. "Rewritten"
 * means a newer mtime than before the signal and a size that has stopped changing -- a read
 * in the middle of the write would parse half a dump.
 */
async function signalAndRead(pid: number, signal: NodeJS.Signals | number, file: string): Promise<string> {
    const target = path.join(PROC_DIR, String(pid), "root", file);
    const before = statOrNull(target)?.mtimeMs ?? 0;

    process.kill(pid, signal);

    const deadline = Date.now() + config.keepalived.dumpTimeoutMs;
    let lastSize = -1;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, DUMP_POLL_MS));
        const stat = statOrNull(target);
        if (!stat || stat.mtimeMs <= before) continue;
        if (stat.size === lastSize && stat.size > 0) return fs.readFileSync(target, "utf-8");
        lastSize = stat.size;
    }
    throw new Error(`keepalived did not write ${file} within ${config.keepalived.dumpTimeoutMs} ms`);
}

function statOrNull(file: string): fs.Stats | null {
    try {
        return fs.statSync(file);
    } catch {
        return null;
    }
}

/** A message an operator can act on: the two permission errors name what is missing. */
function describeError(err: unknown): string {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "EPERM") return "Not permitted to signal keepalived (capability KILL missing?)";
    if (code === "EACCES") return "Not permitted to read keepalived's files (capability SYS_PTRACE missing?)";
    return err instanceof Error ? err.message : String(err);
}

/** What makes two readings different, without the counters and the time they were taken. */
function signatureOf(status: KeepalivedStatus): string {
    return JSON.stringify({
        ...status,
        collectedAt: undefined,
        instances: status.instances.map((instance) => ({ ...instance, stats: undefined })),
    });
}

function loadLastStatus(): KeepalivedStatus | null {
    const stored = readJsonFile(LAST_STATUS_FILE) as KeepalivedStatus | null;
    return stored && typeof stored === "object" && Array.isArray(stored.instances) ? stored : null;
}

/**
 * Turns the difference between two readings into activity events. Without a previous
 * reading -- a first start -- there is nothing to compare, and reporting every instance as
 * new would bury the list under events that describe no change.
 */
function reportChanges(previous: KeepalivedStatus | null, current: KeepalivedStatus): void {
    if (!previous) return;

    if (!previous.running && current.running) {
        ActivityService.report({
            kind: "keepalived.started",
            level: "info",
            data: { pid: current.pid, version: current.version },
        });
    } else if (previous.running && !current.running) {
        ActivityService.report({
            kind: "keepalived.stopped",
            level: "warning",
            data: { pid: previous.pid },
        });
        return;
    }

    if (current.error) {
        if (!previous.error) {
            ActivityService.report({
                kind: "keepalived.unreadable",
                level: "error",
                data: { error: current.error },
            });
        }
        return;
    }
    // After a gap -- stopped or unreadable -- the previous instances say nothing about now.
    if (!previous.running || previous.error) return;

    const before = new Map(previous.instances.map((instance) => [instance.name, instance]));
    const after = new Map(current.instances.map((instance) => [instance.name, instance]));

    for (const [name, instance] of after) {
        const subject = {
            instanceName: name,
            vrid: instance.vrid ?? undefined,
            interface: instance.interface ?? undefined,
        };
        const old = before.get(name);
        if (!old) {
            ActivityService.report({
                kind: "vrrp.instance_added",
                level: "info",
                subject,
                data: { state: instance.state },
            });
            continue;
        }
        if (old.state !== instance.state) {
            ActivityService.report({
                kind: "vrrp.state_changed",
                level:
                    instance.state === "FAULT"
                        ? "error"
                        : old.state === "MASTER"
                          ? "warning"
                          : "info",
                // keepalived knows when it happened; the reading may be seconds later.
                occurredAt: instance.lastTransition ?? undefined,
                subject,
                data: {
                    from: old.state,
                    to: instance.state,
                    priority: instance.priority,
                    effectivePriority: instance.effectivePriority,
                },
            });
        }
    }

    for (const [name, instance] of before) {
        if (after.has(name)) continue;
        ActivityService.report({
            kind: "vrrp.instance_removed",
            level: "info",
            subject: {
                instanceName: name,
                vrid: instance.vrid ?? undefined,
                interface: instance.interface ?? undefined,
            },
            data: { state: instance.state },
        });
    }
}
