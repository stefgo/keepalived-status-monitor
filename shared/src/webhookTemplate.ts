import { createTemplateEngine, matchesKindPattern } from "@stefgo/js-template-engine";
import { ACTIVITY_LEVELS } from "./constants.js";
import { activityDetail, activityMessage } from "./activityText.js";
import type { ActivityLevel, ActivityRecord } from "./types.js";

export { matchesKindPattern };

/**
 * The JSON a webhook sends, written by the operator.
 *
 * The language is the one of `@stefgo/js-template-engine`: `{{path}}` placeholders, filters,
 * `$if`, `$map` and `$join`, filled in on the parsed tree, so what an event carries cannot
 * break the JSON or smuggle in keys of its own. Its README describes the grammar. What is
 * decided here is the context -- what a template can read -- and which events a webhook takes.
 *
 * The engine is free of Node, so the settings page previews a template with the same code the
 * server sends it with -- a preview that rendered differently would be worse than none.
 */

/** What a placeholder may start with. Anything else is a typo, and is refused on save. */
export const WEBHOOK_TEMPLATE_ROOTS = ["event", "client", "webhook"] as const;

export interface WebhookContext {
    event: {
        id: string;
        kind: string;
        level: ActivityLevel;
        source: string;
        occurredAt: string;
        receivedAt: string;
        correlationId: string | null;
        subject: Record<string, unknown> | null;
        data: Record<string, unknown> | null;
        /** The sentence the dashboard shows for the event. */
        message: string;
        /** The dashboard's second line, where there is one. */
        detail: string | null;
    };
    /** Null for an event the server reported about nothing but itself. */
    client: {
        id: string;
        name: string;
        hostname: string | null;
        site: string | null;
    } | null;
    webhook: {
        name: string;
    };
}

/** The part of a client a template can see. */
export interface WebhookClientInfo {
    id: string;
    displayName: string | null;
    hostname: string | null;
    site: string | null;
}

export function buildWebhookContext(
    record: ActivityRecord,
    client: WebhookClientInfo | null,
    webhookName: string,
): WebhookContext {
    return {
        event: {
            id: record.id,
            kind: record.kind,
            level: record.level,
            source: record.source,
            occurredAt: record.occurredAt,
            receivedAt: record.receivedAt,
            correlationId: record.correlationId ?? null,
            subject: record.subject ?? null,
            data: record.data ?? null,
            message: activityMessage(record),
            detail: activityDetail(record),
        },
        client: client
            ? {
                  id: client.id,
                  name: client.displayName || client.hostname || client.id,
                  hostname: client.hostname,
                  site: client.site,
              }
            : null,
        webhook: { name: webhookName },
    };
}

// ── Engine ───────────────────────────────────────────────────────────────────

const engine = createTemplateEngine({ roots: WEBHOOK_TEMPLATE_ROOTS });

/** Fills the placeholders of a string as text: for a URL or a header. */
export function renderTemplateText(text: string, context: WebhookContext): string {
    return engine.renderTemplateText(text, context);
}

/** Fills a parsed template. Throws on a template that does not compile. */
export function renderTemplate(template: unknown, context: WebhookContext): unknown {
    return engine.renderTemplate(template, context);
}

/**
 * Why a body template cannot be used, or null. Checked on save, so a broken template is
 * refused in the editor instead of failing on the first event, when nobody is looking.
 */
export function webhookTemplateError(source: string): string | null {
    return engine.templateError(source);
}

/** Why strings with placeholders -- a URL, header values -- cannot be used, or null. */
export function placeholderError(node: unknown): string | null {
    return engine.placeholderError(node);
}

// ── Filters ──────────────────────────────────────────────────────────────────

/** Whether an event passes a webhook's filters: its level at least, and one of its kinds. */
export function webhookAccepts(
    filter: { minLevel: ActivityLevel; kinds: string[] },
    record: Pick<ActivityRecord, "kind" | "level">,
): boolean {
    if (ACTIVITY_LEVELS.indexOf(record.level) < ACTIVITY_LEVELS.indexOf(filter.minLevel)) {
        return false;
    }
    return filter.kinds.length === 0 || filter.kinds.some((p) => matchesKindPattern(record.kind, p));
}

// ── Sample ───────────────────────────────────────────────────────────────────

type SampleFacts = Pick<ActivityRecord, "kind" | "level" | "source" | "subject" | "data"> &
    Partial<Pick<ActivityRecord, "correlationId">>;

/** What every cluster sample shares: the cluster itself. */
const SAMPLE_CLUSTER = { site: "dc1", vrid: 51, networks: ["10.0.0.0/24"], vips: ["10.0.0.10/24", "10.0.0.11/24"] };

/** The hosts of the incident samples: lb-02 has taken over, keepalived on lb-01 has stopped. */
const SAMPLE_INCIDENT_MEMBERS = [
    { host: "lb-02", clientId: "sample-client-2", instanceName: "VI_1", state: "MASTER",
      priority: 90, effectivePriority: 90, online: true, reporting: true,
      readAt: "2026-09-28T10:00:05.300Z", vips: ["10.0.0.10/24", "10.0.0.11/24"] },
    { host: "lb-01", clientId: "sample-client", instanceName: "VI_1", state: "MASTER",
      priority: 100, effectivePriority: 100, online: true, reporting: false,
      readAt: "2026-09-28T10:00:05.100Z", vips: ["10.0.0.10/24", "10.0.0.11/24"] },
];

/** One per shape of `data`, so a preview can show a loop over what the webhook will receive. */
const SAMPLES: SampleFacts[] = [
    {
        kind: "vrrp.state_changed",
        level: "warning",
        source: "agent",
        subject: { instanceName: "VI_1", vrid: 51, interface: "eth0" },
        data: { from: "MASTER", to: "BACKUP", priority: 100, effectivePriority: 90 },
    },
    {
        kind: "vrrp.master_changed",
        level: "info",
        source: "server",
        subject: { instanceName: "VI_1", vrid: 51 },
        data: {
            cluster: {
                ...SAMPLE_CLUSTER,
                health: "ok",
                master: "lb-01",
                masters: ["lb-01"],
                members: [
                    { host: "lb-01", clientId: "sample-client", instanceName: "VI_1", state: "MASTER",
                      priority: 100, effectivePriority: 100, online: true, reporting: true,
                      readAt: "2026-09-28T10:00:05.200Z", vips: ["10.0.0.10/24", "10.0.0.11/24"] },
                    { host: "lb-02", clientId: "sample-client-2", instanceName: "VI_1", state: "BACKUP",
                      priority: 90, effectivePriority: 90, online: true, reporting: true,
                      readAt: "2026-09-28T10:00:05.050Z", vips: ["10.0.0.10/24", "10.0.0.11/24"] },
                ],
            },
            previousMaster: "lb-02",
        },
    },
    {
        kind: "vrrp.incident_opened",
        level: "warning",
        source: "server",
        correlationId: "11111111-1111-4111-8111-111111111111",
        subject: { instanceName: "VI_1", vrid: 51 },
        data: {
            cluster: {
                ...SAMPLE_CLUSTER,
                health: "degraded",
                master: "lb-02",
                masters: ["lb-02"],
                members: SAMPLE_INCIDENT_MEMBERS,
            },
            incident: {
                id: "11111111-1111-4111-8111-111111111111",
                health: "degraded",
                previousHealth: "ok",
                reasons: [
                    { type: "not-reporting", host: "lb-01", lastState: "MASTER",
                      text: "lb-01: keepalived not reporting, last MASTER" },
                ],
                history: ["degraded"],
                openedAt: "2026-09-28T10:00:00.400Z",
                confirmedAt: "2026-09-28T10:00:05.300Z",
            },
        },
    },
    {
        kind: "vrrp.incident_resolved",
        level: "info",
        source: "server",
        correlationId: "11111111-1111-4111-8111-111111111111",
        subject: { instanceName: "VI_1", vrid: 51 },
        data: {
            cluster: {
                ...SAMPLE_CLUSTER,
                health: "ok",
                master: "lb-02",
                masters: ["lb-02"],
                members: [
                    SAMPLE_INCIDENT_MEMBERS[0],
                    { ...SAMPLE_INCIDENT_MEMBERS[1], state: "BACKUP", reporting: true, readAt: "2026-09-28T10:03:09.000Z" },
                ],
            },
            incident: {
                id: "11111111-1111-4111-8111-111111111111",
                health: "ok",
                previousHealth: "degraded",
                reasons: [],
                history: ["degraded"],
                openedAt: "2026-09-28T10:00:00.400Z",
                confirmedAt: "2026-09-28T10:03:09.100Z",
                resolvedAt: "2026-09-28T10:03:04.900Z",
                durationSeconds: 184,
                resolution: "recovered",
            },
        },
    },
    {
        kind: "keepalived.stopped",
        level: "warning",
        source: "agent",
        subject: null,
        data: { pid: 4711, version: "2.3.1" },
    },
];

/**
 * The event a preview and a test delivery are rendered with: the first sample one of the
 * webhook's kinds matches, else a VRRP state change. `vrrp.incident_*` gets the opening.
 */
export function sampleWebhookRecord(kinds: string[] = []): ActivityRecord {
    const now = new Date().toISOString();
    const sample =
        SAMPLES.find((s) => kinds.some((pattern) => matchesKindPattern(s.kind, pattern))) ?? SAMPLES[0];
    return {
        id: "00000000-0000-4000-8000-000000000000",
        occurredAt: now,
        receivedAt: now,
        clientId: "sample-client",
        correlationId: null,
        seen: false,
        ...sample,
    };
}

export const SAMPLE_WEBHOOK_CLIENT: WebhookClientInfo = {
    id: "sample-client",
    displayName: "lb-01",
    hostname: "lb-01.example.net",
    site: "dc1",
};

/** What a new webhook starts with: small, but using each part of the context once. */
export const DEFAULT_WEBHOOK_TEMPLATE = `{
    "text": "[{{event.level}}] {{client.name | default(\\"server\\")}}: {{event.message}}",
    "kind": "{{event.kind}}",
    "occurredAt": "{{event.occurredAt}}",
    "subject": "{{event.subject}}",
    "data": "{{event.data}}"
}`;
