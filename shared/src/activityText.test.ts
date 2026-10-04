import { describe, expect, it } from "vitest";
import { activityDetail, activityMessage, vrrpStateLabel } from "./activityText.js";
import type { ActivityRecord } from "./types.js";

const event = (kind: string, over: Partial<ActivityRecord> = {}): ActivityRecord => ({
    id: "e1",
    occurredAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:01.000Z",
    source: "agent",
    clientId: "c1",
    kind,
    level: "info",
    seen: false,
    ...over,
});

const VI_1 = { instanceName: "VI_1", vrid: 51 };

/** A server-side cluster event: `cluster` is what was observed, `incident` how it was judged. */
const clusterEvent = (
    kind: string,
    cluster: Record<string, unknown> = {},
    rest: Record<string, unknown> = {},
): ActivityRecord =>
    event(kind, { source: "server", subject: VI_1, data: { cluster: { vrid: 51, site: "dc1", ...cluster }, ...rest } });

describe("vrrpStateLabel", () => {
    it("writes a state the way a reader sees it", () => {
        expect(vrrpStateLabel("MASTER")).toBe("Master");
        expect(vrrpStateLabel("backup")).toBe("Backup");
        expect(vrrpStateLabel("")).toBe("");
    });
});

describe("activityMessage: the agent's events", () => {
    it("words a state change with both states", () => {
        const changed = event("vrrp.state_changed", { subject: VI_1, data: { from: "MASTER", to: "BACKUP" } });
        expect(activityMessage(changed)).toBe("VRRP instance VI_1: Master → Backup");
    });

    it("still reads as something without a name or a state", () => {
        expect(activityMessage(event("vrrp.state_changed"))).toBe("A VRRP instance: ? → ?");
        // An empty text is as good as none.
        expect(activityMessage(event("vrrp.state_changed", { data: { from: "", to: "FAULT" } }))).toBe(
            "A VRRP instance: ? → Fault",
        );
    });

    it("words an instance appearing and disappearing", () => {
        expect(activityMessage(event("vrrp.instance_added", { subject: VI_1, data: { state: "BACKUP" } }))).toBe(
            "VRRP instance VI_1 appeared (Backup)",
        );
        expect(activityMessage(event("vrrp.instance_added", { subject: VI_1 }))).toBe(
            "VRRP instance VI_1 appeared (unknown state)",
        );
        expect(activityMessage(event("vrrp.instance_removed", { subject: VI_1 }))).toBe(
            "VRRP instance VI_1 disappeared",
        );
    });

    it("words keepalived starting, with its version where there is one", () => {
        expect(activityMessage(event("keepalived.started", { data: { version: "2.3.1" } }))).toBe(
            "keepalived v2.3.1 started",
        );
        expect(activityMessage(event("keepalived.started"))).toBe("keepalived started");
        expect(activityMessage(event("keepalived.stopped"))).toBe("keepalived stopped");
        expect(activityMessage(event("keepalived.unreadable"))).toBe("keepalived could not be read");
    });

    it("prints the kind of an event nobody here knows", () => {
        expect(activityMessage(event("vrrp.something_new", { data: { from: "MASTER" } }))).toBe("vrrp.something_new");
    });
});

describe("activityMessage: the server's own events", () => {
    it("names the client, or says there is one", () => {
        expect(activityMessage(event("client.connected", { data: { clientName: "lb-01" } }))).toBe("lb-01 connected");
        expect(activityMessage(event("client.disconnected"))).toBe("the client disconnected");
    });

    it("prefers the hostname for a registration", () => {
        const data = { hostname: "lb-01.example.net", clientName: "lb-01" };
        expect(activityMessage(event("client.registered", { data }))).toBe("lb-01.example.net registered");
        expect(activityMessage(event("client.registered", { data: { clientName: "lb-01" } }))).toBe("lb-01 registered");
    });

    it("names a scheduler as the settings page does", () => {
        const failed = (data: ActivityRecord["data"]) => activityMessage(event("scheduler.failed", { data }));
        expect(failed({ scheduler: "notification-cleanup", error: "disk full" })).toBe(
            "Activity cleanup failed: disk full",
        );
        expect(failed({ scheduler: "token-cleanup" })).toBe("Token cleanup failed");
        // A scheduler of a newer server keeps its id.
        expect(failed({ scheduler: "backup" })).toBe("backup failed");
        expect(failed(null)).toBe("A scheduled job failed");
    });
});

describe("activityMessage: cluster events", () => {
    it("names the cluster by VRID and site", () => {
        expect(activityMessage(clusterEvent("vrrp.master_changed", { master: "lb-01" }))).toBe(
            "VRID 51 (dc1): lb-01 is master",
        );
    });

    it("takes the VRID from the subject where the cluster block has none", () => {
        const lost = event("vrrp.master_lost", { subject: VI_1, data: {} });
        expect(activityMessage(lost)).toBe("VRID 51: no master");
        expect(activityMessage(event("vrrp.master_lost"))).toBe("VRID ?: no master");
    });

    it("says who was master before, unless it is the same host", () => {
        const changed = (previousMaster: string) =>
            activityMessage(clusterEvent("vrrp.master_changed", { master: "lb-01" }, { previousMaster }));
        expect(changed("lb-02")).toBe("VRID 51 (dc1): lb-01 is master now, was lb-02");
        expect(changed("lb-01")).toBe("VRID 51 (dc1): lb-01 is master");
    });

    it("lists the masters of a split brain", () => {
        expect(activityMessage(clusterEvent("vrrp.split_brain", { masters: ["lb-01", "lb-02"] }))).toBe(
            "VRID 51 (dc1): split brain — lb-01, lb-02",
        );
        expect(activityMessage(clusterEvent("vrrp.split_brain"))).toBe("VRID 51 (dc1): split brain");
    });

    it("says who held a cluster that lost its master", () => {
        expect(activityMessage(clusterEvent("vrrp.master_lost", {}, { previousMaster: "lb-01" }))).toBe(
            "VRID 51 (dc1): no master, was lb-01",
        );
    });
});

describe("activityMessage: incidents", () => {
    const incident = (kind: string, facts: Record<string, unknown>) =>
        activityMessage(clusterEvent(kind, {}, { incident: facts }));

    it("opens with the health in words", () => {
        expect(incident("vrrp.incident_opened", { health: "degraded" })).toBe("VRID 51 (dc1): incident opened, degraded");
        expect(incident("vrrp.incident_opened", { health: "unreachable" })).toBe(
            "VRID 51 (dc1): incident opened, all agents offline",
        );
    });

    it("passes on a health it has no word for, and marks a missing one", () => {
        expect(incident("vrrp.incident_opened", { health: "on-fire" })).toBe("VRID 51 (dc1): incident opened, on-fire");
        expect(incident("vrrp.incident_opened", {})).toBe("VRID 51 (dc1): incident opened, ?");
    });

    it("words an update by what changed: the health first, then findings added, then cleared", () => {
        const update = (facts: Record<string, unknown>) => incident("vrrp.incident_updated", facts);
        expect(update({ health: "split-brain", previousHealth: "degraded", added: ["a"] })).toBe(
            "VRID 51 (dc1): incident now split brain, was degraded",
        );
        expect(update({ health: "degraded", previousHealth: "degraded", added: ["a", "b"], cleared: ["c"] })).toBe(
            "VRID 51 (dc1): incident updated: a; b",
        );
        expect(update({ health: "degraded", previousHealth: "degraded", added: [], cleared: ["c"] })).toBe(
            "VRID 51 (dc1): incident updated, cleared: c",
        );
        expect(update({ health: "degraded", previousHealth: "degraded" })).toBe("VRID 51 (dc1): incident updated");
    });

    it("closes with how long it took", () => {
        const resolved = (durationSeconds: unknown) => incident("vrrp.incident_resolved", { durationSeconds });
        expect(resolved(42)).toBe("VRID 51 (dc1): recovered after 42 s");
        expect(resolved(184)).toBe("VRID 51 (dc1): recovered after 3 min");
        expect(resolved(7200)).toBe("VRID 51 (dc1): recovered after 2 h");
        expect(resolved(7500)).toBe("VRID 51 (dc1): recovered after 2 h 5 min");
        expect(resolved(86400)).toBe("VRID 51 (dc1): recovered after 1 d");
        expect(resolved(97200)).toBe("VRID 51 (dc1): recovered after 1 d 3 h");
        // A clock that ran backwards is no negative duration.
        expect(resolved(-5)).toBe("VRID 51 (dc1): recovered after 0 s");
        expect(resolved(undefined)).toBe("VRID 51 (dc1): recovered");
    });

    it("closes differently for a cluster that is gone", () => {
        expect(incident("vrrp.incident_resolved", { resolution: "removed", durationSeconds: 184 })).toBe(
            "VRID 51 (dc1): incident closed, the cluster no longer exists",
        );
    });
});

describe("activityDetail", () => {
    it("is the error where there is one", () => {
        expect(activityDetail(event("scheduler.failed", { data: { error: "disk full" } }))).toBe("disk full");
    });

    it("is the priority of a state change, with the effective one where it differs", () => {
        const detail = (data: ActivityRecord["data"]) => activityDetail(event("vrrp.state_changed", { data }));
        expect(detail({ priority: 100, effectivePriority: 90 })).toBe("priority 100, effective 90");
        expect(detail({ priority: 100, effectivePriority: 100 })).toBe("priority 100");
        expect(detail({ priority: 100 })).toBe("priority 100");
        expect(detail({ from: "MASTER", to: "BACKUP" })).toBeNull();
    });

    it("is the reasons of an open incident", () => {
        const opened = clusterEvent(
            "vrrp.incident_opened",
            { members: [{ host: "lb-02", state: "BACKUP" }] },
            { incident: { reasons: [{ type: "fault", text: "lb-02 in FAULT" }, { type: "no-master", text: "no host is MASTER" }] } },
        );
        expect(activityDetail(opened)).toBe("lb-02 in FAULT; no host is MASTER");
    });

    it("is the other hosts of a cluster event, without the master the message already names", () => {
        const members = [
            { host: "lb-01", state: "MASTER" },
            { host: "lb-02", state: "BACKUP" },
            { host: "lb-03", state: "MASTER", online: false },
            { host: "lb-04", state: "BACKUP", reporting: false },
            // Not a member as this build knows it.
            { host: "lb-05" },
        ];
        expect(activityDetail(clusterEvent("vrrp.master_changed", { master: "lb-01", members }))).toBe(
            "lb-02 Backup, lb-03 offline, lb-04 not reporting",
        );
    });

    it("is nothing for a cluster of the master alone, and for an event without facts", () => {
        const alone = clusterEvent("vrrp.master_changed", { master: "lb-01", members: [{ host: "lb-01", state: "MASTER" }] });
        expect(activityDetail(alone)).toBeNull();
        expect(activityDetail(event("keepalived.stopped"))).toBeNull();
        expect(activityDetail(event("client.connected", { data: { clientName: "lb-01" } }))).toBeNull();
    });

    it("lists hosts for cluster events only", () => {
        const data = { cluster: { members: [{ host: "lb-02", state: "BACKUP" }] } };
        expect(activityDetail(event("client.connected", { data }))).toBeNull();
    });
});
