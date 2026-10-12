import fs from "fs";
import path from "path";

/**
 * What the agent sees of the process table it looks for keepalived in. A reading that finds
 * no keepalived is `running: false` either way; this is what tells a host without keepalived
 * from an agent that cannot see the host.
 */
export type ProcView =
    | { readable: false; error: string }
    | {
          readable: true;
          /** How many processes are visible. */
          processes: number;
          /**
           * Whether this is the host's process table. PID 2 is `kthreadd` on every Linux host,
           * and a container with a PID namespace of its own never sees a kernel thread.
           */
          hostProcesses: boolean;
      };

export interface StartupFinding {
    level: "info" | "warn" | "error";
    message: string;
}

export function readProcView(procDir: string): ProcView {
    let entries: string[];
    try {
        entries = fs.readdirSync(procDir);
    } catch (err) {
        return { readable: false, error: err instanceof Error ? err.message : String(err) };
    }

    let hostProcesses = false;
    try {
        hostProcesses = fs.readFileSync(path.join(procDir, "2", "comm"), "utf-8").trim() === "kthreadd";
    } catch {
        // No PID 2, or not readable: not the host's process table.
    }
    return {
        readable: true,
        processes: entries.filter((entry) => /^\d+$/.test(entry)).length,
        hostProcesses,
    };
}

/**
 * What the agent says at start about finding keepalived. `keepalivedPid` is what
 * findKeepalivedPid() returned for the same process table.
 */
export function startupFinding(procDir: string, view: ProcView, keepalivedPid: number | null): StartupFinding {
    if (!view.readable) {
        return {
            level: "error",
            message: `Cannot read the process table in ${procDir}: ${view.error}. keepalived will be reported as not running`,
        };
    }
    if (keepalivedPid !== null) {
        return { level: "info", message: `Found keepalived, PID ${keepalivedPid}` };
    }
    if (view.hostProcesses) {
        return {
            level: "warn",
            message: "No keepalived process is running on this host. It will be reported as not running until one starts",
        };
    }
    return {
        level: "warn",
        message:
            `No keepalived process found, and ${procDir} is not the host's process table ` +
            `(${view.processes} processes visible, no kernel threads). ` +
            "The agent only sees its own container: it has to run with `pid: host`. " +
            "keepalived will be reported as not running",
    };
}
