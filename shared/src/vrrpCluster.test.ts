import { describe, expect, it } from "vitest";
import type { KeepalivedState, VrrpCluster, VrrpClusterMember, VrrpInstance, VrrpState } from "./types.js";
import {
    buildVrrpClusters,
    clusterCondition,
    clusterIncidentState,
    incidentReasonKey,
    incidentReasonsKey,
    instanceNetworks,
    mismatchedVips,
    stripPrefix,
} from "./vrrpCluster.js";

const VIP = "10.0.0.10/24";

const instance = (state: VrrpState, over: Partial<VrrpInstance> = {}): VrrpInstance => ({
    name: "VI_1",
    state,
    vrid: 51,
    vips: [VIP],
    ...over,
});

/** One host's reading. `lb-01` reports whatever instances it is given. */
const reading = (
    clientId: string,
    instances: VrrpInstance[],
    over: Partial<KeepalivedState> = {},
): KeepalivedState => ({
    clientId,
    running: true,
    collectedAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:01.000Z",
    instances,
    syncGroups: [],
    ...over,
});

const member = (clientId: string, state: VrrpState, over: Partial<VrrpClusterMember> = {}): VrrpClusterMember => ({
    clientId,
    online: true,
    reporting: true,
    instance: instance(state),
    ...over,
});

/** A cluster as the functions below take it; they read its members and nothing else. */
const cluster = (...members: VrrpClusterMember[]): VrrpCluster => ({
    key: "|51|10.0.0.0/24",
    site: null,
    vrid: 51,
    networks: ["10.0.0.0/24"],
    vips: [VIP],
    members,
    health: "ok",
});

const noSite = () => null;
/** Every host online, no sites: the plain case most tests start from. */
const build = (states: KeepalivedState[], online = states.map((s) => s.clientId)) =>
    buildVrrpClusters(states, online, noSite);

describe("stripPrefix", () => {
    it("drops the prefix length and leaves a bare address alone", () => {
        expect(stripPrefix("192.168.1.100/24")).toBe("192.168.1.100");
        expect(stripPrefix("192.168.1.100")).toBe("192.168.1.100");
    });
});

describe("instanceNetworks", () => {
    it("names each network once, sorted", () => {
        const networks = instanceNetworks(
            instance("MASTER", { vips: ["10.0.1.5/24", "10.0.0.10/24", "10.0.0.11/24"] }),
        );
        expect(networks).toEqual(["10.0.0.0/24", "10.0.1.0/24"]);
    });

    it("makes a host route of an address without a prefix", () => {
        expect(instanceNetworks(instance("MASTER", { vips: ["10.0.0.10"] }))).toEqual(["10.0.0.10/32"]);
    });

    it("leaves out what is not an address", () => {
        expect(instanceNetworks(instance("MASTER", { vips: ["not-an-address", VIP] }))).toEqual(["10.0.0.0/24"]);
    });
});

describe("mismatchedVips", () => {
    it("is empty where every member carries the same addresses", () => {
        expect(mismatchedVips([member("a", "MASTER"), member("b", "BACKUP")])).toEqual([]);
    });

    it("takes an address with and without its prefix for the same one", () => {
        const bare = member("b", "BACKUP", { instance: instance("BACKUP", { vips: ["10.0.0.10"] }) });
        expect(mismatchedVips([member("a", "MASTER"), bare])).toEqual([]);
    });

    it("names the member with the short list and what it lacks, written with the prefix", () => {
        const full = member("a", "MASTER", { instance: instance("MASTER", { vips: [VIP, "10.0.0.11/24"] }) });
        const short = member("b", "BACKUP", { instance: instance("BACKUP", { vips: ["10.0.0.10"] }) });
        expect(mismatchedVips([short, full])).toEqual([{ member: short, missing: ["10.0.0.11/24"] }]);
    });

    it("counts a member that is offline as well", () => {
        const offline = member("b", "BACKUP", { online: false, instance: instance("BACKUP", { vips: [] }) });
        expect(mismatchedVips([member("a", "MASTER"), offline]).map((entry) => entry.member.clientId)).toEqual(["b"]);
    });
});

describe("buildVrrpClusters: grouping", () => {
    it("puts the hosts of one VRID and network into one cluster", () => {
        const clusters = build([reading("a", [instance("MASTER")]), reading("b", [instance("BACKUP")])]);
        expect(clusters).toHaveLength(1);
        expect(clusters[0]).toMatchObject({
            key: "|51|10.0.0.0/24",
            site: null,
            vrid: 51,
            networks: ["10.0.0.0/24"],
            vips: [VIP],
            health: "ok",
        });
        expect(clusters[0].members.map((m) => m.clientId)).toEqual(["a", "b"]);
    });

    it("keeps two sites apart that run the same VRID on the same network", () => {
        const states = [reading("a", [instance("MASTER")]), reading("b", [instance("MASTER")])];
        const clusters = buildVrrpClusters(states, ["a", "b"], (id) => (id === "a" ? "dc1" : "dc2"));
        expect(clusters.map((c) => c.key).sort()).toEqual(["dc1|51|10.0.0.0/24", "dc2|51|10.0.0.0/24"]);
    });

    it("keeps a host without a site out of the cluster of one with a site", () => {
        const states = [reading("a", [instance("MASTER")]), reading("b", [instance("BACKUP")])];
        const clusters = buildVrrpClusters(states, ["a", "b"], (id) => (id === "a" ? "dc1" : null));
        expect(clusters).toHaveLength(2);
    });

    it("keeps two segments apart that reuse one VRID", () => {
        const clusters = build([
            reading("a", [instance("MASTER")]),
            reading("b", [instance("MASTER", { vips: ["10.0.1.10/24"] })]),
        ]);
        expect(clusters.map((c) => c.key).sort()).toEqual(["|51|10.0.0.0/24", "|51|10.0.1.0/24"]);
    });

    it("groups an address written without a prefix with the segment it sits on", () => {
        const bare = instance("BACKUP", { vips: ["10.0.0.10"] });
        for (const states of [
            [reading("a", [bare]), reading("b", [instance("MASTER")])],
            [reading("b", [instance("MASTER")]), reading("a", [bare])],
        ]) {
            const clusters = build(states);
            expect(clusters).toHaveLength(1);
            // The host route says nothing the /24 does not.
            expect(clusters[0].networks).toEqual(["10.0.0.0/24"]);
            expect(clusters[0].vips).toEqual([VIP]);
            expect(clusters[0].health).toBe("ok");
        }
    });

    it("joins two groups once an instance carries addresses from both segments", () => {
        const clusters = build([
            reading("a", [instance("BACKUP")]),
            reading("b", [instance("BACKUP", { vips: ["10.0.1.10/24"] })]),
            reading("c", [instance("MASTER", { vips: [VIP, "10.0.1.10/24"] })]),
        ]);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].networks).toEqual(["10.0.0.0/24", "10.0.1.0/24"]);
        expect(clusters[0].members.map((m) => m.clientId).sort()).toEqual(["a", "b", "c"]);
    });

    it("groups instances without any address by their name", () => {
        const clusters = build([
            reading("a", [instance("MASTER", { vips: [] })]),
            reading("b", [instance("BACKUP", { vips: [] })]),
            reading("c", [instance("MASTER", { vips: [], name: "VI_2" })]),
        ]);
        expect(clusters.map((c) => c.key).sort()).toEqual(["|51|name:VI_1", "|51|name:VI_2"]);
    });

    it("does not let the addresses decide the identity: hosts that disagree stay one cluster", () => {
        const clusters = build([
            reading("a", [instance("MASTER", { vips: [VIP, "10.0.0.11/24"] })]),
            reading("b", [instance("BACKUP")]),
        ]);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].vips).toEqual([VIP, "10.0.0.11/24"]);
        expect(clusters[0].health).toBe("vip-mismatch");
    });

    it("keeps a host whose keepalived stopped, with what it last reported", () => {
        const clusters = build([
            reading("a", [instance("MASTER")]),
            reading("b", [], { running: false, lastKnownInstances: [instance("BACKUP")] }),
        ]);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].members.map((m) => [m.clientId, m.reporting])).toEqual([
            ["a", true],
            ["b", false],
        ]);
        expect(clusters[0].health).toBe("degraded");
    });

    it("has no cluster for a host that never reported an instance", () => {
        expect(build([reading("a", [], { running: false })])).toEqual([]);
    });

    it("marks a member whose agent is not connected", () => {
        const clusters = build([reading("a", [instance("MASTER")]), reading("b", [instance("BACKUP")])], ["a"]);
        expect(clusters[0].members.map((m) => m.online)).toEqual([true, false]);
    });
});

describe("buildVrrpClusters: health", () => {
    const healthOf = (states: KeepalivedState[], online?: string[]) => build(states, online)[0].health;

    it("is split-brain with more than one MASTER", () => {
        expect(healthOf([reading("a", [instance("MASTER")]), reading("b", [instance("MASTER")])])).toBe("split-brain");
    });

    it("is no-master where live members exist and none is MASTER", () => {
        expect(healthOf([reading("a", [instance("BACKUP")]), reading("b", [instance("BACKUP")])])).toBe("no-master");
    });

    it("is degraded with a member in FAULT, offline, or alone", () => {
        expect(healthOf([reading("a", [instance("MASTER")]), reading("b", [instance("FAULT")])])).toBe("degraded");
        expect(healthOf([reading("a", [instance("MASTER")]), reading("b", [instance("BACKUP")])], ["a"])).toBe(
            "degraded",
        );
        expect(healthOf([reading("a", [instance("MASTER")])])).toBe("degraded");
    });

    it("is unknown when no member is live", () => {
        expect(healthOf([reading("a", [instance("MASTER")]), reading("b", [instance("BACKUP")])], [])).toBe("unknown");
    });

    it("does not count the last report of an offline member as a MASTER", () => {
        // Both last reported MASTER, but only one of them is there to say so.
        expect(healthOf([reading("a", [instance("MASTER")]), reading("b", [instance("MASTER")])], ["a"])).toBe(
            "degraded",
        );
    });

    it("counts a VIP mismatch over offline members too", () => {
        const states = [
            reading("a", [instance("MASTER", { vips: [VIP, "10.0.0.11/24"] })]),
            reading("b", [instance("BACKUP")]),
        ];
        expect(healthOf(states, ["a"])).toBe("vip-mismatch");
        expect(healthOf(states, [])).toBe("vip-mismatch");
    });

    it("lets a running outage outrank a VIP mismatch", () => {
        const short = { vips: [VIP] };
        const full = { vips: [VIP, "10.0.0.11/24"] };
        expect(healthOf([reading("a", [instance("MASTER", full)]), reading("b", [instance("MASTER", short)])])).toBe(
            "split-brain",
        );
        expect(healthOf([reading("a", [instance("BACKUP", full)]), reading("b", [instance("BACKUP", short)])])).toBe(
            "no-master",
        );
    });

    it("lists the clusters that need attention first, then by VRID", () => {
        const pair = (vrid: number, vip: string, second: VrrpState) => [
            reading(`a${vrid}`, [instance("MASTER", { vrid, vips: [vip] })]),
            reading(`b${vrid}`, [instance(second, { vrid, vips: [vip] })]),
        ];
        const clusters = build([
            ...pair(20, "10.0.2.10/24", "BACKUP"),
            ...pair(10, "10.0.1.10/24", "BACKUP"),
            ...pair(40, "10.0.4.10/24", "FAULT"),
            ...pair(30, "10.0.3.10/24", "MASTER"),
        ]);
        expect(clusters.map((c) => [c.vrid, c.health])).toEqual([
            [30, "split-brain"],
            [40, "degraded"],
            [10, "ok"],
            [20, "ok"],
        ]);
    });
});

describe("clusterCondition", () => {
    it("is single with exactly one live MASTER", () => {
        const { condition, masters } = clusterCondition(cluster(member("a", "MASTER"), member("b", "BACKUP")));
        expect(condition).toBe("single");
        expect(masters.map((m) => m.clientId)).toEqual(["a"]);
    });

    it("is split-brain with several, no-master with none", () => {
        expect(clusterCondition(cluster(member("a", "MASTER"), member("b", "MASTER"))).condition).toBe("split-brain");
        expect(clusterCondition(cluster(member("a", "BACKUP"), member("b", "FAULT"))).condition).toBe("no-master");
    });

    it("is unknown without a live member", () => {
        const stopped = member("b", "BACKUP", { reporting: false });
        const { condition, live } = clusterCondition(cluster(member("a", "MASTER", { online: false }), stopped));
        expect(condition).toBe("unknown");
        expect(live).toEqual([]);
    });

    it("ignores the addresses", () => {
        const short = member("b", "BACKUP", { instance: instance("BACKUP", { vips: [] }) });
        expect(clusterCondition(cluster(member("a", "MASTER"), short)).condition).toBe("single");
    });

    it("names the offline members that last reported MASTER", () => {
        const gone = member("a", "MASTER", { online: false });
        const { condition, unseenMasters } = clusterCondition(cluster(gone, member("b", "BACKUP")));
        expect(condition).toBe("no-master");
        expect(unseenMasters).toEqual([gone]);
    });
});

describe("clusterIncidentState", () => {
    const nameOf = (clientId: string) => `lb-${clientId}`;
    const state = (...members: VrrpClusterMember[]) => clusterIncidentState(cluster(...members), nameOf);

    it("is ok with one MASTER and everybody reporting", () => {
        expect(state(member("a", "MASTER"), member("b", "BACKUP"))).toEqual({ health: "ok", reasons: [] });
    });

    it("is unreachable only when no agent of the cluster is connected", () => {
        expect(state(member("a", "MASTER", { online: false }), member("b", "BACKUP", { online: false }))).toEqual({
            health: "unreachable",
            reasons: [{ type: "unreachable", hosts: ["lb-a", "lb-b"], text: "all agents offline: lb-a, lb-b" }],
        });
    });

    it("does not make a finding of an agent that is offline", () => {
        expect(state(member("a", "MASTER"), member("b", "BACKUP", { online: false }))).toEqual({
            health: "ok",
            reasons: [],
        });
    });

    it("says nothing while the missing MASTER may be the host whose agent is away", () => {
        expect(state(member("a", "MASTER", { online: false }), member("b", "BACKUP"))).toBeNull();
    });

    it("names the masters of a split brain", () => {
        expect(state(member("a", "MASTER"), member("b", "MASTER"))).toEqual({
            health: "split-brain",
            reasons: [{ type: "split-brain", hosts: ["lb-a", "lb-b"], text: "split brain: lb-a, lb-b are MASTER" }],
        });
    });

    it("is no-master when every host is online and none is MASTER", () => {
        expect(state(member("a", "BACKUP"), member("b", "BACKUP"))).toEqual({
            health: "no-master",
            reasons: [{ type: "no-master", text: "no host is MASTER" }],
        });
    });

    it("is degraded by a host whose keepalived does not report, with its last state", () => {
        expect(state(member("a", "MASTER"), member("b", "BACKUP", { reporting: false }))).toEqual({
            health: "degraded",
            reasons: [
                {
                    type: "not-reporting",
                    host: "lb-b",
                    lastState: "BACKUP",
                    text: "lb-b: keepalived not reporting, last BACKUP",
                },
            ],
        });
    });

    it("is degraded by a host in FAULT", () => {
        expect(state(member("a", "MASTER"), member("b", "FAULT"))).toEqual({
            health: "degraded",
            reasons: [{ type: "fault", host: "lb-b", text: "lb-b in FAULT" }],
        });
    });

    it("is degraded as a cluster of one host", () => {
        expect(state(member("a", "MASTER"))).toEqual({
            health: "degraded",
            reasons: [{ type: "single-member", text: "only one host in the cluster" }],
        });
    });

    it("compares the addresses among the online members only", () => {
        const full = member("a", "MASTER", { instance: instance("MASTER", { vips: [VIP, "10.0.0.11/24"] }) });
        const short = member("b", "BACKUP");
        expect(state(full, short)).toEqual({
            health: "vip-mismatch",
            reasons: [{ type: "vip-mismatch", host: "lb-b", missing: ["10.0.0.11/24"], text: "lb-b lacks 10.0.0.11/24" }],
        });
        expect(state(full, { ...short, online: false })).toEqual({ health: "ok", reasons: [] });
    });

    it("keeps every finding, with the outage as the health", () => {
        const full = member("a", "MASTER", { instance: instance("MASTER", { vips: [VIP, "10.0.0.11/24"] }) });
        const result = state(full, member("b", "MASTER"));
        expect(result?.health).toBe("split-brain");
        expect(result?.reasons.map((reason) => reason.type)).toEqual(["split-brain", "vip-mismatch"]);
    });
});

describe("incidentReasonKey", () => {
    it("is the same for a split brain whatever the order of its hosts", () => {
        expect(incidentReasonKey({ type: "split-brain", hosts: ["b", "a"], text: "one" })).toBe(
            incidentReasonKey({ type: "split-brain", hosts: ["a", "b"], text: "two" }),
        );
    });

    it("does not tell two last states of a silent host apart", () => {
        expect(incidentReasonKey({ type: "not-reporting", host: "a", lastState: "MASTER", text: "" })).toBe(
            incidentReasonKey({ type: "not-reporting", host: "a", lastState: "BACKUP", text: "" }),
        );
    });

    it("tells hosts apart, and what a mismatch is about", () => {
        expect(incidentReasonKey({ type: "fault", host: "a", text: "" })).not.toBe(
            incidentReasonKey({ type: "fault", host: "b", text: "" }),
        );
        expect(incidentReasonKey({ type: "vip-mismatch", host: "a", missing: ["10.0.0.10/24"], text: "" })).not.toBe(
            incidentReasonKey({ type: "vip-mismatch", host: "a", missing: ["10.0.0.11/24"], text: "" }),
        );
    });
});

describe("incidentReasonsKey", () => {
    it("is the same for the same findings in another order, each counted once", () => {
        const fault = { type: "fault", host: "a", text: "" } as const;
        const single = { type: "single-member", text: "" } as const;
        expect(incidentReasonsKey([fault, single])).toBe(incidentReasonsKey([single, fault, fault]));
    });

    it("is empty for a cluster without a finding", () => {
        expect(incidentReasonsKey([])).toBe("");
    });
});
