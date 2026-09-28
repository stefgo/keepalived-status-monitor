import { ACTIVITY_LEVELS } from "./constants.js";
import { activityDetail, activityMessage } from "./activityText.js";
import type { ActivityLevel, ActivityRecord } from "./types.js";

/**
 * The JSON a webhook sends, written by the operator.
 *
 * A template is JSON with `{{path}}` placeholders, and it is filled in on the *parsed* tree,
 * never as text. What an event carries -- an error message from an agent, a hostname -- is
 * put into the tree as a value, so a quote or a brace in it cannot break the JSON or smuggle
 * in keys of its own, and nothing in a template is ever executed.
 *
 * - A string that is nothing but one placeholder, `"{{event.data}}"`, becomes the value
 *   itself, with its type: a number stays a number, an object an object, a missing value null.
 * - A placeholder inside a longer string is written as text: a missing value as "", an object
 *   as its JSON.
 * - `{{path | default(<JSON literal>)}}` stands in for a value that is missing, null or "".
 *
 * Kept free of Node so the settings page previews a template with the same code the server
 * sends it with -- a preview that rendered differently would be worse than none.
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

// ── Placeholders ─────────────────────────────────────────────────────────────

const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const WHOLE_PLACEHOLDER = /^\{\{([^{}]*)\}\}$/;
const SEGMENT = /^[A-Za-z_][A-Za-z0-9_-]*$|^\d+$/;
const DEFAULT_FILTER = /^default\((.*)\)$/;

interface Expression {
    path: string[];
    /** Present only with a `default(...)` filter. */
    fallback?: unknown;
}

/** Parses what stands between the braces. Throws with a message meant for the operator. */
function parseExpression(source: string): Expression {
    // Split at the first bar only: the default's literal may contain one.
    const bar = source.indexOf("|");
    const pathPart = (bar === -1 ? source : source.slice(0, bar)).trim();
    const filter = bar === -1 ? null : source.slice(bar + 1).trim();

    const path = pathPart.split(".");
    if (!path.every((segment) => SEGMENT.test(segment))) {
        throw new Error(`"{{${source}}}": "${pathPart}" is not a path`);
    }
    if (!(WEBHOOK_TEMPLATE_ROOTS as readonly string[]).includes(path[0])) {
        throw new Error(
            `"{{${source}}}": a path starts with ${WEBHOOK_TEMPLATE_ROOTS.join(", ")}`,
        );
    }
    if (filter === null) return { path };

    const fallback = DEFAULT_FILTER.exec(filter);
    if (!fallback) throw new Error(`"{{${source}}}": the only filter is default(...)`);
    try {
        return { path, fallback: JSON.parse(fallback[1]) };
    } catch {
        throw new Error(`"{{${source}}}": default(...) takes a JSON value, such as "text" or 0`);
    }
}

/** Walks own properties only, so `{{event.constructor}}` finds nothing. */
function resolve(context: WebhookContext, expression: Expression): unknown {
    let value: unknown = context;
    for (const segment of expression.path) {
        if (value === null || typeof value !== "object") return fallbackFor(undefined, expression);
        if (!Object.prototype.hasOwnProperty.call(value, segment)) {
            return fallbackFor(undefined, expression);
        }
        value = (value as Record<string, unknown>)[segment];
    }
    return fallbackFor(value, expression);
}

function fallbackFor(value: unknown, expression: Expression): unknown {
    const missing = value === undefined || value === null || value === "";
    return missing && "fallback" in expression ? expression.fallback : value;
}

function asText(value: unknown): string {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
}

/** Fills the placeholders of a string as text: for a URL, a header, an object key. */
export function renderTemplateText(text: string, context: WebhookContext): string {
    return text.replace(PLACEHOLDER, (_, source: string) =>
        asText(resolve(context, parseExpression(source))),
    );
}

/** Fills a parsed template. Throws on a placeholder that does not parse. */
export function renderTemplate(template: unknown, context: WebhookContext): unknown {
    if (typeof template === "string") {
        const whole = WHOLE_PLACEHOLDER.exec(template);
        if (whole) return resolve(context, parseExpression(whole[1])) ?? null;
        return renderTemplateText(template, context);
    }
    if (Array.isArray(template)) return template.map((item) => renderTemplate(item, context));
    if (template !== null && typeof template === "object") {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(template)) {
            result[renderTemplateText(key, context)] = renderTemplate(value, context);
        }
        return result;
    }
    return template;
}

/** Every placeholder in a string, for checking them before anything is rendered. */
function placeholdersIn(text: string): string[] {
    return [...text.matchAll(PLACEHOLDER)].map((match) => match[1]);
}

function collectPlaceholders(node: unknown, into: string[]): void {
    if (typeof node === "string") into.push(...placeholdersIn(node));
    else if (Array.isArray(node)) node.forEach((item) => collectPlaceholders(item, into));
    else if (node !== null && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
            into.push(...placeholdersIn(key));
            collectPlaceholders(value, into);
        }
    }
}

/**
 * Why a body template cannot be used, or null. Checked on save, so a broken template is
 * refused in the editor instead of failing on the first event, when nobody is looking.
 */
export function webhookTemplateError(source: string): string | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(source);
    } catch (e) {
        return `Not valid JSON: ${(e as Error).message}`;
    }
    return placeholderError(parsed);
}

/** Why a string with placeholders -- a URL, a header -- cannot be used, or null. */
export function placeholderError(node: unknown): string | null {
    const found: string[] = [];
    collectPlaceholders(node, found);
    for (const source of found) {
        try {
            parseExpression(source);
        } catch (e) {
            return (e as Error).message;
        }
    }
    return null;
}

// ── Filters ──────────────────────────────────────────────────────────────────

/** `vrrp.*` matches every kind below `vrrp.`; anything without `*` has to match exactly. */
export function matchesKindPattern(kind: string, pattern: string): boolean {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`).test(kind);
}

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

/** The event a preview and a test delivery are rendered with. */
export function sampleWebhookRecord(): ActivityRecord {
    const now = new Date().toISOString();
    return {
        id: "00000000-0000-4000-8000-000000000000",
        occurredAt: now,
        receivedAt: now,
        source: "agent",
        clientId: "sample-client",
        kind: "vrrp.state_changed",
        level: "warning",
        correlationId: null,
        subject: { instanceName: "VI_1", vrid: 51, interface: "eth0" },
        data: { from: "MASTER", to: "BACKUP", priority: 100, effectivePriority: 90 },
        seen: false,
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
