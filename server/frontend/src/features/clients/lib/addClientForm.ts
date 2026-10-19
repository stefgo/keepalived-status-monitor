import { Ipv4OrCidrSchema } from "@kasm/shared";

/** What the add-client flow collects as text, in either branch. */
export interface AddClientInput {
    displayName: string;
    restrictIp: boolean;
    allowedIp: string;
    hostname: string;
    targetAddress: string;
    registrationSecret: string;
}

/**
 * Whether leaving the flow now would throw something away. The connection mode alone does
 * not count: it is one click to choose again. A field of the branch that is not on screen
 * does -- going back to it finds the value still there, so it is not gone yet.
 */
export function hasAddClientInput(input: AddClientInput): boolean {
    return (
        input.restrictIp ||
        [input.displayName, input.allowedIp, input.hostname, input.targetAddress, input.registrationSecret].some(
            (value) => value.trim() !== "",
        )
    );
}

/**
 * Whether the inbound branch holds enough to create the client. The display name is
 * required: the client is created before its agent registers, and until the agent reports a
 * hostname the name is all it is known by. An address, when the restriction is on, has to
 * be one the endpoint takes.
 */
export function inboundDetailsComplete(input: Pick<AddClientInput, "displayName" | "restrictIp" | "allowedIp">): boolean {
    if (input.displayName.trim() === "") return false;
    if (!input.restrictIp) return true;
    const allowedIp = input.allowedIp.trim();
    return allowedIp !== "" && Ipv4OrCidrSchema.safeParse(allowedIp).success;
}
