import { describe, expect, it } from "vitest";
import { hasAddClientInput, inboundDetailsComplete, type AddClientInput } from "./addClientForm";

const input = (changes: Partial<AddClientInput> = {}): AddClientInput => ({
    displayName: "",
    restrictIp: false,
    allowedIp: "",
    hostname: "",
    targetAddress: "",
    registrationSecret: "",
    ...changes,
});

describe("hasAddClientInput", () => {
    it("is false for the flow as it opens", () => {
        expect(hasAddClientInput(input())).toBe(false);
    });

    it("does not count whitespace", () => {
        expect(hasAddClientInput(input({ displayName: "  ", targetAddress: " " }))).toBe(false);
    });

    it("counts every field of either branch", () => {
        for (const key of ["displayName", "allowedIp", "hostname", "targetAddress", "registrationSecret"] as const) {
            expect(hasAddClientInput(input({ [key]: "x" }))).toBe(true);
        }
    });

    it("counts the ticked restriction", () => {
        expect(hasAddClientInput(input({ restrictIp: true }))).toBe(true);
    });
});

describe("inboundDetailsComplete", () => {
    it("needs a display name", () => {
        expect(inboundDetailsComplete(input())).toBe(false);
        expect(inboundDetailsComplete(input({ displayName: "  " }))).toBe(false);
        expect(inboundDetailsComplete(input({ displayName: "lb-01" }))).toBe(true);
    });

    it("needs a valid address while the restriction is on", () => {
        const named = { displayName: "lb-01", restrictIp: true };
        expect(inboundDetailsComplete(input({ ...named, allowedIp: "" }))).toBe(false);
        expect(inboundDetailsComplete(input({ ...named, allowedIp: "10.0.0" }))).toBe(false);
        expect(inboundDetailsComplete(input({ ...named, allowedIp: "10.0.0.0/24" }))).toBe(true);
    });
});
