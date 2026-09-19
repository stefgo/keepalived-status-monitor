import fs from "fs";
import net from "net";
import path from "path";
import { logger } from "@kasm/shared/node";
import { config } from "../core/Config.js";
import { KeepalivedService, PROC_DIR, findKeepalivedPid } from "./KeepalivedService.js";

/**
 * How often the FIFO is checked for being the one keepalived writes to. A stat and a scan of
 * /proc, the same the timer's reading does anyway.
 */
const CHECK_INTERVAL_MS = 5000;

/** A line longer than this is no notify line; the buffer is dropped rather than grown. */
const MAX_LINE_BYTES = 4096;

export type NotifyFifoState = "off" | "open" | "missing";

interface OpenFifo {
    socket: net.Socket;
    pid: number;
    dev: number;
    ino: number;
}

/**
 * Listens on keepalived's `vrrp_notify_fifo` and turns every line into a reading
 * (KeepalivedService.trigger). What the line says is logged and otherwise ignored: the
 * reading is where the state comes from, so a format a newer keepalived changes, or a line
 * that is lost, costs nothing but latency.
 *
 * The FIFO is opened through `/proc/<pid>/root`, like the dumps, and read-write rather than
 * read-only. On Linux that open neither blocks while keepalived has no writer on the FIFO
 * nor ever sees an end of file when keepalived closes it -- a read-only open would do one or
 * the other. The price is that a keepalived restart goes unnoticed on the descriptor itself,
 * so a timer compares the FIFO's inode and keepalived's PID with the open one and reopens
 * when either changed.
 *
 * The agent does not create the FIFO: that is keepalived's, in keepalived's file system.
 */
export class NotifyFifoWatcher {
    private static current: OpenFifo | null = null;
    private static timer: NodeJS.Timeout | null = null;
    /** The last problem logged, so a lasting one is logged once rather than every check. */
    private static problem: string | null = null;
    private static openedBefore = false;

    static state(): NotifyFifoState {
        if (!config.keepalived.notifyFifo) return "off";
        return this.current ? "open" : "missing";
    }

    static start(): void {
        if (!config.keepalived.notifyFifo || this.timer) return;
        this.check();
        this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
        this.timer.unref?.();
    }

    static stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.close();
    }

    private static check(): void {
        const fifo = config.keepalived.notifyFifo;
        if (!fifo) return;

        const pid = findKeepalivedPid();
        if (pid === null) {
            this.close();
            this.report("keepalived is not running");
            return;
        }

        const target = path.join(PROC_DIR, String(pid), "root", fifo);
        let stat: fs.Stats;
        try {
            stat = fs.statSync(target);
        } catch (err) {
            this.close();
            const code = (err as NodeJS.ErrnoException).code;
            this.report(
                code === "EACCES"
                    ? "not permitted to reach it (capability SYS_PTRACE missing?)"
                    : "it does not exist -- is vrrp_notify_fifo set in keepalived.conf?",
            );
            return;
        }
        if (!stat.isFIFO()) {
            this.close();
            this.report("the path exists but is not a FIFO");
            return;
        }

        const open = this.current;
        if (open && open.pid === pid && open.dev === stat.dev && open.ino === stat.ino) return;

        this.close();
        this.open(target, pid);
    }

    private static open(target: string, pid: number): void {
        let fd: number;
        try {
            fd = fs.openSync(target, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
        } catch (err) {
            this.report(`it could not be opened (${(err as Error).message})`);
            return;
        }

        const stat = fs.fstatSync(fd);
        const socket = new net.Socket({ fd, readable: true, writable: false });
        let buffer = "";
        socket.setEncoding("utf-8");
        socket.on("data", (chunk: string) => {
            buffer += chunk;
            let newline: number;
            while ((newline = buffer.indexOf("\n")) >= 0) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                if (line) {
                    logger.debug({ line }, "keepalived notify FIFO");
                    KeepalivedService.trigger("fifo");
                }
            }
            if (buffer.length > MAX_LINE_BYTES) buffer = "";
        });
        socket.on("error", (err) => {
            logger.warn({ err: err.message }, "keepalived notify FIFO failed, reopening");
            if (this.current?.socket === socket) this.close();
        });

        this.current = { socket, pid, dev: stat.dev, ino: stat.ino };
        logger.info({ fifo: config.keepalived.notifyFifo, pid }, "Listening on keepalived's notify FIFO");
        this.problem = null;

        // Whatever keepalived wrote while nobody was listening is gone; a reading catches up.
        // Not on the first open: the agent's first reading is running already.
        if (this.openedBefore) KeepalivedService.trigger("fifo reopened");
        this.openedBefore = true;
    }

    private static close(): void {
        const open = this.current;
        this.current = null;
        open?.socket.destroy();
    }

    private static report(problem: string): void {
        if (this.problem === problem) return;
        this.problem = problem;
        logger.warn(
            { fifo: config.keepalived.notifyFifo },
            `keepalived's notify FIFO is not available: ${problem}`,
        );
    }
}
