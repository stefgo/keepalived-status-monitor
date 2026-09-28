import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Send, Webhook as WebhookIcon, X } from "lucide-react";
import { ACTIVITY_LEVELS, WEBHOOK_METHODS, type Webhook, type WebhookTestResult } from "@kasm/shared";
import {
    ActionButton,
    Button,
    Card,
    Checkbox,
    Input,
    Select,
    Textarea,
    useConfirm,
} from "@stefgo/react-ui-components";
import { apiFetch } from "../../../lib/apiFetch";
import { getErrorMessage } from "../../../utils";
import { LoadingIndicator } from "../../../components/LoadingIndicator";
import { NotFoundCard } from "../../../components/NotFoundCard";
import { describeDiscardWebhookChanges } from "../confirmations";
import { EMPTY_DRAFT, PLACEHOLDERS, draftFrom, inputFrom, previewBody, type WebhookDraft } from "../lib/webhookForm";

/** Sends a request and throws with the server's reason when it refuses. */
async function send(url: string, method: string, body: unknown): Promise<Response> {
    const response = await apiFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `The server answered ${response.status}`);
    }
    return response;
}

type Loaded = { status: "loading" } | { status: "missing" } | { status: "found"; webhook: Webhook };

/**
 * `/webhooks/new` and `/webhooks/:webhookId`. The webhook is read from the list endpoint --
 * there is no single-item one, and the list is short. A link to an id that is gone gets the
 * way back instead of an empty form.
 */
export const WebhookEditorRoute = () => {
    const { webhookId } = useParams();
    const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });

    useEffect(() => {
        if (!webhookId) return;
        let cancelled = false;
        (async () => {
            let next: Loaded = { status: "missing" };
            try {
                const res = await apiFetch("/api/v1/webhooks");
                if (res.ok) {
                    const webhook = ((await res.json()) as Webhook[]).find((w) => w.id === webhookId);
                    if (webhook) next = { status: "found", webhook };
                }
            } catch (e) {
                console.error(e);
            }
            if (!cancelled) setLoaded(next);
        })();
        return () => {
            cancelled = true;
        };
    }, [webhookId]);

    if (!webhookId) return <WebhookEditor webhook={null} />;
    if (loaded.status === "loading") return <LoadingIndicator label="Loading webhook…" />;
    if (loaded.status === "missing") {
        return (
            <NotFoundCard title="Webhook not found" backTo="/webhooks" backLabel="Back to webhooks">
                There is no webhook with this id. It may have been deleted.
            </NotFoundCard>
        );
    }
    // Keyed, so pointing the route at another webhook starts the form over.
    return <WebhookEditor key={loaded.webhook.id} webhook={loaded.webhook} />;
};

/**
 * Adds or edits one webhook, on a page of its own. Leaving is a navigation, from the close
 * button in the card's header or with Escape, and asks first when there are unsaved edits --
 * like the client editor. Where it goes is `location.state.from`, else the list.
 */
const WebhookEditor = ({ webhook }: { webhook: Webhook | null }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const { confirm } = useConfirm();
    const back = (location.state as { from?: string } | null)?.from ?? "/webhooks";

    const [initial] = useState<WebhookDraft>(() => (webhook ? draftFrom(webhook) : EMPTY_DRAFT));
    const [draft, setDraft] = useState<WebhookDraft>(initial);
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<WebhookTestResult | null>(null);

    const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

    const preview = useMemo(
        () => previewBody(draft.bodyTemplate, draft.name || "webhook"),
        [draft.bodyTemplate, draft.name],
    );

    const set = <K extends keyof WebhookDraft>(key: K, value: WebhookDraft[K]) =>
        setDraft((prev) => ({ ...prev, [key]: value }));

    const requestClose = useCallback(async () => {
        if (dirty && !(await confirm(describeDiscardWebhookChanges()))) return;
        navigate(back);
    }, [dirty, confirm, navigate, back]);

    // Escape does what the header's button does -- including asking first.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            // Not while a select or the discard confirmation uses Escape for itself.
            if (e.defaultPrevented) return;
            requestClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [requestClose]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setError(null);
        try {
            const input = inputFrom(draft);
            if (webhook) await send(`/api/v1/webhooks/${webhook.id}`, "PUT", input);
            else await send("/api/v1/webhooks", "POST", input);
            navigate(back);
        } catch (err: unknown) {
            setError(getErrorMessage(err));
            setIsSaving(false);
        }
    };

    const handleTest = async () => {
        setIsTesting(true);
        setError(null);
        setTestResult(null);
        try {
            const response = await send("/api/v1/webhooks/test", "POST", inputFrom(draft));
            setTestResult((await response.json()) as WebhookTestResult);
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setIsTesting(false);
        }
    };

    return (
        <Card
            title={
                <>
                    <WebhookIcon size={18} className="text-text-muted" />
                    {webhook ? `Edit ${webhook.name}` : "Add Webhook"}
                </>
            }
            action={<ActionButton icon={X} tooltip="Close" onClick={requestClose} />}
            padding="none"
        >
            <form onSubmit={handleSubmit} className="space-y-4 p-6">
                {error && <div className="bg-error-bg text-error p-3 rounded-lg text-sm">{error}</div>}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input
                        label="Name"
                        value={draft.name}
                        onChange={(e) => set("name", e.target.value)}
                        placeholder="Ops channel"
                    />
                    <div className="flex items-end pb-2">
                        <Checkbox
                            label="Enabled"
                            checked={draft.enabled}
                            onChange={(e) => set("enabled", e.target.checked)}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-[8rem_1fr] gap-4">
                    <Select
                        label="Method"
                        value={draft.method}
                        onChange={(e) => set("method", e.target.value as WebhookDraft["method"])}
                        options={WEBHOOK_METHODS.map((method) => ({ value: method, label: method }))}
                    />
                    <Input
                        label="URL"
                        value={draft.url}
                        onChange={(e) => set("url", e.target.value)}
                        placeholder="https://hooks.example.com/…"
                        hint="Placeholders are allowed here too, and inserted as text."
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Select
                        label="Minimum Level"
                        value={draft.minLevel}
                        onChange={(e) => set("minLevel", e.target.value as WebhookDraft["minLevel"])}
                        options={ACTIVITY_LEVELS.map((level) => ({ value: level, label: level }))}
                    />
                    <Input
                        label="Event Kinds"
                        value={draft.kinds}
                        onChange={(e) => set("kinds", e.target.value)}
                        placeholder="all kinds"
                        hint="Comma separated, * as wildcard: vrrp.*, keepalived.stopped"
                    />
                    <Input
                        label="Timeout (Seconds)"
                        type="number"
                        min="1"
                        max="60"
                        value={draft.timeoutSeconds}
                        onChange={(e) => set("timeoutSeconds", e.target.value)}
                    />
                </div>

                <Textarea
                    label="Headers"
                    rows={3}
                    value={draft.headers}
                    onChange={(e) => set("headers", e.target.value)}
                    placeholder="Authorization: Bearer …"
                    hint="One Name: value per line. Content-Type: application/json is always sent."
                    className="font-mono text-xs"
                />

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <Textarea
                        label="Body Template (JSON)"
                        rows={16}
                        value={draft.bodyTemplate}
                        onChange={(e) => set("bodyTemplate", e.target.value)}
                        error={preview.error}
                        spellCheck={false}
                        className="font-mono text-xs"
                    />
                    <div>
                        <label className="field-label">Preview (sample event)</label>
                        <pre className="mt-1 h-[calc(100%-1.5rem)] min-h-40 overflow-auto rounded-lg border border-border bg-app-bg p-3 text-xs font-mono text-text-primary">
                            {preview.body ?? "–"}
                        </pre>
                    </div>
                </div>

                <details className="text-sm">
                    <summary className="cursor-pointer font-medium text-text-primary">
                        Available placeholders
                    </summary>
                    <p className="mt-2 text-xs text-text-muted max-w-prose">
                        A string that is only a placeholder, such as <code>"{"{{event.data}}"}"</code>,
                        becomes the value with its type. Inside longer text it is inserted as text.{" "}
                        <code>{'{{client.name | default("server")}}'}</code> stands in for a missing value;
                        <code> event.data.from</code> reaches into an object.
                    </p>
                    <dl className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                        {PLACEHOLDERS.map((p) => (
                            <div key={p.path} className="flex gap-2">
                                <dt className="font-mono text-text-primary shrink-0">{`{{${p.path}}}`}</dt>
                                <dd className="text-text-muted truncate">{p.description}</dd>
                            </div>
                        ))}
                    </dl>
                </details>

                {testResult && (
                    <div
                        className={`p-3 rounded-lg text-sm ${testResult.ok ? "bg-success-bg text-success" : "bg-error-bg text-error"}`}
                    >
                        <div className="font-medium">
                            {testResult.ok ? `Delivered (HTTP ${testResult.status})` : `Failed: ${testResult.error}`}
                        </div>
                        {testResult.response && (
                            <pre className="mt-1 whitespace-pre-wrap break-all text-xs font-mono opacity-80">
                                {testResult.response}
                            </pre>
                        )}
                    </div>
                )}

                <div className="flex justify-between gap-3 pt-4 border-t border-border">
                    <Button
                        type="button"
                        variant="secondary"
                        icon={Send}
                        onClick={handleTest}
                        isLoading={isTesting}
                        disabled={isTesting || isSaving}
                    >
                        Send Test
                    </Button>
                    <div className="flex gap-3">
                        <Button type="button" variant="secondary" onClick={requestClose}>
                            Cancel
                        </Button>
                        <Button type="submit" variant="primary" isLoading={isSaving} disabled={isSaving}>
                            Save
                        </Button>
                    </div>
                </div>
            </form>
        </Card>
    );
};
