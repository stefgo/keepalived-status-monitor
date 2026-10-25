import { describe, expect, it } from "vitest";
import type { KeepalivedState, VrrpClusterHealth, VrrpInstance, VrrpState } from "@kasm/shared";
import { clusterLastChange, fleetStatus, visibleTiles, vrrpOverview } from "./vrrpOverview";
import type { NamedClusterMember, NamedVrrpCluster } from "./vrrp";

const VIP = "10.0.0.10/24";

const member = (
    hostName: string,
    state: VrrpState,
    instance: Partial<VrrpInstance> = {},
    over: Partial<NamedClusterMember> = {},
): NamedClusterMember => ({
    clientId: hostName,
    hostName,
    online: true,
    reporting: true,
    instance: { name: "VI_1", state, vrid: 51, vips: [VIP], ...instance },
    ...over,
});

const cluster = (
    key: string,
    members: NamedClusterMember[],
    over: Partial<NamedVrrpCluster> = {},
): NamedVrrpCluster => ({
    key,
    site: null,
    vrid: 51,
    networks: ["10.0.0.0/24"],
    vips: [VIP],
    members,
    health: "ok",
    ...over,
});

const reading = (clientId: string, over: Partial<KeepalivedState> = {}): KeepalivedState => ({
    clientId,
    running: true,
    collectedAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:01.000Z",
    instances: [],
    syncGroups: [],
    ...over,
});

const healths = (...list: VrrpClusterHealth[]) => list.map((health) => ({ health }));

describe("fleetStatus", () => {
    it("is unknown without a cluster or with none in sight", () => {
        expect(fleetStatus([])).toBe("unknown");
        expect(fleetStatus(healths("unknown", "unknown"))).toBe("unknown");
    });

    it("is healthy while every cluster is", () => {
        expect(fleetStatus(healths("ok", "ok"))).toBe("healthy");
    });

    it("is degraded with a degraded cluster or one out of sight beside healthy ones", () => {
        expect(fleetStatus(healths("ok", "degraded"))).toBe("degraded");
        expect(fleetStatus(healths("ok", "unknown"))).toBe("degraded");
    });

    it("is critical once a cluster's badge is red", () => {
        for (const health of ["split-brain", "no-master", "vip-mismatch"] as const) {
            expect(fleetStatus(healths("ok", "degraded", health))).toBe("critical");
        }
    });
});

describe("vrrpOverview", () => {
    const a = cluster("a", [
        member("lb-01", "MASTER", { lastTransition: "2026-01-01T10:00:00.000Z" }),
        member("lb-02", "BACKUP"),
    ]);
    const b = cluster(
        "b",
        [member("lb-01", "MASTER", { lastTransition: "2026-01-02T10:00:00.000Z" }), member("lb-03", "FAULT")],
        { health: "degraded", vrid: 52, site: "dc1" },
    );

    it("counts the clusters by health and the live instances by state", () => {
        const overview = vrrpOverview([a, b], []);
        expect(overview.clusters).toBe("2 · 1 healthy, 1 degraded");
        expect(overview.instances).toBe("4 on 3 hosts · 2 MASTER, 1 BACKUP, 1 FAULT");
        expect(overview.masters).toBe("lb-01: 2");
    });

    it("names the newest MASTER as the last failover", () => {
        expect(vrrpOverview([a, b], []).lastFailover).toEqual({
            text: "lb-01 became MASTER of dc1 / VRID 52",
            at: "2026-01-02T10:00:00.000Z",
        });
    });

    it("lists the sites and leaves them out where there are none", () => {
        expect(vrrpOverview([a, b], []).sites).toBe("dc1");
        expect(vrrpOverview([a], []).sites).toBeNull();
    });

    it("says what is wrong with the addresses", () => {
        const split = cluster("c", [member("lb-04", "MASTER"), member("lb-05", "MASTER")]);
        expect(vrrpOverview([a], []).vips).toEqual({ text: "1 · all served", tone: null });
        expect(vrrpOverview([split, a], []).vips).toEqual({ text: "2 · 1 split", tone: "error" });
        const silent = cluster("d", [member("lb-06", "MASTER", {}, { reporting: false })]);
        expect(vrrpOverview([silent], []).vips).toEqual({ text: "1 · 1 unknown", tone: null });
    });

    it("says nothing about keepalived's version where no host gives one", () => {
        expect(vrrpOverview([a], [reading("lb-01")]).versions).toBeNull();
    });

    it("writes one version once and marks versions that differ", () => {
        const same = [reading("lb-01", { version: "2.2.8" }), reading("lb-02", { version: "2.2.8" })];
        expect(vrrpOverview([a], same).versions).toEqual({ text: "2.2.8 on every host", tone: null });
        const mixed = [...same, reading("lb-03", { version: "2.3.1" })];
        expect(vrrpOverview([a], mixed).versions).toEqual({ text: "2.2.8 (2) · 2.3.1 (1)", tone: "warning" });
    });

    it("finds a sync group whose instances on one host are not in one state", () => {
        const inStep = reading("lb-01", {
            instances: [
                { name: "VI_1", state: "MASTER", vips: [], syncGroup: "G" },
                { name: "VI_2", state: "MASTER", vips: [], syncGroup: "G" },
            ],
            syncGroups: [{ name: "G", state: "MASTER", instances: ["VI_1", "VI_2"] }],
        });
        const astray = reading("lb-02", {
            instances: [
                { name: "VI_1", state: "BACKUP", vips: [] },
                { name: "VI_2", state: "FAULT", vips: [] },
            ],
            syncGroups: [{ name: "G", state: "FAULT", instances: ["VI_1", "VI_2"] }],
        });
        expect(vrrpOverview([a], [inStep]).syncGroups).toEqual({ text: "1 · in step", tone: null });
        expect(vrrpOverview([a], [inStep, astray]).syncGroups).toEqual({ text: "1 · 1 out of step", tone: "warning" });
        expect(vrrpOverview([a], [reading("lb-01")]).syncGroups).toBeNull();
    });

    it("says so when nothing is there", () => {
        const overview = vrrpOverview([], []);
        expect(overview).toMatchObject({ clusters: "None", instances: "None reporting", masters: "None" });
        expect(overview.vips).toEqual({ text: "None", tone: null });
        expect(overview.lastFailover).toBeNull();
    });
});

describe("clusterLastChange", () => {
    it("takes the MASTER's transition, and the newest of any live member without one", () => {
        const withMaster = cluster("a", [
            member("lb-01", "MASTER", { lastTransition: "2026-01-01T10:00:00.000Z" }),
            member("lb-02", "BACKUP", { lastTransition: "2026-01-03T10:00:00.000Z" }),
        ]);
        expect(clusterLastChange(withMaster)).toBe("2026-01-01T10:00:00.000Z");
        const without = cluster("b", [
            member("lb-01", "BACKUP", { lastTransition: "2026-01-01T10:00:00.000Z" }),
            member("lb-02", "BACKUP", { lastTransition: "2026-01-03T10:00:00.000Z" }),
        ]);
        expect(clusterLastChange(without)).toBe("2026-01-03T10:00:00.000Z");
    });

    it("is null where keepalived gives no time", () => {
        expect(clusterLastChange(cluster("a", [member("lb-01", "MASTER")]))).toBeNull();
    });
});

describe("visibleTiles", () => {
    it("shows every cluster up to the limit", () => {
        expect(visibleTiles(healths("ok", "ok"), 2)).toEqual({ shown: healths("ok", "ok"), hidden: 0 });
    });

    it("shows only those that are not healthy beyond it", () => {
        expect(visibleTiles(healths("degraded", "ok", "ok"), 2)).toEqual({ shown: healths("degraded"), hidden: 2 });
    });
});
