import { describe, expect, it } from "vitest";
import { breadcrumb, parentCrumb } from "./breadcrumb";
import type { TitleSubject } from "./pageTitle";

const names = (known: Partial<Record<TitleSubject, string>> = {}) => (subject: TitleSubject) => known[subject];

const shell = { pathname: "/" };
const clients = { pathname: "/clients", handle: { nav: { label: "Clients" } } };
const clusters = { pathname: "/clusters", handle: { nav: { label: "VRRP Clusters" } } };

describe("breadcrumb", () => {
    it("is empty on a list, which has nothing above it", () => {
        expect(breadcrumb([shell, clients, { pathname: "/clients/" }], names())).toEqual([]);
    });

    it("is empty outside every area", () => {
        expect(breadcrumb([shell, { pathname: "/nowhere", handle: { title: "Not Found" } }], names())).toEqual([]);
    });

    it("leads from the area to the subject, which is the open page and no link", () => {
        const matches = [
            shell,
            clients,
            { pathname: "/clients/a", handle: { subject: "client" as const } },
            { pathname: "/clients/a/" },
        ];
        expect(breadcrumb(matches, names({ client: "lb01" }))).toEqual([
            { label: "Clients", to: "/clients" },
            { label: "lb01" },
        ]);
    });

    it("links every route above a form", () => {
        const matches = [
            shell,
            clients,
            { pathname: "/clients/a", handle: { subject: "client" as const } },
            { pathname: "/clients/a/edit", handle: { title: "Edit" } },
        ];
        expect(breadcrumb(matches, names({ client: "lb01" }))).toEqual([
            { label: "Clients", to: "/clients" },
            { label: "lb01", to: "/clients/a" },
            { label: "Edit" },
        ]);
    });

    it("calls a subject by its title until it has a name, and leaves it out without either", () => {
        const cluster = { pathname: "/clusters/51", handle: { subject: "cluster" as const, title: "Cluster" } };
        expect(breadcrumb([shell, clusters, cluster], names())).toEqual([
            { label: "VRRP Clusters", to: "/clusters" },
            { label: "Cluster" },
        ]);

        const client = { pathname: "/clients/a", handle: { subject: "client" as const } };
        expect(breadcrumb([shell, clients, client], names())).toEqual([]);
    });
});

describe("parentCrumb", () => {
    it("is the link before the open page", () => {
        const trail = [{ label: "Clients", to: "/clients" }, { label: "lb01", to: "/clients/a" }, { label: "Edit" }];
        expect(parentCrumb(trail)).toEqual({ label: "lb01", to: "/clients/a" });
    });

    it("looks past a link that leads nowhere", () => {
        const trail = [{ label: "Clients", to: "/clients" }, { label: "lb01" }, { label: "Edit" }];
        expect(parentCrumb(trail)).toEqual({ label: "Clients", to: "/clients" });
    });

    it("is nothing without a trail", () => {
        expect(parentCrumb([])).toBeUndefined();
    });
});
