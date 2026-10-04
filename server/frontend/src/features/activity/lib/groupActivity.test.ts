import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "@kasm/shared";
import { groupActivity } from "./groupActivity";

let clock = 0;

/** Events are created oldest first; the lists under test are newest first, as the API sends them. */
const event = (id: string, kind: string, over: Partial<ActivityRecord> = {}): ActivityRecord => {
    clock += 1;
    const at = new Date(Date.UTC(2026, 0, 1, 0, 0, clock)).toISOString();
    return {
        id,
        kind,
        occurredAt: at,
        receivedAt: at,
        source: "agent",
        clientId: "c1",
        level: "info",
        seen: true,
        ...over,
    };
};

const newestFirst = (...events: ActivityRecord[]) => [...events].reverse();

/** The rows as ids: the head, then its members. */
const rows = (events: ActivityRecord[]) =>
    groupActivity(events).map((group) => [group.head.id, ...group.members.map((member) => member.id)]);

describe("groupActivity", () => {
    it("is empty for an empty list", () => {
        expect(groupActivity([])).toEqual([]);
    });

    it("makes a row of its own of every event without a correlationId, in the order given", () => {
        const a = event("a", "keepalived.started");
        const b = event("b", "vrrp.state_changed", { level: "warning", seen: false });
        expect(groupActivity(newestFirst(a, b))).toEqual([
            { head: b, members: [], level: "warning", unseen: true },
            { head: a, members: [], level: "info", unseen: false },
        ]);
    });

    it("treats a null correlationId like none", () => {
        const a = event("a", "keepalived.started", { correlationId: null });
        const b = event("b", "keepalived.stopped", { correlationId: null });
        expect(rows(newestFirst(a, b))).toEqual([["b"], ["a"]]);
    });

    it("folds the events of one correlationId into one row, read oldest first", () => {
        const opened = event("o", "vrrp.incident_opened", { correlationId: "i1" });
        const updated = event("u", "vrrp.incident_updated", { correlationId: "i1" });
        const resolved = event("r", "vrrp.incident_resolved", { correlationId: "i1" });
        expect(rows(newestFirst(opened, updated, resolved))).toEqual([["o", "u", "r"]]);
    });

    it("heads an incident with its opening, wherever that sits in the list", () => {
        // The opening arrived late: it was not the first event carrying the id.
        const updated = event("u", "vrrp.incident_updated", { correlationId: "i1" });
        const opened = event("o", "vrrp.incident_opened", { correlationId: "i1" });
        const resolved = event("r", "vrrp.incident_resolved", { correlationId: "i1" });
        expect(rows(newestFirst(updated, opened, resolved))).toEqual([["o", "u", "r"]]);
    });

    it("lets the earliest member stand in for a head that has not arrived", () => {
        const updated = event("u", "vrrp.incident_updated", { correlationId: "i1" });
        const resolved = event("r", "vrrp.incident_resolved", { correlationId: "i1" });
        expect(rows(newestFirst(updated, resolved))).toEqual([["u", "r"]]);
    });

    it("keeps a group of one as a row without members", () => {
        const opened = event("o", "vrrp.incident_opened", { correlationId: "i1" });
        expect(rows([opened])).toEqual([["o"]]);
    });

    it("keeps a group where its newest member stands, among the other rows", () => {
        const opened = event("o", "vrrp.incident_opened", { correlationId: "i1" });
        const between = event("b", "keepalived.started");
        const resolved = event("r", "vrrp.incident_resolved", { correlationId: "i1" });
        const after = event("a", "keepalived.stopped");
        expect(rows(newestFirst(opened, between, resolved, after))).toEqual([["a"], ["o", "r"], ["b"]]);
    });

    it("keeps two groups apart that overlap in time", () => {
        const first = event("o1", "vrrp.incident_opened", { correlationId: "i1" });
        const second = event("o2", "vrrp.incident_opened", { correlationId: "i2" });
        const firstDone = event("r1", "vrrp.incident_resolved", { correlationId: "i1" });
        const secondDone = event("r2", "vrrp.incident_resolved", { correlationId: "i2" });
        expect(rows(newestFirst(first, second, firstDone, secondDone))).toEqual([
            ["o2", "r2"],
            ["o1", "r1"],
        ]);
    });

    it("colours a group by its most severe member", () => {
        const opened = event("o", "vrrp.incident_opened", { correlationId: "i1", level: "warning" });
        const updated = event("u", "vrrp.incident_updated", { correlationId: "i1", level: "error" });
        const resolved = event("r", "vrrp.incident_resolved", { correlationId: "i1", level: "info" });
        expect(groupActivity(newestFirst(opened, updated, resolved))[0].level).toBe("error");
    });

    it("counts a group as unseen while any of its members is", () => {
        const opened = event("o", "vrrp.incident_opened", { correlationId: "i1" });
        const resolved = event("r", "vrrp.incident_resolved", { correlationId: "i1", seen: false });
        expect(groupActivity(newestFirst(opened, resolved))[0].unseen).toBe(true);
        expect(groupActivity(newestFirst(opened, { ...resolved, seen: true }))[0].unseen).toBe(false);
    });
});
