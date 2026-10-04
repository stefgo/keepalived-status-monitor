import { describe, expect, it } from "vitest";
import type { ActivityRecord, VrrpCluster, VrrpClusterMember } from "@kasm/shared";
import { paths } from "../../../lib/paths";
import { activityLinks } from "./activityLinks";

const event = (over: Partial<ActivityRecord> = {}): ActivityRecord => ({
    id: "e",
    kind: "vrrp.state_changed",
    occurredAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:00.000Z",
    source: "agent",
    clientId: "a",
    level: "info",
    seen: true,
    ...over,
});

const member = (clientId: string, name: string): VrrpClusterMember => ({
    clientId,
    online: true,
    reporting: true,
    instance: { name, state: "BACKUP", vrid: 51, vips: ["10.0.0.10/24"] },
});

const cluster = (over: Partial<VrrpCluster> = {}): VrrpCluster => ({
    key: `|${over.vrid ?? 51}|${over.networks?.[0] ?? "10.0.0.0/24"}`,
    site: null,
    vrid: 51,
    networks: ["10.0.0.0/24"],
    vips: ["10.0.0.10/24"],
    members: [member("a", "VI_WEB"), member("b", "VI_WEB")],
    health: "ok",
    ...over,
});

const known = new Set(["a", "b"]);

describe("activityLinks", () => {
    it("links the host and the cluster of its instance", () => {
        const links = activityLinks(event({ subject: { instanceName: "VI_WEB", vrid: 51 } }), known, [cluster()]);
        expect(links).toEqual({ client: paths.client("a"), cluster: "/clusters/51" });
    });

    it("links no host that is no longer known", () => {
        expect(activityLinks(event({ clientId: "gone" }), known, [])).toEqual({});
    });

    it("finds the cluster by its VRID where the event names no instance of a known host", () => {
        const links = activityLinks(event({ clientId: null, source: "server", subject: { vrid: 51 } }), known, [
            cluster(),
        ]);
        expect(links).toEqual({ cluster: "/clusters/51" });
    });

    it("links no cluster by a VRID that two clusters use", () => {
        const clusters = [cluster(), cluster({ networks: ["10.0.1.0/24"], members: [member("c", "VI_WEB")] })];
        expect(activityLinks(event({ clientId: null, subject: { vrid: 51 } }), known, clusters)).toEqual({});
    });

    it("names the network in the address where two clusters share the VRID", () => {
        const clusters = [cluster(), cluster({ networks: ["10.0.1.0/24"], members: [member("c", "VI_WEB")] })];
        const links = activityLinks(event({ subject: { instanceName: "VI_WEB", vrid: 51 } }), known, clusters);
        expect(links.cluster).toMatch(/^\/clusters\/51\?net=/);
    });

    it("links no cluster for an instance no host reports any more", () => {
        const links = activityLinks(event({ subject: { instanceName: "VI_GONE" } }), known, [cluster()]);
        expect(links).toEqual({ client: paths.client("a") });
    });
});
