import { describe, expect, it } from "vitest";
import type { ActivityRecord, KeepalivedState, SchedulerStatuses } from "@kasm/shared";
import {
    appendActivity,
    applyKeepalivedState,
    applySchedulerUpdate,
    markActivitySeen,
    mergeKeepalivedStates,
    unmarkActivitySeen,
    unseenAmong,
    unseenTone,
} from "./cacheUpdates";

const reading = (clientId: string, receivedAt: string, running = true): KeepalivedState => ({
    clientId,
    receivedAt,
    collectedAt: receivedAt,
    running,
    instances: [],
    syncGroups: [],
});

const event = (id: string, occurredAt: string, seen = false, level: ActivityRecord["level"] = "info"): ActivityRecord => ({
    id,
    occurredAt,
    receivedAt: occurredAt,
    source: "agent",
    kind: "vrrp.transition",
    level,
    seen,
});

describe("applyKeepalivedState", () => {
    const states = { a: reading("a", "2026-10-04T08:00:00Z"), b: reading("b", "2026-10-04T08:00:00Z") };

    it("replaces one client's reading and leaves the others", () => {
        const next = applyKeepalivedState(states, reading("a", "2026-10-04T08:01:00Z", false));
        expect(next.a.running).toBe(false);
        expect(next.b).toBe(states.b);
    });

    // Sent for every client on connect, before or after the request has answered.
    it("makes the entry when there is none", () => {
        expect(applyKeepalivedState(undefined, states.a)).toEqual({ a: states.a });
    });

    it("keeps the cached reading when the one that arrives is older", () => {
        expect(applyKeepalivedState(states, reading("a", "2026-10-04T07:59:00Z", false))).toBe(states);
    });

    // The connect burst repeats what the request has just answered.
    it("takes a reading of the same instant", () => {
        const same = reading("a", "2026-10-04T08:00:00Z", false);
        expect(applyKeepalivedState(states, same).a).toBe(same);
    });
});

describe("mergeKeepalivedStates", () => {
    it("turns the answer into an entry by client", () => {
        const a = reading("a", "2026-10-04T08:00:00Z");
        expect(mergeKeepalivedStates(undefined, [a])).toEqual({ a });
    });

    // The request was under way while the socket delivered the failover.
    it("keeps a reading the socket delivered after the answer was read", () => {
        const pushed = reading("a", "2026-10-04T08:00:05Z", false);
        const merged = mergeKeepalivedStates({ a: pushed }, [reading("a", "2026-10-04T08:00:00Z")]);
        expect(merged.a).toBe(pushed);
    });

    it("takes the answer where it is the later one", () => {
        const fetched = reading("a", "2026-10-04T08:00:05Z");
        expect(mergeKeepalivedStates({ a: reading("a", "2026-10-04T08:00:00Z") }, [fetched]).a).toBe(fetched);
    });

    it("keeps a client the answer does not know yet", () => {
        const pushed = reading("new", "2026-10-04T08:00:05Z");
        const merged = mergeKeepalivedStates({ new: pushed }, [reading("a", "2026-10-04T08:00:00Z")]);
        expect(Object.keys(merged).sort()).toEqual(["a", "new"]);
    });
});

describe("unseenTone", () => {
    it("is the most severe level among the unseen events", () => {
        const events = [event("a", "1", false, "warning"), event("b", "2", false, "error")];
        expect(unseenTone(events)).toBe("error");
        expect(unseenTone([events[0]])).toBe("warning");
    });

    it("asks for no look at info, trace or anything seen", () => {
        expect(unseenTone([event("a", "1"), event("b", "2", false, "trace"), event("c", "3", true, "error")])).toBeNull();
    });
});

describe("appendActivity", () => {
    const list = [event("b", "2026-10-04T08:00:00Z"), event("a", "2026-10-04T07:00:00Z")];

    it("puts a new event where it happened, not on top", () => {
        const late = event("late", "2026-10-04T07:30:00Z");
        expect(appendActivity(list, [late]).map((e) => e.id)).toEqual(["b", "late", "a"]);
    });

    it("skips an event it already holds", () => {
        expect(appendActivity(list, [event("a", "2026-10-04T07:00:00Z")])).toBe(list);
    });

    it("adds only the new ones of a batch", () => {
        const batch = [event("a", "2026-10-04T07:00:00Z"), event("c", "2026-10-04T09:00:00Z")];
        expect(appendActivity(list, batch).map((e) => e.id)).toEqual(["c", "b", "a"]);
    });
});

describe("marking activity seen", () => {
    const list = [event("a", "2026-10-04T08:00:00Z"), event("b", "2026-10-04T07:00:00Z", true)];

    it("turns the named events seen", () => {
        expect(markActivitySeen(list, ["a"]).map((e) => e.seen)).toEqual([true, true]);
    });

    it("returns the list itself when nothing changes", () => {
        expect(markActivitySeen(list, ["b", "gone"])).toBe(list);
    });

    it("names what a marking will change", () => {
        expect(unseenAmong(list, ["a", "b", "gone"])).toEqual(["a"]);
    });

    // Only what the failed request had turned seen goes back, not what was seen before.
    it("takes back exactly what was marked", () => {
        const marked = markActivitySeen(list, ["a", "b"]);
        const undone = unmarkActivitySeen(marked, unseenAmong(list, ["a", "b"]));
        expect(undone.map((e) => e.seen)).toEqual([false, true]);
    });
});

describe("applySchedulerUpdate", () => {
    const idle = { isRunning: false, nextRun: null, lastRun: null };
    const schedulers: SchedulerStatuses = { "notification-cleanup": idle, "token-cleanup": idle };

    it("replaces the one scheduler and leaves the other", () => {
        const updated = applySchedulerUpdate(schedulers, {
            scheduler: "token-cleanup",
            status: { ...idle, isRunning: true },
        });
        expect(updated["token-cleanup"].isRunning).toBe(true);
        expect(updated["notification-cleanup"]).toBe(schedulers["notification-cleanup"]);
    });
});
