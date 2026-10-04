import { describe, expect, it } from "vitest";
import { pageTitle, routeTitle, type TitleSubject } from "./pageTitle";

const names = (known: Partial<Record<TitleSubject, string>>) => (subject: TitleSubject) => known[subject];

describe("pageTitle", () => {
    it("ends in the name of the application", () => {
        expect(pageTitle(["lb01", "Clients"])).toBe("lb01 · Clients · KASM");
    });

    it("is the name of the application alone when nothing names the page", () => {
        expect(pageTitle([])).toBe("KASM");
    });

    it("leaves out a part that is missing", () => {
        expect(pageTitle([undefined, "Clients", null, ""])).toBe("Clients · KASM");
    });
});

describe("routeTitle", () => {
    const area = { nav: { label: "Clients" } };

    it("names the area on its list", () => {
        expect(routeTitle([area, undefined], names({}))).toBe("Clients · KASM");
    });

    it("puts the subject in front of its area", () => {
        expect(routeTitle([area, { subject: "client" }, undefined], names({ client: "lb01" }))).toBe(
            "lb01 · Clients · KASM",
        );
    });

    it("puts a route below the subject in front of it", () => {
        expect(routeTitle([area, { subject: "client" }, { title: "Edit" }], names({ client: "lb01" }))).toBe(
            "Edit · lb01 · Clients · KASM",
        );
    });

    it("calls a route by its title until its subject has a name", () => {
        const handles = [{ nav: { label: "VRRP Clusters" } }, { subject: "cluster" as const, title: "Cluster" }];
        expect(routeTitle(handles, names({ cluster: "VRID 51" }))).toBe("VRID 51 · VRRP Clusters · KASM");
        expect(routeTitle(handles, names({}))).toBe("Cluster · VRRP Clusters · KASM");
    });

    it("leaves out a subject that has neither a name nor a title", () => {
        expect(routeTitle([area, { subject: "client" }], names({}))).toBe("Clients · KASM");
    });

    it("is the name of the application outside every area", () => {
        expect(routeTitle([undefined], names({}))).toBe("KASM");
    });
});
