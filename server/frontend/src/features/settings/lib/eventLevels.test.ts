import { describe, expect, it } from "vitest";
import { ACTIVITY_KINDS } from "@kasm/shared";
import { DEFAULT_CHOICE, EVENT_LEVEL_GROUPS, choiceOf, levelChoices, withChoice } from "./eventLevels";

describe("EVENT_LEVEL_GROUPS", () => {
    it("holds every kind once", () => {
        const kinds = EVENT_LEVEL_GROUPS.flatMap((group) => group.kinds);
        expect([...kinds].sort()).toEqual([...ACTIVITY_KINDS].sort());
    });

    it("has a heading for every kind this build knows", () => {
        expect(EVENT_LEVEL_GROUPS.map((group) => group.label)).not.toContain("Other");
    });

    it("keeps the kinds of one prefix together, wherever they stand in the list", () => {
        const vrrp = EVENT_LEVEL_GROUPS.find((group) => group.label === "VRRP");
        expect(vrrp?.kinds).toContain("vrrp.state_changed");
        expect(vrrp?.kinds).toContain("vrrp.incident_resolved");
    });
});

describe("levelChoices", () => {
    it("names the level a kind has when left alone", () => {
        expect(levelChoices("vrrp.state_changed")[0]).toEqual({
            value: DEFAULT_CHOICE,
            label: "Default (info / warning / error)",
        });
    });

    it("offers none for a kind that can be switched off", () => {
        expect(levelChoices("client.connected").map((c) => c.value)).toEqual([
            DEFAULT_CHOICE, "trace", "info", "warning", "error", "none",
        ]);
    });

    it("does not offer none for a kind a group depends on", () => {
        expect(levelChoices("vrrp.incident_opened").map((c) => c.value)).not.toContain("none");
    });
});

describe("choiceOf", () => {
    it("is the default for a kind the setting does not name", () => {
        expect(choiceOf("keepalived.stopped=error", "vrrp.instance_added")).toBe(DEFAULT_CHOICE);
    });

    it("is what the setting says", () => {
        expect(choiceOf("keepalived.stopped=error, client.connected=none", "client.connected")).toBe("none");
    });
});

describe("withChoice", () => {
    it("adds an entry", () => {
        expect(withChoice("", "keepalived.stopped", "error")).toBe("keepalived.stopped=error");
    });

    it("replaces an entry", () => {
        expect(withChoice("keepalived.stopped=error, vrrp.instance_added=trace", "keepalived.stopped", "info")).toBe(
            "vrrp.instance_added=trace, keepalived.stopped=info",
        );
    });

    it("removes the entry of a kind set back to its default", () => {
        expect(withChoice("keepalived.stopped=error, vrrp.instance_added=trace", "keepalived.stopped", DEFAULT_CHOICE)).toBe(
            "vrrp.instance_added=trace",
        );
    });

    // Written into config.yaml by hand, for a kind only a newer agent reports.
    it("keeps an entry this page has no row for", () => {
        expect(withChoice("vrrp.preempted=none", "keepalived.stopped", "error")).toBe(
            "vrrp.preempted=none, keepalived.stopped=error",
        );
    });

    it("does not write what the server would refuse", () => {
        expect(withChoice("", "vrrp.incident_resolved", "none")).toBe("");
    });
});
