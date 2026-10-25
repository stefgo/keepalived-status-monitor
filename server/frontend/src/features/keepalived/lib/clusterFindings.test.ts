import { describe, expect, it } from "vitest";
import type { VrrpInstance, VrrpState } from "@kasm/shared";
import { clusterFindings, fleetFindings } from "./clusterFindings";
import type { NamedClusterMember, NamedVrrpCluster } from "./vrrp";

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
