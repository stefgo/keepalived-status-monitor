import { describe, expect, it } from "vitest";
import type { VrrpState } from "@kasm/shared";
import { virtualIpRows } from "./virtualIps";
import type { NamedClusterMember, NamedVrrpCluster } from "./vrrp";

const member = (
    hostName: string,
    state: VrrpState,
    vips: string[],
    over: Partial<NamedClusterMember> = {},
): NamedClusterMember => ({
    clientId: hostName,
    hostName,
    online: true,
    reporting: true,
    instance: { name: "VI_1", state, vrid: 51, vips },
    ...over,
});

const cluster = (key: string, vips: string[], members: NamedClusterMember[]): NamedVrrpCluster => ({
    key,
    site: null,
    vrid: 51,
    networks: ["10.0.0.0/24"],
    vips,
    members,
    health: "ok",
});

const VIP = "10.0.0.10/24";

const rows = (...clusters: NamedVrrpCluster[]) =>
    virtualIpRows(clusters).map((row) => `${row.address} ${row.state} ${row.holders.map((m) => m.hostName).join(",")}`);

describe("virtualIpRows", () => {
    it("says which MASTER serves an address", () => {
        const c = cluster("a", [VIP], [member("lb-01", "MASTER", [VIP]), member("lb-02", "BACKUP", [VIP])]);
        expect(rows(c)).toEqual([`${VIP} served lb-01`]);
    });

    it("matches an address with and without its prefix", () => {
        const c = cluster("a", [VIP], [member("lb-01", "MASTER", ["10.0.0.10"]), member("lb-02", "BACKUP", [VIP])]);
        expect(rows(c)).toEqual([`${VIP} served lb-01`]);
    });

    it("tells a split, an unserved and a partial address apart", () => {
        const split = cluster("a", [VIP], [member("lb-01", "MASTER", [VIP]), member("lb-02", "MASTER", [VIP])]);
        const unserved = cluster("b", [VIP], [member("lb-03", "BACKUP", [VIP]), member("lb-04", "BACKUP", [VIP])]);
        const partial = cluster("c", [VIP], [member("lb-05", "MASTER", [VIP]), member("lb-06", "BACKUP", [])]);
        expect(rows(partial, unserved, split)).toEqual([
            `${VIP} split lb-01,lb-02`,
            `${VIP} unserved `,
            `${VIP} partial lb-05`,
        ]);
    });

    it("does not count a MASTER whose agent is offline", () => {
        const c = cluster("a", [VIP], [
            member("lb-01", "MASTER", [VIP], { online: false }),
            member("lb-02", "BACKUP", [VIP]),
        ]);
        expect(rows(c)).toEqual([`${VIP} unserved `]);
    });

    it("knows nothing about an address while no member of its cluster reports", () => {
        const c = cluster("a", [VIP], [member("lb-01", "MASTER", [VIP], { reporting: false })]);
        expect(rows(c)).toEqual([`${VIP} unknown `]);
    });
});
