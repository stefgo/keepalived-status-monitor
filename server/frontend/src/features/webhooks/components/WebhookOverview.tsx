import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Webhook } from "@kasm/shared";
import { useConfirm } from "@stefgo/react-ui-components";
import { apiFetch } from "../../../lib/apiFetch";
import { describeDeleteWebhook } from "../confirmations";
import { WebhookList } from "./WebhookList";

/** The page at `/webhooks`. Adding and editing happen on pages of their own. */
export const WebhookOverview = () => {
    const navigate = useNavigate();
    const { pathname, search } = useLocation();
    const { confirm } = useConfirm();
    const [webhooks, setWebhooks] = useState<Webhook[]>([]);

    /** Bumped to load the list again after a change; the effect below is the only loader. */
    const [reloadCount, setReloadCount] = useState(0);
    /** Only the first load shows as loading; a reload keeps the rows on screen. */
    const [isLoading, setIsLoading] = useState(true);

    // A response that arrives after the next reload has started is dropped, so an older
    // list cannot overwrite a newer one.
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const res = await apiFetch("/api/v1/webhooks");
                if (res.ok) {
                    const list = (await res.json()) as Webhook[];
                    if (!cancelled) setWebhooks(list);
                }
            } catch (e) {
                console.error(e);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, [reloadCount]);

    // The editor goes back to where it was opened from, search included.
    const open = (to: string) => navigate(to, { state: { from: pathname + search } });

    const requestDelete = (webhook: Webhook) =>
        confirm({
            ...describeDeleteWebhook(webhook.name),
            onConfirm: async () => {
                const res = await apiFetch(`/api/v1/webhooks/${webhook.id}`, { method: "DELETE" });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    throw new Error(data.error || "Failed to delete the webhook");
                }
                setReloadCount((n) => n + 1);
            },
        });

    return (
        <div className="space-y-6">
            <WebhookList
                webhooks={webhooks}
                isLoading={isLoading}
                onAdd={() => open("/webhooks/new")}
                onEdit={(webhook) => open(`/webhooks/${webhook.id}`)}
                onDelete={requestDelete}
            />
        </div>
    );
};
