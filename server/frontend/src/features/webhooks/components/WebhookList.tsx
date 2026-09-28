import { useMemo } from "react";
import { Edit2, Plus, Trash2, Webhook as WebhookIcon } from "lucide-react";
import type { Webhook } from "@kasm/shared";
import {
    Badge,
    Button,
    DataAction,
    DataListColumnDef,
    DataListDef,
    DataMultiView,
    DataTableDef,
    Switch,
} from "@stefgo/react-ui-components";
import { formatDate } from "../../../utils";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { PAGE_SIZE, pagination } from "../../../components/listDefaults";

interface WebhookListProps {
    webhooks: Webhook[];
    isLoading: boolean;
    onAdd: () => void;
    onEdit: (webhook: Webhook) => void;
    onDelete: (webhook: Webhook) => void;
    onToggleEnabled: (webhook: Webhook, enabled: boolean) => void;
}

/** The table has a column with a switch for the state; the list shows it as a badge. */
const Name = ({ webhook, withState = false }: { webhook: Webhook; withState?: boolean }) => (
    <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-text-primary">{webhook.name}</span>
        {withState && !webhook.enabled && (
            <Badge variant="neutral" size="sm">
                Disabled
            </Badge>
        )}
    </div>
);

const Target = ({ webhook }: { webhook: Webhook }) => (
    <span className="block max-w-md truncate text-sm text-text-muted" title={webhook.url}>
        {webhook.method} {webhook.url}
    </span>
);

const Filter = ({ webhook }: { webhook: Webhook }) => (
    <span className="text-sm text-text-muted">
        {webhook.minLevel} and above · {webhook.kinds.length > 0 ? webhook.kinds.join(", ") : "all kinds"}
    </span>
);

/** How the last delivery went. A failure carries its reason, cut short; the tooltip has all of it. */
const LastDelivery = ({ webhook }: { webhook: Webhook }) => {
    if (!webhook.lastAttemptAt) {
        return (
            <Badge variant="neutral" size="sm">
                Never sent
            </Badge>
        );
    }
    const when = formatDate(webhook.lastAttemptAt);
    if (!webhook.lastError) {
        return (
            <Badge variant="success" size="sm">
                HTTP {webhook.lastStatus} · {when}
            </Badge>
        );
    }
    return (
        <div className="flex flex-col items-start gap-0.5">
            <Badge variant="error" size="sm">
                Failed · {when}
            </Badge>
            <span className="max-w-xs truncate text-xs text-error" title={webhook.lastError}>
                {webhook.lastError}
            </span>
        </div>
    );
};

/** The webhooks, built like every other list of the app. A row opens its editor. */
export const WebhookList = ({ webhooks, isLoading, onAdd, onEdit, onDelete, onToggleEnabled }: WebhookListProps) => {
    const [searchQuery, setSearchQuery] = useSearchQueryParam();

    const filtered = useMemo(() => {
        if (!searchQuery) return webhooks;
        const q = searchQuery.toLowerCase();
        return webhooks.filter((w) => w.name.toLowerCase().includes(q) || w.url.toLowerCase().includes(q));
    }, [webhooks, searchQuery]);

    // One set of actions for both views, so the table and the list cannot drift apart.
    const renderActions = (webhook: Webhook) => (
        <div onClick={(e) => e.stopPropagation()}>
            <DataAction
                rowId={webhook.id}
                actions={[
                    {
                        icon: Edit2,
                        onClick: () => onEdit(webhook),
                        color: "blue",
                        tooltip: "Edit",
                    },
                ]}
                menuEntries={[
                    {
                        label: "Delete",
                        icon: Trash2,
                        onClick: () => onDelete(webhook),
                        variant: "danger",
                    },
                ]}
            />
        </div>
    );

    // The switch sits in a clickable row; its click must not open the editor as well.
    const renderEnabled = (webhook: Webhook) => (
        <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
            <Switch
                value={webhook.enabled}
                onChange={(enabled) => onToggleEnabled(webhook, enabled)}
                aria-label={`${webhook.name} enabled`}
            />
        </div>
    );

    const tableDef: DataTableDef<Webhook>[] = [
        {
            tableHeader: "Name",
            sortable: true,
            sortValue: (w) => w.name.toLowerCase(),
            tableItemRender: (w) => <Name webhook={w} />,
        },
        {
            tableHeader: "Enabled",
            tableHeaderClassName: "text-center",
            tableCellClassName: "content-center",
            sortable: true,
            sortValue: (w) => (w.enabled ? 0 : 1),
            tableItemRender: renderEnabled,
        },
        {
            tableHeader: "Last Delivery",
            sortable: true,
            sortValue: (w) => w.lastAttemptAt ?? "",
            tableItemRender: (w) => <LastDelivery webhook={w} />,
        },
        {
            tableHeader: "Actions",
            tableHeaderClassName: "text-center",
            tableCellClassName: "content-center",
            tableItemRender: renderActions,
        },
    ];

    const listColumns: DataListColumnDef<Webhook>[] = [
        {
            fields: [
                {
                    listLabel: null,
                    listItemRender: (w) => (
                        <div className="py-1">
                            <Name webhook={w} withState />
                        </div>
                    ),
                },
                { listLabel: "Target", listItemRender: (w) => <Target webhook={w} /> },
                { listLabel: "Filter", listItemRender: (w) => <Filter webhook={w} /> },
                { listLabel: "Last Delivery", listItemRender: (w) => <LastDelivery webhook={w} /> },
            ] satisfies DataListDef<Webhook>[],
            columnClassName: "flex-1 min-w-0",
        },
        {
            fields: [
                {
                    listLabel: null,
                    listItemRender: (w) => (
                        <div className="mt-2 md:mt-0 flex justify-center">{renderActions(w)}</div>
                    ),
                },
            ] satisfies DataListDef<Webhook>[],
            columnClassName: "md:text-right",
        },
    ];

    return (
        <DataMultiView
            title={
                <>
                    <WebhookIcon size={18} className="text-text-muted" /> Webhooks
                </>
            }
            extraActions={
                <Button size="sm" icon={Plus} onClick={onAdd}>
                    Add Webhook
                </Button>
            }
            sort={{ defaultValue: [{ colIndex: 0, direction: "asc" }] }}
            viewMode={{ persist: { key: "webhookViewMode", scope: "local" } }}
            data={filtered}
            tableDef={tableDef}
            listColumns={listColumns}
            keyField="id"
            isLoading={isLoading}
            loadingMessage="Loading webhooks…"
            searchable
            searchPlaceholder="Search webhooks…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            emptyMessage="No webhooks yet. Add one to report events to an external service."
            onRowClick={onEdit}
            pagination={pagination(PAGE_SIZE.page)}
        />
    );
};
