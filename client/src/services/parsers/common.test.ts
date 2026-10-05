import { describe, expect, it } from "vitest";
import { emptyInstance, epochToIso, linkSyncGroups, toInt, toState, vipAddress, type ParsedDump } from "./common.js";

describe("toState", () => {
    it("takes keepalived's spelling in any case", () => {
        expect(toState("MASTER")).toBe("MASTER");
        expect(toState(" backup ")).toBe("BACKUP");
    });

    it("turns anything else into UNKNOWN instead of failing", () => {
        expect(toState("LEADER")).toBe("UNKNOWN");
        expect(toState("")).toBe("UNKNOWN");
        expect(toState(null)).toBe("UNKNOWN");
        expect(toState(undefined)).toBe("UNKNOWN");
    });
});

describe("toInt", () => {
    it("reads the leading number of a string and truncates a number", () => {
        expect(toInt("150")).toBe(150);
        expect(toInt("51 (0x33)")).toBe(51);
        expect(toInt(1.9)).toBe(1);
    });

    it("is null for what is no number", () => {
        expect(toInt("high")).toBeNull();
        expect(toInt(null)).toBeNull();
        expect(toInt(undefined)).toBeNull();
        expect(toInt(Number.NaN)).toBeNull();
    });
});

describe("epochToIso", () => {
    it("turns seconds with fractions into an ISO date", () => {
        expect(epochToIso("1726740745.123456")).toBe("2024-09-19T10:12:25.123Z");
        expect(epochToIso(1726740745)).toBe("2024-09-19T10:12:25.000Z");
    });

    it("is null for zero, a negative value and text", () => {
        expect(epochToIso(0)).toBeNull();
        expect(epochToIso("-1")).toBeNull();
        expect(epochToIso("never")).toBeNull();
        expect(epochToIso(null)).toBeNull();
    });
});

describe("vipAddress", () => {
    it("keeps the address and drops what keepalived appends", () => {
        expect(vipAddress("192.0.2.100/24 dev eth0 scope global")).toBe("192.0.2.100/24");
        expect(vipAddress("  2001:db8::10/64 dev eth0")).toBe("2001:db8::10/64");
        expect(vipAddress("192.0.2.100")).toBe("192.0.2.100");
    });

    it("is null for a line that does not start with an address", () => {
        expect(vipAddress("Unicast peer = 192.0.2.2")).toBeNull();
        expect(vipAddress("")).toBeNull();
    });
});

describe("linkSyncGroups", () => {
    const dump = (): ParsedDump => ({
        instances: [emptyInstance("VI_1"), emptyInstance("VI_2")],
        syncGroups: [{ name: "VG_1", state: "MASTER", instances: [] }],
    });

    it("names the group on an instance the group lists", () => {
        const linked = dump();
        linked.syncGroups[0].instances = ["VI_1"];

        expect(linkSyncGroups(linked).instances.map((i) => i.syncGroup)).toEqual(["VG_1", null]);
    });

    it("lists an instance in the group it names, once", () => {
        const linked = dump();
        linked.instances[1].syncGroup = "VG_1";

        expect(linkSyncGroups(linkSyncGroups(linked)).syncGroups[0].instances).toEqual(["VI_2"]);
    });

    it("leaves an instance alone whose group the dump does not know", () => {
        const linked = dump();
        linked.instances[0].syncGroup = "VG_9";

        const result = linkSyncGroups(linked);
        expect(result.instances[0].syncGroup).toBe("VG_9");
        expect(result.syncGroups[0].instances).toEqual([]);
    });
});
