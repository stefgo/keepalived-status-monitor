import { StatusReportSchema, type KeepalivedState, type VrrpState } from "@kasm/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

type TestClient = { id: string; hostname: string; displayName?: string | null; site?: string | null; status: string };

const clients = vi.fn<() => TestClient[]>();
const states = vi.fn<() => KeepalivedState[]>();

// Both services reach the database and config.yaml when they are imported.
vi.mock("./ProxyService.js", () => ({ ProxyService: { getClientsWithStatus: () => clients() } }));
vi.mock("./KeepalivedStateService.js", () => ({ KeepalivedStateService: { getAll: () => states() } }));

const { StatusService } = await import("./StatusService.js");

const NOW = Date.parse("2026-10-27T10:00:00.000Z");

const client = (id: string, status = "online"): TestClient => ({ id, hostname: id, site: "HQ", status });

const reading = (clientId: string, state: VrrpState): KeepalivedState => ({
    clientId,
    running: true,
    collectedAt: "2026-10-27T09:59:00.000Z",
    receivedAt: "2026-10-27T09:59:01.000Z",
    instances: [{ name: "VI_1", state, vrid: 51, vips: ["10.0.0.10/24"] }],
    syncGroups: [],
});

beforeEach(() => {
    clients.mockReset().mockReturnValue([]);
    states.mockReset().mockReturnValue([]);
});

describe("StatusService.report", () => {
    it("is unknown while no agent reports an instance", () => {
        const report = StatusService.report(NOW);
        expect(StatusReportSchema.parse(report)).toEqual(report);
        expect(report).toMatchObject({ app: "kasm", status: "unknown", findings: [], counts: { error: 0, warning: 0 } });
    });

    it("is healthy with one MASTER and every member reporting", () => {
        clients.mockReturnValue([client("lb-01"), client("lb-02")]);
        states.mockReturnValue([reading("lb-01", "MASTER"), reading("lb-02", "BACKUP")]);

        const report = StatusService.report(NOW);

        expect(report.status).toBe("healthy");
        expect(report.findings).toEqual([]);
        expect(report.summary).toEqual({
            hosts: { online: 2, total: 2 },
            clusters: { total: 1, needingAttention: 0, unknown: 0 },
            instances: 2,
            masters: 1,
            faults: 0,
        });
    });

    it("lists the dashboard's lines, the cluster's label leading each", () => {
        clients.mockReturnValue([client("lb-01"), client("lb-02")]);
        states.mockReturnValue([reading("lb-01", "MASTER"), reading("lb-02", "MASTER")]);

        const report = StatusService.report(NOW);

        expect(report.status).toBe("critical");
        expect(report.counts).toEqual({ error: 1, warning: 0 });
        expect(report.findings).toEqual([
            {
                id: expect.stringMatching(/^split-brain:HQ\|51\|/),
                type: "split-brain",
                severity: "error",
                text: "HQ / VRID 51: Split brain: lb-01, lb-02 are MASTER",
                since: null,
            },
        ]);
    });

    it("counts a member whose agent is offline, and not its instance", () => {
        clients.mockReturnValue([client("lb-01"), client("lb-02", "offline")]);
        states.mockReturnValue([reading("lb-01", "MASTER"), reading("lb-02", "BACKUP")]);

        const report = StatusService.report(NOW);

        expect(report.status).toBe("degraded");
        expect(report.findings.map((f) => f.text)).toEqual(["HQ / VRID 51: lb-02: agent offline, last BACKUP"]);
        expect(report.summary).toMatchObject({ hosts: { online: 1, total: 2 }, instances: 1 });
    });
});
