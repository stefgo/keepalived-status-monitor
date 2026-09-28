import type { ActivityRecord } from "./types.js";

/**
 * Turns an event into the sentence a reader sees -- on the dashboard and in a webhook alike.
 *
 * This is the one place a wording exists. An agent reports `vrrp.state_changed` with the two
 * states and nothing else, so an agent of an older version stays useful without knowing how
 * today's dashboard phrases things -- and a wording can be changed here without asking a
 * fleet of hosts to update.
 *
 * A kind nobody here knows still has to read as something: the fallback prints the kind
 * itself, because dropping the line would hide an observation that cannot be made again.
 */

/**
 * How a state reads on screen: `MASTER` → `Master`. keepalived and the wire keep the upper
 * case; only the text a reader sees changes. Takes a plain string, because the activity
 * list gets its states from agents of any version.
 */
export function vrrpStateLabel(state: string): string {
    return state.charAt(0).toUpperCase() + state.slice(1).toLowerCase();
}

/** The server's schedulers as the settings page names them. */
const SCHEDULER_NAMES: Record<string, string> = {
    "notification-cleanup": "Activity cleanup",
    "token-cleanup": "Token cleanup",
};

function instance(event: ActivityRecord): string {
    const name = event.subject?.instanceName;
    return name ? `VRRP instance ${name}` : "A VRRP instance";
}

function str(event: ActivityRecord, key: string): string | null {
    const value = event.data?.[key];
    return typeof value === "string" && value.length > 0 ? value : null;
}

function host(event: ActivityRecord): string {
    return str(event, "clientName") ?? "the client";
}

/** "VRID 51 (dc1)", for the server's cluster events. */
function cluster(event: ActivityRecord): string {
    const vrid = event.data?.vrid ?? event.subject?.vrid;
    const site = str(event, "site");
    return `VRID ${typeof vrid === "number" ? vrid : "?"}${site ? ` (${site})` : ""}`;
}

function names(event: ActivityRecord, key: string): string[] {
    const value = event.data?.[key];
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function activityMessage(event: ActivityRecord): string {
    switch (event.kind) {
        case "vrrp.state_changed": {
            const from = str(event, "from");
            const to = str(event, "to");
            return `${instance(event)}: ${from ? vrrpStateLabel(from) : "?"} → ${to ? vrrpStateLabel(to) : "?"}`;
        }
        case "vrrp.instance_added": {
            const state = str(event, "state");
            return `${instance(event)} appeared (${state ? vrrpStateLabel(state) : "unknown state"})`;
        }
        case "vrrp.instance_removed":
            return `${instance(event)} disappeared`;
        case "keepalived.started": {
            const version = str(event, "version");
            return version ? `keepalived v${version} started` : "keepalived started";
        }
        case "keepalived.stopped":
            return "keepalived stopped";
        case "keepalived.unreadable":
            return "keepalived could not be read";
        case "client.connected":
            return `${host(event)} connected`;
        case "client.disconnected":
            return `${host(event)} disconnected`;
        case "client.registered":
            return `${str(event, "hostname") ?? host(event)} registered`;
        case "scheduler.failed": {
            const scheduler = str(event, "scheduler");
            const error = str(event, "error");
            const what = scheduler ? (SCHEDULER_NAMES[scheduler] ?? scheduler) : "A scheduled job";
            return error ? `${what} failed: ${error}` : `${what} failed`;
        }
        case "vrrp.master_changed": {
            const master = str(event, "master") ?? "?";
            const previous = str(event, "previousMaster");
            return previous && previous !== master
                ? `${cluster(event)}: ${master} is master now, was ${previous}`
                : `${cluster(event)}: ${master} is master`;
        }
        case "vrrp.split_brain": {
            const masters = names(event, "masters");
            return `${cluster(event)}: split brain${masters.length > 0 ? ` — ${masters.join(", ")}` : ""}`;
        }
        case "vrrp.master_lost": {
            const previous = str(event, "previousMaster");
            return `${cluster(event)}: no master${previous ? `, was ${previous}` : ""}`;
        }
        default:
            // A kind from an agent of another version. Better an unpolished line than none.
            return event.kind;
    }
}

/** The second line of an expanded row: what the message left out. */
export function activityDetail(event: ActivityRecord): string | null {
    const error = str(event, "error");
    if (error) return error;

    if (event.kind === "vrrp.state_changed") {
        const priority = event.data?.priority;
        const effective = event.data?.effectivePriority;
        if (typeof priority === "number") {
            return typeof effective === "number" && effective !== priority
                ? `priority ${priority}, effective ${effective}`
                : `priority ${priority}`;
        }
    }

    if (event.kind.startsWith("vrrp.") && Array.isArray(event.data?.members)) {
        // The other hosts of a cluster event, as the server saw them.
        const master = str(event, "master");
        const others = (event.data.members as unknown[])
            .filter(
                (m): m is { host: string; state: string; online?: unknown; reporting?: unknown } =>
                    typeof m === "object" &&
                    m !== null &&
                    typeof (m as { host?: unknown }).host === "string" &&
                    typeof (m as { state?: unknown }).state === "string",
            )
            .filter((m) => m.host !== master)
            // A state that is only the last report is not named as if it were the present one.
            .map((m) =>
                m.online === false
                    ? `${m.host} offline`
                    : m.reporting === false
                      ? `${m.host} not reporting`
                      : `${m.host} ${vrrpStateLabel(m.state)}`,
            );
        if (others.length > 0) return others.join(", ");
    }

    return null;
}
