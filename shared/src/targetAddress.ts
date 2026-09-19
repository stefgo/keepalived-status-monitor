import { DEFAULT_AGENT_PORT } from "./constants.js";

/**
 * The address of an outbound agent, as `host:port`.
 *
 * The value is interpolated into `ws://<address>/ws/agent` and `ws://<address>/ws/register`,
 * so everything a URL could read as something other than a host has to be refused here: a
 * scheme, a path, a query, a fragment, or credentials. A stray slash would otherwise send
 * the agent connection somewhere else without a word.
 *
 * A bare host is accepted and gets the default port appended, because that is the port an
 * agent listens on unless its config says otherwise -- the address stays canonical either
 * way, which is what the reconnect logic compares.
 *
 * Shared because the client editor has to reject an address with the same rule the endpoint
 * that stores it applies; two copies would be two answers to one question.
 *
 * @returns the normalised `host:port`, or null when the value is not a usable address.
 */
export function normaliseTargetAddress(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed || /[\s/@\\?#]/.test(trimmed)) return null;

    try {
        const url = new URL(`ws://${trimmed}`);
        if (!url.hostname) return null;
        // `new URL` keeps only host and port from the authority; anything else in the input
        // was already refused above. An empty port means the input carried none.
        return url.port ? url.host : `${url.host}:${DEFAULT_AGENT_PORT}`;
    } catch {
        return null;
    }
}
