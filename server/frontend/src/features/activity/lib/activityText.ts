import { ActivityRecord } from "@kasm/shared";

/**
 * Turns an event into the sentence a reader sees.
 *
 * This is the one place a wording exists. An agent reports `vrrp.state_changed` with the two
 * states and nothing else, so an agent of an older version stays useful without knowing how
 * today's dashboard phrases things -- and a wording can be changed here without asking a
 * fleet of hosts to update.
 *
 * A kind nobody here knows still has to read as something: the fallback prints the kind
 * itself, because dropping the line would hide an observation that cannot be made again.
 */

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

export function activityMessage(event: ActivityRecord): string {
    switch (event.kind) {
        case "vrrp.state_changed": {
            const from = str(event, "from") ?? "?";
            const to = str(event, "to") ?? "?";
            return `${instance(event)}: ${from} → ${to}`;
        }
        case "vrrp.instance_added":
            return `${instance(event)} appeared (${str(event, "state") ?? "unknown state"})`;
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

    return null;
}
