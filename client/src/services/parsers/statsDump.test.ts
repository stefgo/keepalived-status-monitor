import { describe, expect, it } from "vitest";
import { parseStatsDump } from "./statsDump.js";

const DUMP = `VRRP Instance: VI_1
  Advertisements:
    Received: 0
    Sent: 1234
  Became master: 1
  Released master: 0
  Packet Errors:
    Length: 0
    TTL: 2
  Priority Zero:
    Received: 0
    Sent: 3
VRRP Instance: VI_2
  Advertisements:
    Received: 77
`;

describe("parseStatsDump", () => {
    it("flattens nested headings into snake-cased keys", () => {
        expect(parseStatsDump(DUMP).get("VI_1")).toEqual({
            advertisements_received: 0,
            advertisements_sent: 1234,
            became_master: 1,
            released_master: 0,
            packet_errors_length: 0,
            packet_errors_ttl: 2,
            priority_zero_received: 0,
            priority_zero_sent: 3,
        });
    });

    it("keeps the counters of each instance apart", () => {
        const stats = parseStatsDump(DUMP);

        expect([...stats.keys()]).toEqual(["VI_1", "VI_2"]);
        expect(stats.get("VI_2")).toEqual({ advertisements_received: 77 });
    });

    it("skips a value that is no number and a line before the first instance", () => {
        const stats = parseStatsDump("Sent: 5\nVRRP Instance: VI_1\n  Sent: many\n  Received: 4\n");

        expect(stats.get("VI_1")).toEqual({ received: 4 });
    });

    it("is empty for an empty dump", () => {
        expect(parseStatsDump("").size).toBe(0);
    });
});
