import { describe, expect, it } from "vitest";
import { parseJsonDump } from "./jsonDump.js";

const SECRET = "s3cr3t-vrrp";

const entry = (data: Record<string, unknown>, stats?: Record<string, unknown>) => ({ data, stats });

const DUMP = JSON.stringify([
    entry(
        {
            iname: "VI_1",
            state: 2,
            wantstate: 2,
            ifp_ifname: "eth0",
            vrid: 51,
            base_priority: 150,
            effective_priority: 160,
            adver_int: 1,
            vips: ["192.0.2.100/24 dev eth0 scope global", "not an address"],
            last_transition: 1726740745.123456,
            sync_group: "VG_1",
            auth_type: 1,
            auth_data: SECRET,
            auth_pass: SECRET,
        },
        { advert_rcvd: 0, advert_sent: 1234, become_master: 1, note: "text" },
    ),
    entry({ iname: "VI_2", state: 1, adver_int: 1000000 }),
]);

describe("parseJsonDump", () => {
    it("reads every named field of an instance", () => {
        expect(parseJsonDump(DUMP).dump.instances[0]).toEqual({
            name: "VI_1",
            state: "MASTER",
            wantedState: "MASTER",
            interface: "eth0",
            vrid: 51,
            priority: 150,
            effectivePriority: 160,
            advertInterval: 1,
            vips: ["192.0.2.100/24"],
            syncGroup: "VG_1",
            lastTransition: "2024-09-19T10:12:25.123Z",
        });
    });

    it("never lets the VRRP password reach its result", () => {
        const { dump, stats } = parseJsonDump(DUMP);
        const result = JSON.stringify({ dump, stats: [...stats] });

        expect(DUMP).toContain(SECRET);
        expect(result).not.toContain(SECRET);
        expect(result).not.toMatch(/auth/i);
    });

    it("translates keepalived's state numbers and accepts the words", () => {
        const state = (value: unknown) =>
            parseJsonDump(JSON.stringify([entry({ iname: "VI_1", state: value })])).dump.instances[0].state;

        expect([0, 1, 2, 3, 97, 98].map(state)).toEqual(["INIT", "BACKUP", "MASTER", "FAULT", "DELETED", "STOP"]);
        expect(state(42)).toBe("UNKNOWN");
        expect(state("fault")).toBe("FAULT");
        expect(state(null)).toBe("UNKNOWN");
    });

    it("reads an advert interval written as the internal microsecond timer", () => {
        expect(parseJsonDump(DUMP).dump.instances[1].advertInterval).toBe(1);
    });

    it("leaves what an entry does not say at null", () => {
        expect(parseJsonDump(DUMP).dump.instances[1]).toMatchObject({
            wantedState: null,
            interface: null,
            vrid: null,
            vips: [],
            syncGroup: null,
            lastTransition: null,
        });
    });

    it("keeps the numeric counters of an instance and nothing else", () => {
        const { stats } = parseJsonDump(DUMP);

        expect(stats.get("VI_1")).toEqual({ advert_rcvd: 0, advert_sent: 1234, become_master: 1 });
        expect(stats.has("VI_2")).toBe(false);
    });

    it("skips an entry without data or without a name", () => {
        const text = JSON.stringify([null, 7, { stats: {} }, entry({ state: 2 }), entry({ iname: "VI_1" })]);

        expect(parseJsonDump(text).dump.instances.map((i) => i.name)).toEqual(["VI_1"]);
    });

    it("throws on what is not an array or not JSON", () => {
        expect(() => parseJsonDump("{}")).toThrow(/not an array/);
        expect(() => parseJsonDump("VRRP Instance = VI_1")).toThrow();
    });
});
