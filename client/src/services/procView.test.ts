import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readProcView, startupFinding } from "./procView.js";

// Every test gets a process table of its own under the system's temporary directory.
let procDir: string;

function addProcess(pid: number, comm: string) {
    fs.mkdirSync(path.join(procDir, String(pid)));
    fs.writeFileSync(path.join(procDir, String(pid), "comm"), `${comm}\n`);
}

beforeEach(() => {
    procDir = fs.mkdtempSync(path.join(os.tmpdir(), "kasm-proc-"));
    fs.writeFileSync(path.join(procDir, "uptime"), "1 1\n");
});

afterEach(() => {
    fs.rmSync(procDir, { recursive: true, force: true });
});

describe("readProcView", () => {
    it("takes a table with kthreadd as PID 2 for the host's", () => {
        addProcess(1, "systemd");
        addProcess(2, "kthreadd");
        addProcess(812, "keepalived");

        expect(readProcView(procDir)).toEqual({ readable: true, processes: 3, hostProcesses: true });
    });

    it("takes a table without kernel threads for a container's own", () => {
        addProcess(1, "node");

        expect(readProcView(procDir)).toEqual({ readable: true, processes: 1, hostProcesses: false });
    });

    it("is not misled by another process that happens to be PID 2", () => {
        addProcess(1, "tini");
        addProcess(2, "node");

        expect(readProcView(procDir)).toMatchObject({ hostProcesses: false });
    });

    it("says why a table cannot be read", () => {
        const view = readProcView(path.join(procDir, "missing"));

        expect(view.readable).toBe(false);
        expect(view).toMatchObject({ error: expect.stringContaining("ENOENT") });
    });
});

describe("startupFinding", () => {
    it("names the PID of a keepalived it found", () => {
        const finding = startupFinding("/proc", { readable: true, processes: 3, hostProcesses: true }, 812);

        expect(finding).toEqual({ level: "info", message: "Found keepalived, PID 812" });
    });

    it("does not blame the container when keepalived was found in a shared namespace", () => {
        const finding = startupFinding("/proc", { readable: true, processes: 4, hostProcesses: false }, 1);

        expect(finding.level).toBe("info");
    });

    it("says that the host runs no keepalived", () => {
        const finding = startupFinding("/proc", { readable: true, processes: 240, hostProcesses: true }, null);

        expect(finding.level).toBe("warn");
        expect(finding.message).toContain("No keepalived process is running on this host");
        expect(finding.message).not.toContain("pid: host");
    });

    it("names `pid: host` when the agent sees only its own container", () => {
        const finding = startupFinding("/proc", { readable: true, processes: 2, hostProcesses: false }, null);

        expect(finding.level).toBe("warn");
        expect(finding.message).toContain("`pid: host`");
        expect(finding.message).toContain("2 processes visible");
    });

    it("reports a process table it cannot read as an error", () => {
        const finding = startupFinding("/proc", { readable: false, error: "EACCES: permission denied" }, null);

        expect(finding.level).toBe("error");
        expect(finding.message).toContain("EACCES: permission denied");
    });
});
