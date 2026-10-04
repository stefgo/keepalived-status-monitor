import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { VrrpInstance } from "@kasm/shared";
import {
    cn,
    DataMultiView,
    type DataColumnDef,
    type DataColumnView,
    listGroups,
} from "@stefgo/react-ui-components";
import { RelativeTime } from "../../../components/RelativeTime";
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

/** The dimming of a stale row, applied per cell rather than to the row -- see `stateBadge`. */
const dim = (row: VrrpInstanceRow) => (row.stale ? "opacity-60" : "");

/** A list field's content, dimmed where its row is stale. */
const Dimmed = ({ row, children }: { row: VrrpInstanceRow; children: ReactNode }) =>
    row.stale ? <div className="opacity-60">{children}</div> : <>{children}</>;

/** A value both views show: the table dims its cell through the cell's class, the list has to wrap it. */
const inView = (row: VrrpInstanceRow, view: DataColumnView, children: ReactNode) =>
    view === "list" ? <Dimmed row={row}>{children}</Dimmed> : children;

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

    // Interface, advertisement interval and the virtual addresses are in the list only: an
    // address list needs a line of its own per row, and the table is wide enough without them.
    const columns: DataColumnDef<VrrpInstanceRow>[] = [
        ...(hasLeading
            ? [
                  {
                      header: leadingHeader,
                      table: { headerClassName: "w-px", cellClassName: dim },
                      // In the list it opens the row's first line instead.
                      list: false,
                      render: (row) => row.leading,
                  } satisfies DataColumnDef<VrrpInstanceRow>,
              ]
            : []),
        ...(showHost
            ? [
                  {
                      header: "Host",
                      table: { cellClassName: (row) => cn("text-sm", dim(row)) },
                      list: false,
                      render: (row) => row.host,
                  } satisfies DataColumnDef<VrrpInstanceRow>,
              ]
            : []),
        {
            header: "Instance",
            sortable: true,
            sortValue: (row) => row.instance.name,
            table: { cellClassName: (row) => cn("text-sm", dim(row)) },
            list: { label: null },
            // The list's first line names the row: what leads it, its host, the instance, its state.
            render: (row, view) =>
                view === "list" ? (
                    <div className="flex flex-wrap items-center gap-2 py-1">
                        {hasLeading && <span className={dim(row)}>{row.leading}</span>}
                        {row.host && <span className={cn("font-medium text-text-primary", dim(row))}>{row.host}</span>}
                        <span className={cn(row.host ? "text-text-secondary" : "font-medium text-text-primary", dim(row))}>
                            {row.instance.name}
                        </span>
                        <State row={row} />
                        <WantedState row={row} />
                    </div>
                ) : (
                    <>
                        {row.instance.name}
                        {row.instance.syncGroup && (
                            <div className="text-xs text-text-muted">Sync group {row.instance.syncGroup}</div>
                        )}
                    </>
                ),
        },
        {
            header: "State",
            sortable: true,
            sortValue: (row) => row.instance.state,
            list: false,
            render: (row) => (
                <>
                    <State row={row} />
                    <div className="mt-1">
                        <WantedState row={row} />
                    </div>
                </>
            ),
        },
        ...(rows.some((row) => row.instance.syncGroup)
            ? [
                  {
                      header: "Sync group",
                      table: false,
                      render: (row) => <Dimmed row={row}>{row.instance.syncGroup ?? "–"}</Dimmed>,
                  } satisfies DataColumnDef<VrrpInstanceRow>,
              ]
            : []),
        {
            header: "Interface",
            table: false,
            render: (row) => <Dimmed row={row}>{row.instance.interface ?? "–"}</Dimmed>,
        },
        ...(showVrid
            ? [
                  {
                      header: "VRID",
                      table: { cellClassName: (row) => cn("text-sm", dim(row)) },
                      render: (row, view) => inView(row, view, row.instance.vrid ?? "–"),
                  } satisfies DataColumnDef<VrrpInstanceRow>,
              ]
            : []),
        {
            header: "Priority",
            sortable: true,
            sortValue: (row) => effectivePriority(row.instance),
            table: { cellClassName: (row) => cn("text-sm", dim(row)) },
            render: (row, view) => inView(row, view, <Priority instance={row.instance} />),
        },
        {
            header: "Advert",
            table: false,
            render: (row) => <Dimmed row={row}>{formatInterval(row.instance.advertInterval)}</Dimmed>,
        },
        {
            header: "Virtual IPs",
            table: false,
            render: (row) => (
                <Dimmed row={row}>
                    <Vips instance={row.instance} />
                </Dimmed>
            ),
        },
        {
            header: "Last transition",
            table: {
                headerClassName: "whitespace-nowrap",
                cellClassName: (row) => cn("text-sm whitespace-nowrap", dim(row)),
            },
            render: (row, view) => inView(row, view, <RelativeTime date={row.instance.lastTransition} seconds />),
        },
    ];

    return (
        <DataMultiView
            title={title}
            // One key for every instance view: the choice is about how to read instances,
            // not about a particular host or cluster.
            viewMode={{ persist: { key: STORAGE_KEYS.instancesView, scope: "local" } }}
            data={rows}
            columns={columns}
            listGroups={listGroups()}
            keyField="key"
            rowClassName="align-top"
            // Only where a row leads somewhere, or every row would look clickable.
            onRowClick={rows.some((row) => row.href) ? (row) => row.href && navigate(row.href) : undefined}
            emptyMessage={emptyMessage}
        />
    );
};
