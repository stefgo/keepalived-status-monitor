import { describe, expect, it } from "vitest";
import type { ActivityRecord, KeepalivedState, VrrpCluster, VrrpClusterHealth, VrrpState } from "@kasm/shared";
import { clientCount, formatOnlineCount, instanceCount, needsAttention, unseenProblems } from "./dashboard";

const reading = (clientId: string, states: VrrpState[]): KeepalivedState => ({
    clientId,
    running: true,
    collectedAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:01.000Z",
    instances: states.map((state, i) => ({ name: `VI_${i}`, state, vrid: 50 + i, vips: [] })),
    syncGroups: [],
});

const cluster = (key: string, health: VrrpClusterHealth): VrrpCluster => ({
    key,
    site: null,
    vrid: 51,
    networks: [],
    vips: [],
    members: [],
    health,
});

const event = (id: string, over: Partial<ActivityRecord> = {}): ActivityRecord => ({
    id,
    kind: "vrrp.state_changed",
    occurredAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:00.000Z",
    source: "agent",
    clientId: "a",
    level: "info",
    seen: false,
    ...over,
});

describe("clientCount", () => {
    it("counts the clients that are online against all of them", () => {
        const clients = [{ status: "online" }, { status: "offline" }, { status: null }];
        expect(clientCount(clients)).toEqual({ online: 1, total: 3 });
        expect(formatOnlineCount(clientCount(clients))).toBe("1 / 3");
    });

    it("is zero of zero without a client", () => {
        expect(formatOnlineCount(clientCount([]))).toBe("0 / 0");
    });
});

describe("instanceCount", () => {
    const clients = [
        { id: "a", status: "online" },
        { id: "b", status: "offline" },
        { id: "c", status: "online" },
    ];

    it("counts the instances of the hosts that are online", () => {
        const states = { a: reading("a", ["MASTER", "FAULT"]), b: reading("b", ["MASTER"]) };
        expect(instanceCount(clients, states)).toEqual({ instances: 2, masters: 1, faults: 1 });
    });

    it("counts nothing for an online host without a reading", () => {
        expect(instanceCount(clients, {})).toEqual({ instances: 0, masters: 0, faults: 0 });
    });
});

describe("needsAttention", () => {
    it("leaves out the clusters that are fine and those nothing is known about", () => {
        const clusters = [cluster("a", "ok"), cluster("b", "unknown"), cluster("c", "degraded")];
        expect(needsAttention(clusters).map((c) => c.key)).toEqual(["c"]);
    });
});

describe("unseenProblems", () => {
    it("counts the unseen rows at warning and above", () => {
        const events = [
            event("a", { level: "error" }),
            event("b", { level: "warning" }),
            event("c", { level: "info" }),
            event("d", { level: "error", seen: true }),
        ];
        expect(unseenProblems(events)).toBe(2);
    });

    it("counts a group as one row", () => {
        const events = [
            event("a", { level: "error", correlationId: "i1" }),
            event("b", { level: "warning", correlationId: "i1" }),
        ];
        expect(unseenProblems(events)).toBe(1);
    });
});
