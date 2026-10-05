import { describe, expect, it } from "vitest";
import { parseDataDump } from "./dataDump.js";

const SECRET = "s3cr3t-vrrp";

/** A dump as keepalived 2.x writes it for one host, shortened to what matters here. */
const DUMP = `
------< Global definitions >------
 Router ID = lb-01
 Default interface = eth0
------< VRRP Topology >------
 VRRP Instance = VI_1
   VRRP Version = 2
   State = MASTER
   Wantstate = MASTER
   Last transition = 1726740745.123456 (Thu Sep 19 10:12:25.123456 2024)
   Interface = eth0
   Using src_ip = 192.0.2.1
   Virtual Router ID = 51
   Priority = 150
   Effective priority = 160
   Advert interval = 1 sec
   Authentication type = SIMPLE_PASSWORD
   Password = ${SECRET}
   auth_pass = ${SECRET}
   Virtual IP (2):
     192.0.2.100/24 dev eth0 scope global
     2001:db8::100/64 dev eth0 scope global
   Unicast peer = 192.0.2.2
   Tracked interfaces :
     Interface = eth1
 VRRP Instance = VI_2
   State = BACKUP
   Interface = eth0
   Virtual Router ID = 52
   Priority = 100
   Advert interval = 500 milli-sec
   Virtual IP (1):
     192.0.2.101/24 dev eth0 scope global
------< VRRP Sync groups >------
 VRRP Sync Group = VG_1, MASTER
   VRRP member instances = 2
     VI_1
     VI_2
`;

describe("parseDataDump", () => {
    it("reads every named field of an instance", () => {
        const { instances } = parseDataDump(DUMP);

        expect(instances[0]).toEqual({
            name: "VI_1",
            state: "MASTER",
            wantedState: "MASTER",
            interface: "eth0",
            vrid: 51,
            priority: 150,
            effectivePriority: 160,
            advertInterval: 1,
            vips: ["192.0.2.100/24", "2001:db8::100/64"],
            syncGroup: "VG_1",
            lastTransition: "2024-09-19T10:12:25.123Z",
        });
    });

    it("never lets the VRRP password reach its result", () => {
        const result = parseDataDump(DUMP);

        expect(DUMP).toContain(SECRET);
        expect(JSON.stringify(result)).not.toContain(SECRET);
        expect(JSON.stringify(result)).not.toMatch(/auth|password/i);
    });

    it("takes over nothing but the fields it names", () => {
        const [instance] = parseDataDump(DUMP).instances;

        expect(Object.keys(instance).sort()).toEqual([
            "advertInterval",
            "effectivePriority",
            "interface",
            "lastTransition",
            "name",
            "priority",
            "state",
            "syncGroup",
            "vips",
            "vrid",
            "wantedState",
        ]);
    });

    it("keeps the instance's own interface when a track section repeats the key", () => {
        expect(parseDataDump(DUMP).instances[0].interface).toBe("eth0");
    });

    it("returns the advert interval in seconds whatever the unit", () => {
        const interval = (value: string) =>
            parseDataDump(` VRRP Instance = VI_1\n   Advert interval = ${value}\n`).instances[0].advertInterval;

        expect(interval("1 sec")).toBe(1);
        expect(interval("500 milli-sec")).toBe(0.5);
        expect(interval("100000 usec")).toBe(0.1);
    });

    it("reads the sync group, its state and its members, and links both ways", () => {
        const { instances, syncGroups } = parseDataDump(DUMP);

        expect(syncGroups).toEqual([{ name: "VG_1", state: "MASTER", instances: ["VI_1", "VI_2"] }]);
        expect(instances.map((i) => i.syncGroup)).toEqual(["VG_1", "VG_1"]);
    });

    it("leaves what a short instance block does not say at null", () => {
        const [, second] = parseDataDump(DUMP).instances;

        expect(second).toMatchObject({
            state: "BACKUP",
            wantedState: null,
            effectivePriority: null,
            lastTransition: null,
            vips: ["192.0.2.101/24"],
        });
    });

    it("skips a key it does not know and a state it does not know", () => {
        const { instances } = parseDataDump(" VRRP Instance = VI_1\n   State = LEADER\n   Flux capacitor = on\n");

        expect(instances).toEqual([expect.objectContaining({ name: "VI_1", state: "UNKNOWN" })]);
    });

    it("is empty for an empty dump", () => {
        expect(parseDataDump("")).toEqual({ instances: [], syncGroups: [] });
    });
});
