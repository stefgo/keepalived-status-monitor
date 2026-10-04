import { describe, expect, it } from "vitest";
import {
    EMPTY_VALUE,
    clientName,
    describeFailure,
    formatDate,
    formatTime,
    getErrorMessage,
    plural,
} from "./utils";

// Noon UTC is the same calendar day in every zone the tests may run in.
const date = "2026-10-03T12:00:30Z";

describe("formatDate", () => {
    it("writes day, month, year and the time without seconds", () => {
        expect(formatDate(date)).toMatch(/^03\.10\.2026, \d{2}:\d{2}$/);
    });

    it("adds the seconds where asked", () => {
        expect(formatDate(date, { seconds: true })).toMatch(/^03\.10\.2026, \d{2}:\d{2}:30$/);
    });

    it("takes a Date and a timestamp as well", () => {
        expect(formatDate(new Date(date))).toBe(formatDate(date));
        expect(formatDate(Date.parse(date))).toBe(formatDate(date));
    });

    it("reads SQLite's format as UTC", () => {
        expect(formatDate("2026-10-03 12:00:30", { seconds: true })).toBe(formatDate(date, { seconds: true }));
    });

    it("shows the empty value when there is no date, or none that parses", () => {
        expect(formatDate(null)).toBe(EMPTY_VALUE);
        expect(formatDate(undefined)).toBe(EMPTY_VALUE);
        expect(formatDate("")).toBe(EMPTY_VALUE);
        expect(formatDate("yesterday")).toBe(EMPTY_VALUE);
    });
});

describe("formatTime", () => {
    it("writes the time of day alone, with seconds", () => {
        expect(formatTime(date)).toMatch(/^\d{2}:\d{2}:30$/);
    });

    it("agrees with the time formatDate writes", () => {
        expect(formatDate(date, { seconds: true }).endsWith(formatTime(date))).toBe(true);
        expect(formatTime("2026-10-03 12:00:30")).toBe(formatTime(date));
    });

    it("shows the empty value when there is no date", () => {
        expect(formatTime(null)).toBe(EMPTY_VALUE);
        expect(formatTime("yesterday")).toBe(EMPTY_VALUE);
    });
});

describe("plural", () => {
    it("adds an s for anything but one", () => {
        expect(plural(1, "host")).toBe("1 host");
        expect(plural(0, "host")).toBe("0 hosts");
        expect(plural(3, "host")).toBe("3 hosts");
    });

    it("takes the plural of a noun that has no plain one", () => {
        expect(plural(1, "address", "addresses")).toBe("1 address");
        expect(plural(2, "address", "addresses")).toBe("2 addresses");
    });
});

describe("clientName", () => {
    it("is the display name, or the hostname while there is none", () => {
        expect(clientName({ displayName: "lb-01", hostname: "lb-01.example.net" })).toBe("lb-01");
        expect(clientName({ displayName: null, hostname: "lb-01.example.net" })).toBe("lb-01.example.net");
        expect(clientName({ hostname: "lb-01.example.net" })).toBe("lb-01.example.net");
    });

    // `||`, not `??`: a row must never show no name at all.
    it("falls back for an empty display name as well", () => {
        expect(clientName({ displayName: "", hostname: "lb-01.example.net" })).toBe("lb-01.example.net");
    });
});

describe("getErrorMessage", () => {
    it("is the message of an Error and a string as it is", () => {
        expect(getErrorMessage(new Error("no route to host"))).toBe("no route to host");
        expect(getErrorMessage("no route to host")).toBe("no route to host");
    });

    it("writes anything else as JSON", () => {
        expect(getErrorMessage({ code: 502 })).toBe('{"code":502}');
        expect(getErrorMessage(null)).toBe("null");
    });

    it("still answers for what cannot be written as JSON", () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(getErrorMessage(circular)).toBe("[object Object]");
    });
});

describe("describeFailure", () => {
    it("says what did not happen, and the server's reason why", () => {
        expect(describeFailure("Could not delete the client", new Error("Client is online"))).toEqual({
            title: "Could not delete the client",
            description: "Client is online",
        });
    });
});
