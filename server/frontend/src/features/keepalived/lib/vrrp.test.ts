import { describe, expect, it } from "vitest";
import type { KeepalivedState, VrrpCluster, VrrpClusterMember, VrrpInstance, VrrpState } from "@kasm/shared";
import {
    clusterLabel,
    clusterNetworkKey,
    clusterOf,
    clusterPath,
    clustersAt,
    clusterVipLabel,
    defaultCompareSelection,
    formatInterval,
    groupCounters,
    hasProblemCounts,
    memberKey,
    memberStale,
    silenceLabel,
    statLabel,
    summarizeKeepalived,
    vrrpStateLabel,
    vrrpStateVariant,
} from "./vrrp";

const instance = (state: VrrpState, over: Partial<VrrpInstance> = {}): VrrpInstance => ({
    name: "VI_1",
    state,
    vrid: 51,
    vips: ["10.0.0.10/24"],
    ...over,
});

const reading = (over: Partial<KeepalivedState> = {}): KeepalivedState => ({
    clientId: "a",
    running: true,
    collectedAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:01.000Z",
    instances: [],
    syncGroups: [],
    ...over,
});

const member = (clientId: string, over: Partial<VrrpClusterMember> = {}): VrrpClusterMember => ({
    clientId,
    online: true,
    reporting: true,
    instance: instance("BACKUP"),
    ...over,
});

const cluster = (over: Partial<VrrpCluster> = {}): VrrpCluster => {
    const site = over.site ?? null;
    const vrid = over.vrid === undefined ? 51 : over.vrid;
    const networks = over.networks ?? ["10.0.0.0/24"];
    return {
        key: `${site ?? ""}|${vrid ?? "?"}|${networks[0]}`,
        site,
        vrid,
        networks,
        vips: ["10.0.0.10/24"],
        members: [member("a", { instance: instance("MASTER") }), member("b")],
        health: "ok",
        ...over,
    };
};

describe("summarizeKeepalived", () => {
    it("counts the instances that serve and the ones that failed", () => {
        const instances = [instance("MASTER"), instance("MASTER"), instance("FAULT"), instance("BACKUP")];
        expect(summarizeKeepalived(reading({ instances }))).toEqual({
            status: "Running",
            instances: 4,
            masters: 2,
            faults: 1,
        });
    });

    it("tells a process that could not be read from one that is not there", () => {
        expect(summarizeKeepalived(reading({ error: "permission denied" })).status).toBe("Unreadable");
        expect(summarizeKeepalived(reading({ running: false })).status).toBe("Stopped");
        // Not running is the whole answer; why the reading failed is beside the point.
        expect(summarizeKeepalived(reading({ running: false, error: "no such process" })).status).toBe("Stopped");
    });
});

describe("vrrpStateVariant", () => {
    it("has one colour per state", () => {
        expect(vrrpStateVariant("MASTER")).toBe("success");
        // The healthy standby, not a warning.
        expect(vrrpStateVariant("BACKUP")).toBe("info");
        expect(vrrpStateVariant("FAULT")).toBe("error");
        expect(vrrpStateVariant("INIT")).toBe("warning");
        expect(vrrpStateVariant("STOP")).toBe("warning");
        expect(vrrpStateVariant("UNKNOWN")).toBe("neutral");
        expect(vrrpStateVariant("DELETED")).toBe("neutral");
    });

    it("words a state as shared does", () => {
        expect(vrrpStateLabel("MASTER")).toBe("Master");
    });
});

describe("formatInterval", () => {
    it("writes whole seconds plainly and fractions with two digits", () => {
        expect(formatInterval(1)).toBe("1 s");
        expect(formatInterval(0)).toBe("0 s");
        expect(formatInterval(0.5)).toBe("0.50 s");
        expect(formatInterval(1.004)).toBe("1.00 s");
    });

    it("shows a dash for no value", () => {
        expect(formatInterval(null)).toBe("–");
        expect(formatInterval(undefined)).toBe("–");
    });
});

describe("statLabel", () => {
    it("makes a heading of a counter's key", () => {
        expect(statLabel("advertisements_received")).toBe("Advertisements received");
        expect(statLabel("x")).toBe("X");
    });
});

describe("clusterLabel and clusterVipLabel", () => {
    it("leads the VRID with the site, where there is one", () => {
        expect(clusterLabel(cluster())).toBe("VRID 51");
        expect(clusterLabel(cluster({ site: "dc1" }))).toBe("dc1 / VRID 51");
        expect(clusterLabel(cluster({ vrid: null }))).toBe("VRID ?");
    });

    it("names the addresses, or the instance of a cluster without any", () => {
        expect(clusterVipLabel(cluster({ vips: ["10.0.0.10/24", "10.0.0.11/24"] }))).toBe("10.0.0.10/24, 10.0.0.11/24");
        expect(clusterVipLabel(cluster({ vips: [] }))).toBe("VI_1");
        expect(clusterVipLabel(cluster({ vips: [], members: [] }))).toBeUndefined();
    });
});

describe("clusterNetworkKey", () => {
    it("is the part of the key after site and VRID", () => {
        expect(clusterNetworkKey(cluster())).toBe("10.0.0.0/24");
        expect(clusterNetworkKey(cluster({ site: "dc1" }))).toBe("10.0.0.0/24");
        expect(clusterNetworkKey(cluster({ key: "|51|name:VI_1" }))).toBe("name:VI_1");
    });

    it("keeps a bar inside the site from cutting at the wrong place", () => {
        expect(clusterNetworkKey(cluster({ site: "a|b" }))).toBe("10.0.0.0/24");
    });
});

describe("clustersAt and clusterPath", () => {
    const plain = cluster();
    const sited = cluster({ site: "dc 1/a" });
    const first = cluster({ site: "dc2" });
    const second = cluster({ site: "dc2", networks: ["10.0.1.0/24"] });
    const all = [plain, sited, first, second];

    it("finds the clusters behind one site and VRID", () => {
        expect(clustersAt(all, null, 51)).toEqual([plain]);
        expect(clustersAt(all, "dc2", 51)).toEqual([first, second]);
        expect(clustersAt(all, "dc2", 52)).toEqual([]);
    });

    it("is the VRID alone for a cluster without a site", () => {
        expect(clusterPath(plain, all)).toBe("/clusters/51");
    });

    it("puts the site first, encoded", () => {
        expect(clusterPath(sited, all)).toBe("/clusters/dc%201%2Fa/51");
    });

    it("names the network only where another cluster shares site and VRID", () => {
        expect(clusterPath(first, all)).toBe("/clusters/dc2/51?net=10.0.0.0%2F24");
        expect(clusterPath(second, all)).toBe("/clusters/dc2/51?net=10.0.1.0%2F24");
        expect(clusterPath(first, [first])).toBe("/clusters/dc2/51");
    });

    it("has no page for a cluster without a VRID", () => {
        expect(clusterPath(cluster({ vrid: null }), all)).toBeUndefined();
    });
});

describe("clusterOf", () => {
    const one = cluster();
    const two = cluster({ vrid: 52, members: [member("a", { instance: instance("MASTER", { name: "VI_2" }) })] });

    it("finds the cluster one host's instance takes part in", () => {
        expect(clusterOf([one, two], "a", "VI_2")).toBe(two);
        expect(clusterOf([one, two], "b", "VI_1")).toBe(one);
    });

    it("needs both the host and the instance to match", () => {
        expect(clusterOf([one, two], "b", "VI_2")).toBeUndefined();
        expect(clusterOf([one, two], "c", "VI_1")).toBeUndefined();
    });
});

describe("groupCounters", () => {
    it("puts the hosts side by side, null where a host has no value", () => {
        expect(groupCounters([{ advertisements_received: 10, advertisements_sent: 3 }, { advertisements_received: 7 }])).toEqual([
            {
                title: "Advertisements",
                rows: [
                    { label: "Received", problem: false, values: [10, 7] },
                    { label: "Sent", problem: false, values: [3, null] },
                ],
            },
        ]);
    });

    it("recognises a counter under the name of either dump", () => {
        const groups = groupCounters([{ became_master: 2 }, { become_master: 5 }]);
        expect(groups).toEqual([
            { title: "MASTER role", rows: [{ label: "Became master", problem: false, values: [2, 5] }] },
        ]);
    });

    it("keeps a zero: a counter reported as 0 is not a missing one", () => {
        expect(groupCounters([{ advert_sent: 0 }])[0].rows).toEqual([{ label: "Sent", problem: false, values: [0] }]);
    });

    it("marks the rows of the error groups", () => {
        const groups = groupCounters([{ packet_errors_ttl: 1, auth_failure: 0 }]);
        expect(groups.map((group) => group.title)).toEqual(["Packet errors", "Authentication errors"]);
        expect(groups.flatMap((group) => group.rows).every((row) => row.problem)).toBe(true);
    });

    it("lists a counter this build does not know under its own name, sorted", () => {
        expect(groupCounters([{ zeta_count: 1 }, { alpha_count: 2 }])).toEqual([
            {
                title: "Other",
                rows: [
                    { label: "Alpha count", problem: false, values: [null, 2] },
                    { label: "Zeta count", problem: false, values: [1, null] },
                ],
            },
        ]);
    });

    it("is empty where nobody reports anything", () => {
        expect(groupCounters([null, undefined, {}])).toEqual([]);
    });
});

describe("hasProblemCounts", () => {
    it("is true for a packet or authentication error above zero, under either name", () => {
        expect(hasProblemCounts({ packet_errors_length: 1 })).toBe(true);
        expect(hasProblemCounts({ authtype_mismatch: 3 })).toBe(true);
    });

    it("is false for zeros, for other counters, and for no counters", () => {
        expect(hasProblemCounts({ packet_errors_length: 0, advertisements_received: 99 })).toBe(false);
        expect(hasProblemCounts(null)).toBe(false);
        expect(hasProblemCounts(undefined)).toBe(false);
    });
});

describe("cluster members", () => {
    it("tells two instances of one host apart", () => {
        expect(memberKey(member("a"))).toBe("a:VI_1");
        expect(memberKey(member("a", { instance: instance("BACKUP", { name: "VI_2" }) }))).toBe("a:VI_2");
    });

    it("is stale when the agent is offline or keepalived does not report", () => {
        expect(memberStale(member("a"))).toBe(false);
        expect(memberStale(member("a", { online: false }))).toBe(true);
        expect(memberStale(member("a", { reporting: false }))).toBe(true);
    });

    it("says why a host reports no instances", () => {
        expect(silenceLabel(reading({ error: "permission denied" }))).toBe("Unreadable");
        expect(silenceLabel(reading({ running: false }))).toBe("Stopped");
        // No reading at all: there is no process the agent could have failed to read.
        expect(silenceLabel(undefined)).toBe("Stopped");
    });

    it("compares the members that counted errors until the reader picks others", () => {
        const members = [
            member("a", { instance: instance("MASTER", { stats: { packet_errors_ttl: 2 } }) }),
            member("b", { instance: instance("BACKUP", { stats: { advertisements_received: 9 } }) }),
            member("c"),
        ];
        expect([...defaultCompareSelection(members)]).toEqual(["a:VI_1"]);
        expect(defaultCompareSelection([member("c")]).size).toBe(0);
    });
});
