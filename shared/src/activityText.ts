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

/**
 * A block of a cluster event's data -- `cluster`, what was observed, or `incident`, how it was
 * judged -- or an empty one.
 */
function block(event: ActivityRecord, key: "cluster" | "incident"): Record<string, unknown> {
    const value = event.data?.[key];
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function text(record: Record<string, unknown>, key: string): string | null {
    const value = record[key];
    return typeof value === "string" && value.length > 0 ? value : null;
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** "VRID 51 (dc1)", for the server's cluster events. */
function cluster(event: ActivityRecord): string {
    const facts = block(event, "cluster");
    const vrid = facts.vrid ?? event.subject?.vrid;
    const site = text(facts, "site");
    return `VRID ${typeof vrid === "number" ? vrid : "?"}${site ? ` (${site})` : ""}`;
}

/** A cluster health as the incident events name it. */
const HEALTH_LABELS: Record<string, string> = {
    ok: "healthy",
    degraded: "degraded",
    "vip-mismatch": "VIP mismatch",
    "split-brain": "split brain",
    "no-master": "no master",
    unreachable: "all agents offline",
};

function healthLabel(value: unknown): string {
    return typeof value === "string" ? (HEALTH_LABELS[value] ?? value) : "?";
}

/** 42 s, 3 min, 2 h 5 min, 1 d 3 h. */
function formatDuration(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) return `${s} s`;
    const minutes = Math.floor(s / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return minutes % 60 > 0 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
    const days = Math.floor(hours / 24);
    return hours % 24 > 0 ? `${days} d ${hours % 24} h` : `${days} d`;
}

/** The `text` of each reason of an incident event. */
function reasonTexts(event: ActivityRecord): string[] {
    const value = block(event, "incident").reasons;
    if (!Array.isArray(value)) return [];
    return value
        .map((reason) => (typeof reason === "object" && reason !== null ? (reason as { text?: unknown }).text : null))
        .filter((text): text is string => typeof text === "string" && text.length > 0);
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
            const master = text(block(event, "cluster"), "master") ?? "?";
            const previous = str(event, "previousMaster");
            return previous && previous !== master
                ? `${cluster(event)}: ${master} is master now, was ${previous}`
                : `${cluster(event)}: ${master} is master`;
        }
        case "vrrp.split_brain": {
            const masters = strings(block(event, "cluster").masters);
            return `${cluster(event)}: split brain${masters.length > 0 ? ` — ${masters.join(", ")}` : ""}`;
        }
        case "vrrp.master_lost": {
            const previous = str(event, "previousMaster");
            return `${cluster(event)}: no master${previous ? `, was ${previous}` : ""}`;
        }
        case "vrrp.incident_opened":
            return `${cluster(event)}: incident opened, ${healthLabel(block(event, "incident").health)}`;
        case "vrrp.incident_updated": {
            const { health, previousHealth, added, cleared } = block(event, "incident");
            if (previousHealth !== health) {
                return `${cluster(event)}: incident now ${healthLabel(health)}, was ${healthLabel(previousHealth)}`;
            }
            if (strings(added).length > 0) return `${cluster(event)}: incident updated: ${strings(added).join("; ")}`;
            if (strings(cleared).length > 0) {
                return `${cluster(event)}: incident updated, cleared: ${strings(cleared).join("; ")}`;
            }
            return `${cluster(event)}: incident updated`;
        }
        case "vrrp.incident_resolved": {
            const { resolution, durationSeconds } = block(event, "incident");
            if (resolution === "removed") return `${cluster(event)}: incident closed, the cluster no longer exists`;
            return typeof durationSeconds === "number"
                ? `${cluster(event)}: recovered after ${formatDuration(durationSeconds)}`
                : `${cluster(event)}: recovered`;
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

    // An open incident says why; a resolved one has no reasons and lists the hosts below.
    const reasons = reasonTexts(event);
    if (reasons.length > 0) return reasons.join("; ");

    const facts = block(event, "cluster");
    if (event.kind.startsWith("vrrp.") && Array.isArray(facts.members)) {
        // The other hosts of a cluster event, as the server saw them.
        const master = text(facts, "master");
        const others = (facts.members as unknown[])
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
