import { describe, expect, it } from "vitest";
import type { VrrpCluster } from "@kasm/shared";
import { generatePath } from "react-router-dom";
import { LEGACY_ROUTES, activitySearch, clusterPath, paths } from "./paths";

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
        members: [],
        health: "ok",
        ...over,
    };
};

describe("paths", () => {
    it("fills a pattern with its parameter", () => {
        expect(paths.client("h1")).toBe("/clients/h1");
        expect(paths.clientEdit("h1")).toBe("/clients/h1/edit");
        expect(paths.webhook("w1")).toBe("/webhooks/w1");
    });

    it("encodes what a path segment cannot carry", () => {
        expect(paths.webhook("a/b")).toBe("/webhooks/a%2Fb");
    });
});

describe("LEGACY_ROUTES", () => {
    it("lead to a pattern that takes the same parameters", () => {
        const params = { clientId: "h1" };
        expect(LEGACY_ROUTES.map(({ to }) => generatePath(to, params))).toEqual(["/clients/h1", "/clients/h1/edit"]);
    });
});

describe("clusterPath", () => {
    const plain = cluster();
    const sited = cluster({ site: "dc 1/a" });
    const first = cluster({ site: "dc2" });
    const second = cluster({ site: "dc2", networks: ["10.0.1.0/24"] });
    const all = [plain, sited, first, second];

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

describe("activitySearch", () => {
    it("names the search in the query of the activity list", () => {
        expect(activitySearch("VI_1")).toEqual({ pathname: "/activity", search: "?search=VI_1" });
    });
});
