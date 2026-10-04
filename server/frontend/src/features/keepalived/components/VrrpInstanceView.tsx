import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { VrrpInstance } from "@kasm/shared";
import {
    cn,
    DataMultiView,
    type DataListColumnDef,
    type DataListDef,
    type DataTableDef,
} from "@stefgo/react-ui-components";
import { formatDate } from "../../../utils";
import { formatInterval, vrrpStateLabel } from "../lib/vrrp";
import { VrrpStateBadge } from "./VrrpStateBadge";
import { STORAGE_KEYS } from "../../../lib/storageKeys";

export interface VrrpInstanceRow {
    key: string;
    instance: VrrpInstance;
    /** Rendered in front of the instance name -- the host, where the view spans several. */
    host?: ReactNode;
    /**
     * Dims a row whose host is offline or whose keepalived reports nothing: what it shows is
     * the last report, not the present state. Dimmed cell by cell, so the state is not.
     */
    stale?: boolean;
    /**
     * Rendered in place of the instance's state badge -- where the row's state is not a current
     * one, what is current instead. Never dimmed with its row.
     */
    stateBadge?: ReactNode;
    /** Where the row leads -- the instance's cluster, or its host. Links inside the row keep their own target. */
    href?: string;
    /** Rendered in the leading column, where the view has one (see `leadingHeader`). */
    leading?: ReactNode;
}

interface VrrpInstanceViewProps {
    rows: VrrpInstanceRow[];
    showHost?: boolean;
    /** Off where every row belongs to the same virtual router. */
    showVrid?: boolean;
    title?: ReactNode;
    /** Shown in place of the rows when there are none. */
    emptyMessage?: string;
    /**
     * Adds a column in front of all others, headed by this, that shows each row's `leading`.
     * In the list it opens the row's first line.
     */
    leadingHeader?: ReactNode;
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

/**
 * The configured state, where keepalived was told to start in another one than it is in now.
 * Not on a stale row: its state is the last one reported, and what it differs from is not news.
 */
const WantedState = ({ row: { instance, stale } }: { row: VrrpInstanceRow }) =>
    !stale && instance.wantedState && instance.wantedState !== "UNKNOWN" && instance.wantedState !== instance.state ? (
        <span className="text-xs text-text-muted">configured {vrrpStateLabel(instance.wantedState)}</span>
    ) : null;

/** The row's state: its `stateBadge` where it brings one, the instance's state otherwise. */
const State = ({ row }: { row: VrrpInstanceRow }) =>
    row.stateBadge ?? <VrrpStateBadge state={row.instance.state} />;

export const Vips = ({ instance }: { instance: VrrpInstance }) =>
    instance.vips.length > 0 ? <>{instance.vips.map((vip) => <div key={vip}>{vip}</div>)}</> : <>–</>;

const lastTransition = (instance: VrrpInstance) => formatDate(instance.lastTransition, { seconds: true });

/** The dimming of a stale row, applied per cell rather than to the row -- see `stateBadge`. */
const dim = (row: VrrpInstanceRow) => (row.stale ? "opacity-60" : "");

/** A list field's content, dimmed where its row is stale. */
const Dimmed = ({ row, children }: { row: VrrpInstanceRow; children: ReactNode }) =>
    row.stale ? <div className="opacity-60">{children}</div> : <>{children}</>;

/**
 * VRRP instances as a table or a list, the reader's choice; a narrow screen always gets the
 * list. Rows keep the caller's order until a column is sorted.
 */
export const VrrpInstanceView = ({
    rows,
    showHost = false,
    showVrid = true,
    title,
    emptyMessage = "No VRRP instances.",
    leadingHeader,
}: VrrpInstanceViewProps) => {
    const navigate = useNavigate();
    const hasLeading = leadingHeader !== undefined;

    const tableDef: DataTableDef<VrrpInstanceRow>[] = [
        ...(hasLeading
            ? [
                  {
                      tableHeader: leadingHeader,
                      tableHeaderClassName: "w-px",
                      tableCellClassName: dim,
                      tableItemRender: (row: VrrpInstanceRow) => row.leading,
                  },
              ]
            : []),
        ...(showHost
            ? [
                  {
                      tableHeader: "Host",
                      tableCellClassName: (row: VrrpInstanceRow) => cn("text-sm", dim(row)),
                      tableItemRender: (row: VrrpInstanceRow) => row.host,
                  },
              ]
            : []),
        {
            tableHeader: "Instance",
            sortable: true,
            sortValue: (row) => row.instance.name,
            tableCellClassName: (row) => cn("text-sm", dim(row)),
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
            tableItemRender: (row) => (
                <>
                    <State row={row} />
                    <div className="mt-1">
                        <WantedState row={row} />
                    </div>
                </>
            ),
        },
        // Interface, advertisement interval and the virtual addresses are in the list only:
        // an address list needs a line of its own per row, and the table is wide enough
        // without them.
        ...(showVrid
            ? [
                  {
                      tableHeader: "VRID",
                      tableCellClassName: (row: VrrpInstanceRow) => cn("text-sm", dim(row)),
                      tableItemRender: ({ instance }: VrrpInstanceRow) => instance.vrid ?? "–",
                  },
              ]
            : []),
        {
            tableHeader: "Priority",
            sortable: true,
            sortValue: (row) => effectivePriority(row.instance),
            tableCellClassName: (row) => cn("text-sm", dim(row)),
            tableItemRender: ({ instance }) => <Priority instance={instance} />,
        },
        {
            tableHeader: "Last transition",
            tableHeaderClassName: "whitespace-nowrap",
            tableCellClassName: (row) => cn("text-sm whitespace-nowrap", dim(row)),
            tableItemRender: ({ instance }) => lastTransition(instance),
        },
    ];

    const fields: DataListDef<VrrpInstanceRow>[] = [
        {
            listLabel: null,
            listItemRender: (row) => (
                <div className="flex flex-wrap items-center gap-2 py-1">
                    {hasLeading && <span className={dim(row)}>{row.leading}</span>}
                    {row.host && <span className={cn("font-medium text-text-primary", dim(row))}>{row.host}</span>}
                    <span className={cn(row.host ? "text-text-secondary" : "font-medium text-text-primary", dim(row))}>
                        {row.instance.name}
                    </span>
                    <State row={row} />
                    <WantedState row={row} />
                </div>
            ),
        },
        ...(rows.some((row) => row.instance.syncGroup)
            ? [
                  {
                      listLabel: "Sync group",
                      listItemRender: (row: VrrpInstanceRow) => <Dimmed row={row}>{row.instance.syncGroup ?? "–"}</Dimmed>,
                  },
              ]
            : []),
        { listLabel: "Interface", listItemRender: (row) => <Dimmed row={row}>{row.instance.interface ?? "–"}</Dimmed> },
        ...(showVrid
            ? [
                  {
                      listLabel: "VRID",
                      listItemRender: (row: VrrpInstanceRow) => <Dimmed row={row}>{row.instance.vrid ?? "–"}</Dimmed>,
                  },
              ]
            : []),
        {
            listLabel: "Priority",
            listItemRender: (row) => (
                <Dimmed row={row}>
                    <Priority instance={row.instance} />
                </Dimmed>
            ),
        },
        {
            listLabel: "Advert",
            listItemRender: (row) => <Dimmed row={row}>{formatInterval(row.instance.advertInterval)}</Dimmed>,
        },
        {
            listLabel: "Virtual IPs",
            listItemRender: (row) => (
                <Dimmed row={row}>
                    <Vips instance={row.instance} />
                </Dimmed>
            ),
        },
        { listLabel: "Last transition", listItemRender: (row) => <Dimmed row={row}>{lastTransition(row.instance)}</Dimmed> },
    ];
    const listColumns: DataListColumnDef<VrrpInstanceRow>[] = [{ fields, columnClassName: "flex-1" }];

    return (
        <DataMultiView
            title={title}
            // One key for every instance view: the choice is about how to read instances,
            // not about a particular host or cluster.
            viewMode={{ persist: { key: STORAGE_KEYS.instancesView, scope: "local" } }}
            data={rows}
            tableDef={tableDef}
            listColumns={listColumns}
            keyField="key"
            rowClassName="align-top"
            // Only where a row leads somewhere, or every row would look clickable.
            onRowClick={rows.some((row) => row.href) ? (row) => row.href && navigate(row.href) : undefined}
            emptyMessage={emptyMessage}
        />
    );
};
