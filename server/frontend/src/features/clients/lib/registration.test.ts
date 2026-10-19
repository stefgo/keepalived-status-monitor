import { describe, expect, it } from "vitest";
import { formatDate } from "../../../utils";
import { awaitsRegistration, registrationNotice, registrationTokenState } from "./registration";

const NOW = Date.parse("2026-10-19T12:00:00.000Z");
const LATER = "2026-10-19T12:30:00.000Z";
const EARLIER = "2026-10-19T11:30:00.000Z";
const at = (date: string) => formatDate(date, { locale: "en-US" });

describe("awaitsRegistration", () => {
    it("is an inbound client nobody has seen yet", () => {
        expect(awaitsRegistration({ connectionMode: "inbound", lastSeen: null })).toBe(true);
    });

    it("is not a client that has connected", () => {
        expect(awaitsRegistration({ connectionMode: "inbound", lastSeen: EARLIER })).toBe(false);
    });

    it("is never an outbound client", () => {
        expect(awaitsRegistration({ connectionMode: "outbound", lastSeen: null })).toBe(false);
    });
});

describe("registrationTokenState", () => {
    it("tells an open token from one that ran out", () => {
        expect(registrationTokenState(LATER, NOW)).toBe("open");
        expect(registrationTokenState(EARLIER, NOW)).toBe("expired");
    });

    it("is none without a token", () => {
        expect(registrationTokenState(null, NOW)).toBe("none");
        expect(registrationTokenState(undefined, NOW)).toBe("none");
    });
});

describe("registrationNotice", () => {
    it("says until when the token registers the agent", () => {
        const notice = registrationNotice({ registrationExpiresAt: LATER }, NOW, "en-US");
        expect(notice.title).toBe("This client is waiting for its agent");
        expect(notice.lines[0]).toContain(`valid until ${at(LATER)}`);
    });

    it("asks for a new token once it ran out", () => {
        const notice = registrationNotice({ registrationExpiresAt: EARLIER }, NOW, "en-US");
        expect(notice.lines[0]).toBe(
            `The token issued for this client expired on ${at(EARLIER)}. Generate a new one to register the agent.`,
        );
    });

    it("asks for a token when none is open", () => {
        const notice = registrationNotice({ registrationExpiresAt: null }, NOW, "en-US");
        expect(notice.lines[0]).toBe("Generate a token to register the agent.");
    });
});
