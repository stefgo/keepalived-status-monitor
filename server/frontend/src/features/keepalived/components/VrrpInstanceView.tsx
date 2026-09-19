import { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { VrrpInstance } from "@kasm/shared";
import {
    DataMultiView,
    type DataListColumnDef,
    type DataListDef,
    type DataTableDef,
} from "@stefgo/react-ui-components";
import { formatDate } from "../../../utils";
import { formatInterval } from "../lib/vrrp";
import { VrrpStateBadge } from "./VrrpStateBadge";

export interface VrrpInstanceRow {
    key: string;
    instance: VrrpInstance;
    /** Rendered in front of the instance name -- the host, where the view spans several. */
    host?: ReactNode;
    /** Dims a row whose host is offline: its state is the last one reported, not the present one. */
    stale?: boolean;
    /** The instance's page. A row with one opens it; links inside the row keep their own target. */
    href?: string;
}

interface VrrpInstanceViewProps {
    rows: VrrpInstanceRow[];
    showHost?: boolean;
    title?: ReactNode;
    /** Rendered in the card header next to the view toggle. */
    extraActions?: ReactNode;
}

const effectivePriority = (instance: VrrpInstance) => instance.effectivePriority ?? instance.priority ?? 0;

export const Priority = ({ instance }: { instance: VrrpInstance }) => {
    const adjusted =
        instance.effectivePriority !== null &&
        instance.effectivePriority !== undefined &&
        instance.effectivePriority !== instance.priority;
    return (
        <>
            {instance.priority ?? "–"}
            {adjusted && <span className="text-text-muted"> → {instance.effectivePriority}</span>}
        </>
    );
};

/** The configured state, where keepalived was told to start in another one than it is in now. */
const WantedState = ({ instance }: { instance: VrrpInstance }) =>
    instance.wantedState && instance.wantedState !== "UNKNOWN" && instance.wantedState !== instance.state ? (
        <span className="text-xs text-text-muted">configured {instance.wantedState}</span>
    ) : null;

export const Vips = ({ instance }: { instance: VrrpInstance }) =>
    instance.vips.length > 0 ? <>{instance.vips.map((vip) => <div key={vip}>{vip}</div>)}</> : <>–</>;

const lastTransition = (instance: VrrpInstance) => formatDate(instance.lastTransition, { seconds: true });

/**
 * VRRP instances as a table or a list, the reader's choice; a narrow screen always gets the
 * list. Rows keep the caller's order until a column is sorted.
 */
export const VrrpInstanceView = ({ rows, showHost = false, title, extraActions }: VrrpInstanceViewProps) => {
    const navigate = useNavigate();
    const { pathname } = useLocation();

    const tableDef: DataTableDef<VrrpInstanceRow>[] = [
        ...(showHost
            ? [
                  {
                      tableHeader: "Host",
                      tableCellClassName: "text-sm",
                      tableItemRender: (row: VrrpInstanceRow) => row.host,
                  },
              ]
            : []),
        {
            tableHeader: "Instance",
            sortable: true,
            sortValue: (row) => row.instance.name,
            tableCellClassName: "text-sm",
            tableItemRender: ({ instance }) => (
                <>
                    {instance.name}
                    {instance.syncGroup && (
                        <div className="text-xs text-text-muted">Sync group {instance.syncGroup}</div>
                    )}
                </>
            ),
        },
        {
            tableHeader: "State",
            sortable: true,
            sortValue: (row) => row.instance.state,
            tableItemRender: ({ instance }) => (
                <>
                    <VrrpStateBadge state={instance.state} />
                    <div className="mt-1">
                        <WantedState instance={instance} />
                    </div>
                </>
            ),
        },
        // Interface and advertisement interval are in the list only: they rarely differ
        // between rows, and the table is wide enough without them.
        {
            tableHeader: "VRID",
            tableCellClassName: "text-sm",
            tableItemRender: ({ instance }) => instance.vrid ?? "–",
        },
        {
            tableHeader: "Priority",
            sortable: true,
            sortValue: (row) => effectivePriority(row.instance),
            tableCellClassName: "text-sm",
            tableItemRender: ({ instance }) => <Priority instance={instance} />,
        },
        {
            tableHeader: "Virtual IPs",
            tableCellClassName: "text-sm",
            tableItemRender: ({ instance }) => <Vips instance={instance} />,
        },
        {
            tableHeader: "Last transition",
            tableHeaderClassName: "whitespace-nowrap",
            tableCellClassName: "text-sm whitespace-nowrap",
            tableItemRender: ({ instance }) => lastTransition(instance),
        },
    ];

    const fields: DataListDef<VrrpInstanceRow>[] = [
        {
            listLabel: null,
            listItemRender: ({ instance, host }) => (
                <div className="flex flex-wrap items-center gap-2 py-1">
                    {host && <span className="font-medium text-text-primary">{host}</span>}
                    <span className={host ? "text-text-secondary" : "font-medium text-text-primary"}>
                        {instance.name}
                    </span>
                    <VrrpStateBadge state={instance.state} />
                    <WantedState instance={instance} />
                </div>
            ),
        },
        ...(rows.some((row) => row.instance.syncGroup)
            ? [
                  {
                      listLabel: "Sync group",
                      listItemRender: ({ instance }: VrrpInstanceRow) => instance.syncGroup ?? "–",
                  },
              ]
            : []),
        { listLabel: "Interface", listItemRender: ({ instance }) => instance.interface ?? "–" },
        { listLabel: "VRID", listItemRender: ({ instance }) => instance.vrid ?? "–" },
        { listLabel: "Priority", listItemRender: ({ instance }) => <Priority instance={instance} /> },
        { listLabel: "Advert", listItemRender: ({ instance }) => formatInterval(instance.advertInterval) },
        { listLabel: "Virtual IPs", listItemRender: ({ instance }) => <Vips instance={instance} /> },
        { listLabel: "Last transition", listItemRender: ({ instance }) => lastTransition(instance) },
    ];
    const listColumns: DataListColumnDef<VrrpInstanceRow>[] = [{ fields, columnClassName: "flex-1" }];

    return (
        <DataMultiView
            title={title}
            extraActions={extraActions}
            // One key for every instance view: the choice is about how to read instances,
            // not about a particular host or cluster.
            viewMode={{ persist: { key: "vrrpInstanceViewMode", scope: "local" } }}
            data={rows}
            tableDef={tableDef}
            listColumns={listColumns}
            keyField="key"
            rowClassName={(row) => (row.stale ? "align-top opacity-60" : "align-top")}
            // Only where a row leads somewhere, or every row would look clickable. `from` is
            // how the instance page knows where back is.
            onRowClick={
                rows.some((row) => row.href)
                    ? (row) => row.href && navigate(row.href, { state: { from: pathname } })
                    : undefined
            }
            emptyMessage="No VRRP instances."
        />
    );
};
