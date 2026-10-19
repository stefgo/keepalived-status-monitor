import { CONNECTION_MODE, type Client } from "@kasm/shared";
import { formatDate, toTimestamp } from "../../../utils";
import type { OfflineNotice } from "./offlineNotice";

/**
 * Whether an inbound client still waits for its first agent. It is created when its token
 * is issued and has been seen by nobody since; an outbound client is only stored once the
 * server has reached its agent, so it never waits.
 */
export const awaitsRegistration = (client: Pick<Client, "connectionMode" | "lastSeen">): boolean =>
    client.connectionMode !== CONNECTION_MODE.OUTBOUND && !client.lastSeen;

/** Where a client's registration token stands: none open, valid, or run out. */
export type RegistrationTokenState = "none" | "open" | "expired";

export function registrationTokenState(
    expiresAt: string | null | undefined,
    now: number = Date.now(),
): RegistrationTokenState {
    const at = toTimestamp(expiresAt);
    if (at === null) return "none";
    return at > now ? "open" : "expired";
}

/**
 * What the page of a waiting client says in place of its lists: that it waits, and whether
 * the token issued for it can still register the agent.
 */
export function registrationNotice(
    { registrationExpiresAt }: Pick<Client, "registrationExpiresAt">,
    now: number = Date.now(),
    locale?: string,
): OfflineNotice {
    const state = registrationTokenState(registrationExpiresAt, now);
    const until = registrationExpiresAt ? formatDate(registrationExpiresAt, { locale }) : "";
    return {
        title: "This client is waiting for its agent",
        lines: [
            state === "open"
                ? `Register the agent with the token issued for this client. The token is valid until ${until}.`
                : state === "expired"
                  ? `The token issued for this client expired on ${until}. Generate a new one to register the agent.`
                  : "Generate a token to register the agent.",
            "Its VRRP instances are listed once the agent is connected.",
        ],
    };
}
