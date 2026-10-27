import { describe, expect, it } from "vitest";
import type { KeepalivedState, VrrpClusterHealth, VrrpInstance, VrrpState } from "./types.js";
import {
    buildNamedClusters,
    CLUSTER_HEALTH_SEVERITY,
    clusterFindings,
    fleetFindings,
    fleetFindingText,
    fleetStatus,
    type NamedClusterMember,
    type NamedVrrpCluster,
} from "./vrrpFindings.js";

const member = (
    hostName: string,
    state: VrrpState,
    over: Partial<NamedClusterMember> = {},
    instance: Partial<VrrpInstance> = {},
): NamedClusterMember => ({
    clientId: hostName,
    hostName,
    online: true,
    reporting: true,
    instance: { name: "VI_1", state, vrid: 51, vips: ["10.0.0.10/24"], ...instance },
    ...over,
});

const cluster = (key: string, members: NamedClusterMember[]): NamedVrrpCluster => ({
    key,
    site: null,
    vrid: 51,
    networks: ["10.0.0.0/24"],
    vips: ["10.0.0.10/24"],
    members,
    health: "ok",
});

const texts = (c: NamedVrrpCluster) => clusterFindings(c).map((f) => `${f.severity}: ${f.text}`);

describe("clusterFindings", () => {
    it("finds nothing in a cluster with one MASTER and every member reporting", () => {
        expect(texts(cluster("a", [member("lb-01", "MASTER"), member("lb-02", "BACKUP")]))).toEqual([]);
    });

    it("names the hosts of a split brain", () => {
        expect(texts(cluster("a", [member("lb-01", "MASTER"), member("lb-02", "MASTER")]))).toEqual([
            "error: Split brain: lb-01, lb-02 are MASTER",
        ]);
    });

    it("says when no host is MASTER", () => {
        expect(texts(cluster("a", [member("lb-01", "BACKUP"), member("lb-02", "BACKUP")]))).toEqual([
            "error: No host is MASTER",
        ]);
    });

    it("counts an agent that is offline, unlike the incidents", () => {
        expect(
            texts(cluster("a", [member("lb-01", "MASTER"), member("lb-02", "BACKUP", { online: false })])),
        ).toEqual(["warning: lb-02: agent offline, last BACKUP"]);
    });

    it("tells keepalived not reporting and FAULT apart", () => {
        const c = cluster("a", [
            member("lb-01", "MASTER"),
            member("lb-02", "BACKUP", { reporting: false }),
            member("lb-03", "FAULT"),
        ]);
        expect(texts(c)).toEqual([
            "warning: lb-02: keepalived not reporting, last BACKUP",
            "warning: lb-03 in FAULT",
        ]);
    });

    it("puts an address a member lacks among the errors, offline members included", () => {
        const c = cluster("a", [
            member("lb-01", "MASTER"),
            member("lb-02", "BACKUP", { online: false }, { vips: [] }),
        ]);
        expect(texts(c)).toEqual(["error: lb-02 lacks 10.0.0.10/24", "warning: lb-02: agent offline, last BACKUP"]);
    });

    it("says that a cluster of one host has nothing to fail over to", () => {
        expect(texts(cluster("a", [member("lb-01", "MASTER")]))).toEqual(["warning: Only one host in the cluster"]);
    });

    it("says nothing about the roles while no member is live", () => {
        const c = cluster("a", [member("lb-01", "MASTER", { online: false }), member("lb-02", "BACKUP", { online: false })]);
        expect(texts(c)).toEqual([
            "warning: lb-01: agent offline, last MASTER",
            "warning: lb-02: agent offline, last BACKUP",
        ]);
    });
});

describe("fleetFindings", () => {
    it("puts every error before every warning, each in the order of the clusters", () => {
        const degraded = cluster("a", [member("lb-01", "MASTER"), member("lb-02", "FAULT")]);
        const split = cluster("b", [member("lb-03", "MASTER"), member("lb-04", "MASTER")]);
        expect(fleetFindings([degraded, split]).map((f) => `${f.cluster.key}: ${f.text}`)).toEqual([
            "b: Split brain: lb-03, lb-04 are MASTER",
            "a: lb-02 in FAULT",
        ]);
    });
});

describe("finding ids", () => {
    it("name the type, the cluster and the member, never the text", () => {
        const c = cluster("site|51|10.0.0.0/24", [
            member("lb-01", "MASTER"),
            member("lb-02", "FAULT", { clientId: "c2" }),
        ]);
        expect(clusterFindings(c).map((f) => [f.type, f.id])).toEqual([
            ["instance-fault", "instance-fault:site|51|10.0.0.0/24:c2:VI_1"],
        ]);
    });

    it("stay the same while the text changes", () => {
        const one = cluster("a", [member("lb-01", "MASTER"), member("lb-02", "MASTER")]);
        const other = cluster("a", [member("lb-01", "MASTER"), member("lb-02", "MASTER"), member("lb-03", "MASTER")]);
        const [first] = clusterFindings(one);
        const [second] = clusterFindings(other);
        expect(first.text).not.toBe(second.text);
        expect(first.id).toBe(second.id);
        expect(first.id).toBe("split-brain:a");
    });

    it("are unique across the fleet", () => {
        const a = cluster("a", [member("lb-01", "MASTER", { online: false }), member("lb-02", "BACKUP", { online: false })]);
        const ids = fleetFindings([a]).map((f) => f.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe("fleetFindingText", () => {
    it("leads with the cluster's label, as the dashboard's list does", () => {
        const c = { ...cluster("a", [member("lb-01", "MASTER")]), site: "HQ" };
        expect(fleetFindings([c]).map(fleetFindingText)).toEqual(["HQ / VRID 51: Only one host in the cluster"]);
    });
});

describe("buildNamedClusters", () => {
    const reading = (clientId: string, state: VrrpState): KeepalivedState => ({
        clientId,
        running: true,
        collectedAt: "2026-01-01T00:00:00.000Z",
        receivedAt: "2026-01-01T00:00:01.000Z",
        instances: [{ name: "VI_1", state, vrid: 51, vips: ["10.0.0.10/24"] }],
        syncGroups: [],
    });

    it("names every member by its client, online as its client is", () => {
        const clusters = buildNamedClusters(
            [
                { id: "c1", hostname: "lb-01", displayName: "Edge 1", site: "HQ", status: "online" },
                { id: "c2", hostname: "lb-02", site: "HQ", status: "offline" },
            ],
            [reading("c1", "MASTER"), reading("c2", "BACKUP")],
        );
        expect(clusters).toHaveLength(1);
        expect(clusters[0].site).toBe("HQ");
        expect(clusters[0].members.map((m) => [m.hostName, m.online])).toEqual([
            ["Edge 1", true],
            ["lb-02", false],
        ]);
    });

    it("leaves out the reading of a client that is gone", () => {
        const clusters = buildNamedClusters(
            [{ id: "c1", hostname: "lb-01", status: "online" }],
            [reading("c1", "MASTER"), reading("deleted", "BACKUP")],
        );
        expect(clusters[0].members.map((m) => m.clientId)).toEqual(["c1"]);
    });
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

    it("is critical once a cluster's health is an error", () => {
        for (const health of ["split-brain", "no-master", "vip-mismatch"] as const) {
            expect(CLUSTER_HEALTH_SEVERITY[health]).toBe("error");
            expect(fleetStatus(healths("ok", "degraded", health))).toBe("critical");
        }
    });
});

