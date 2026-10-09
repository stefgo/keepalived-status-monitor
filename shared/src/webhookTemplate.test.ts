import { describe, expect, it } from "vitest";
import type { ActivityRecord } from "./types.js";
import {
    DEFAULT_WEBHOOK_TEMPLATE,
    SAMPLE_WEBHOOK_CLIENT,
    buildWebhookContext,
    placeholderError,
    renderTemplate,
    sampleWebhookRecord,
    webhookAccepts,
    webhookTemplateError,
    type WebhookContext,
} from "./webhookTemplate.js";

const record = (over: Partial<ActivityRecord> = {}): ActivityRecord => ({
    id: "e1",
    occurredAt: "2026-01-01T00:00:00.000Z",
    receivedAt: "2026-01-01T00:00:01.000Z",
    source: "agent",
    clientId: "c1",
    kind: "vrrp.state_changed",
    level: "warning",
    seen: false,
    subject: { instanceName: "VI_1", vrid: 51 },
    data: {
        from: "MASTER",
        to: "BACKUP",
        priority: 100,
        masters: ["lb-01", "lb-02"],
        members: [
            { host: "lb-01", state: "MASTER" },
            { host: "lb-02", state: "BACKUP" },
        ],
        none: [],
        zero: 0,
        empty: "",
        nothing: null,
    },
    ...over,
});

const CLIENT = { id: "c1", displayName: "lb-01", hostname: "lb-01.example.net", site: "dc1" };

const context = (over: Partial<ActivityRecord> = {}): WebhookContext =>
    buildWebhookContext(record(over), CLIENT, "Chat");

describe("the roots of a webhook template", () => {
    // The grammar is tested where it lives, in @stefgo/js-template-engine. What is decided
    // here is what a path may start with.
    it("reads the event, the client and the webhook", () => {
        expect(webhookTemplateError('{"text": "{{event.kind}} {{client.name}} {{webhook.name}}"}')).toBeNull();
        expect(placeholderError(["https://example.org/{{client.id}}", "Bearer {{webhook.name}}"])).toBeNull();
    });

    it("has nothing to say about the template a new webhook starts with", () => {
        expect(webhookTemplateError(DEFAULT_WEBHOOK_TEMPLATE)).toBeNull();
    });

    it("refuses a path that starts with anything else", () => {
        expect(webhookTemplateError('{"text": "{{host.name}}"}')).toBe(
            'text: "{{host.name}}": a path starts with event, client, webhook',
        );
        expect(placeholderError("{{host.name}}")).toBe('"{{host.name}}": a path starts with event, client, webhook');
    });
});

describe("buildWebhookContext", () => {
    it("carries the event with the sentence the dashboard shows", () => {
        expect(context().event).toMatchObject({
            id: "e1",
            kind: "vrrp.state_changed",
            level: "warning",
            correlationId: null,
            message: "VRRP instance VI_1: Master → Backup",
            detail: "priority 100",
        });
    });

    it("names the client by its display name, then its hostname, then its id", () => {
        const name = (displayName: string | null, hostname: string | null) =>
            buildWebhookContext(record(), { ...CLIENT, displayName, hostname }, "Chat").client?.name;
        expect(name("lb-01", "lb-01.example.net")).toBe("lb-01");
        expect(name("", "lb-01.example.net")).toBe("lb-01.example.net");
        expect(name(null, null)).toBe("c1");
    });

    it("has no client for an event the server reported about itself", () => {
        expect(buildWebhookContext(record(), null, "Chat").client).toBeNull();
    });
});

describe("webhookAccepts", () => {
    it("wants the level at least", () => {
        const filter = { minLevel: "warning" as const, kinds: [] };
        expect(webhookAccepts(filter, { kind: "x", level: "info" })).toBe(false);
        expect(webhookAccepts(filter, { kind: "x", level: "warning" })).toBe(true);
        expect(webhookAccepts(filter, { kind: "x", level: "error" })).toBe(true);
    });

    it("wants one of the kinds, or any kind where none is named", () => {
        const filter = { minLevel: "trace" as const, kinds: ["vrrp.*", "keepalived.stopped"] };
        expect(webhookAccepts(filter, { kind: "vrrp.master_lost", level: "info" })).toBe(true);
        expect(webhookAccepts(filter, { kind: "keepalived.stopped", level: "info" })).toBe(true);
        expect(webhookAccepts(filter, { kind: "keepalived.started", level: "info" })).toBe(false);
    });
});

describe("sampleWebhookRecord", () => {
    it("is a VRRP state change unless the kinds say otherwise", () => {
        expect(sampleWebhookRecord().kind).toBe("vrrp.state_changed");
        expect(sampleWebhookRecord(["client.*"]).kind).toBe("vrrp.state_changed");
    });

    it("is the first sample one of the kinds matches", () => {
        expect(sampleWebhookRecord(["keepalived.*"]).kind).toBe("keepalived.stopped");
        expect(sampleWebhookRecord(["client.*", "vrrp.master_changed"]).kind).toBe("vrrp.master_changed");
    });

    it("is the opening for the incident kinds", () => {
        expect(sampleWebhookRecord(["vrrp.incident_*"]).kind).toBe("vrrp.incident_opened");
    });

    it("renders with the default template", () => {
        const sample = sampleWebhookRecord(["vrrp.incident_resolved"]);
        const body = renderTemplate(
            JSON.parse(DEFAULT_WEBHOOK_TEMPLATE),
            buildWebhookContext(sample, SAMPLE_WEBHOOK_CLIENT, "Chat"),
        );
        expect(body).toMatchObject({
            text: "[info] lb-01: VRID 51 (dc1): recovered after 3 min",
            kind: "vrrp.incident_resolved",
            subject: { instanceName: "VI_1", vrid: 51 },
        });
    });
});
