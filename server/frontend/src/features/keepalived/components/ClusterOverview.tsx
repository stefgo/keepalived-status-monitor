import { ReactNode, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Network } from "lucide-react";
import {
    cn,
    DataMultiView,
    type DataListColumnDef,
    type DataTableDef,
    StatusDot,
} from "@stefgo/react-ui-components";
import type { Client, VrrpCluster, VrrpClusterHealth, VrrpClusterMember, VrrpState } from "@kasm/shared";
import { useClients } from "../../../queries/clients";
import { useKeepalivedStates } from "../../../queries/keepalived";
import { QueryError } from "../../../components/QueryError";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { clientName, formatDate } from "../../../utils";
import { useVrrpClusters } from "../hooks/useVrrpClusters";
import { clusterLabel, clusterPath, clusterVipLabel, memberStale } from "../lib/vrrp";
import { ClusterHealthBadge } from "./ClusterHealthBadge";
import { Priority } from "./VrrpInstanceView";
import { MemberStateBadge } from "./VrrpStateBadge";
import { STORAGE_KEYS } from "../../../lib/storageKeys";

/**
 * One row of the tree: a virtual router on the first level, the hosts that take part in it
 * on the second. The host's name is resolved once here, so search and render agree on it.
 */
type ClusterRow =
    | { kind: "cluster"; key: string; cluster: VrrpCluster; children: ClusterRow[] }
    | { kind: "member"; key: string; member: VrrpClusterMember; hostName: string };

/** Sort ranks: what needs a look first. */
const HEALTH_RANK: Record<VrrpClusterHealth, number> = {
    "split-brain": 0,
    "no-master": 1,
    "vip-mismatch": 2,
    degraded: 3,
    unknown: 4,
    ok: 5,
};

const STATE_RANK: Record<VrrpState, number> = {
    FAULT: 0,
    INIT: 1,
    STOP: 2,
    DELETED: 3,
    UNKNOWN: 4,
    BACKUP: 5,
    MASTER: 6,
};

/**
 * A host row whose state is not current is dimmed cell by cell rather than as a row, so the
 * `MemberStatusBadge` that stands in for its state stays legible.
 */
const dim = (row: ClusterRow) => (row.kind === "member" && memberStale(row.member) ? "opacity-60" : "");

const effectivePriority = (member: VrrpClusterMember) =>
    member.instance.effectivePriority ?? member.instance.priority ?? 0;

function toRows(clusters: VrrpCluster[], clients: Client[]): ClusterRow[] {
    return clusters.map((cluster) => ({
        kind: "cluster",
        key: cluster.key,
        cluster,
        // The node that should be MASTER on top.
        children: [...cluster.members]
            .sort((a, b) => effectivePriority(b) - effectivePriority(a))
            .map((member) => {
                const client = clients.find((c) => c.id === member.clientId);
                return {
                    kind: "member",
                    key: `${cluster.key}/${member.clientId}:${member.instance.name}`,
                    member,
                    hostName: client ? clientName(client) : member.clientId,
                };
            }),
    }));
}

/** A cluster matches on its VRID, site, network or an address, or when a host of it does. */
function matches(row: ClusterRow, query: string): boolean {
    if (row.kind === "member") {
        return (
            row.hostName.toLowerCase().includes(query) ||
            row.member.instance.name.toLowerCase().includes(query)
        );
    }
    return (
        String(row.cluster.vrid ?? "").includes(query) ||
        !!row.cluster.site?.toLowerCase().includes(query) ||
        row.cluster.vips.some((vip) => vip.toLowerCase().includes(query)) ||
        row.cluster.networks.some((net) => net.toLowerCase().includes(query)) ||
        row.children.some((child) => matches(child, query))
    );
}

const HostLink = ({ row }: { row: Extract<ClusterRow, { kind: "member" }> }) => (
    <Link
        to={`/client/${row.member.clientId}`}
        // The row leads to the host as well; without this a click would push it twice.
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-2 hover:text-primary"
    >
        <StatusDot tone={row.member.online ? "success" : "neutral"} />
        {row.hostName}
    </Link>
);

/** A cluster's page, where it has one; plain text where it has none. */
const ClusterLink = ({
    cluster,
    clusters,
    children,
}: {
    cluster: VrrpCluster;
    clusters: VrrpCluster[];
    children: ReactNode;
}) => {
    const { pathname } = useLocation();
    const path = clusterPath(cluster, clusters);
    return path ? (
        <Link
            to={path}
            state={{ from: pathname }}
            // The row leads to the cluster as well; without this a click would push it twice.
            onClick={(e) => e.stopPropagation()}
            className="text-text-primary hover:text-primary"
        >
            {children}
        </Link>
    ) : (
        <span className="text-text-primary">{children}</span>
    );
};

/**
 * Every VRRP cluster across the fleet as a tree: the virtual router with its addresses, and
 * under it the hosts that answer for it. The clusters that need attention come first.
 */
export const ClusterOverview = () => {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const clusters = useVrrpClusters();
    const { clients, error: clientsError } = useClients();
    const { error: statesError } = useKeepalivedStates();
    const [searchQuery, setSearchQuery] = useSearchQueryParam();
    // What the reader opened or closed by hand; every other cluster follows the default below.
    const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());

    const rows = useMemo(() => toRows(clusters, clients), [clusters, clients]);
    const searching = searchQuery.trim() !== "";
    const filteredRows = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        return query ? rows.filter((row) => matches(row, query)) : rows;
    }, [rows, searchQuery]);

    // Open are the clusters that need a look -- any health but `ok`, which covers an offline
    // or inactive member, since that makes a cluster degraded at least -- and, while a search
    // runs, every cluster, so a matching host is not hidden in a closed one. Worked out on
    // every render, so a cluster that runs into trouble opens by itself; a reader's own
    // choice for a cluster wins over it.
    const expanded = useMemo(
        () =>
            new Set(
                clusters
                    .filter((cluster) => toggled.get(cluster.key) ?? (searching || cluster.health !== "ok"))
                    .map((cluster) => cluster.key),
            ),
        [clusters, toggled, searching],
    );
    const onExpandedChange = (next: Set<string | number>) => {
        const changed = new Map(toggled);
        for (const cluster of clusters) {
            const open = next.has(cluster.key);
            if (open !== expanded.has(cluster.key)) changed.set(cluster.key, open);
        }
        setToggled(changed);
    };

    // Every sortable column gives both kinds of row a value, since the tree sorts each level
    // with the same comparator. A constant for the clusters keeps their order where the
    // column is about the hosts only.
    const tableDef: DataTableDef<ClusterRow>[] = [
        {
            tableHeader: "VRID / Host",
            sortable: true,
            // By site first, then numerically by VRID (1–255, hence the padding).
            sortValue: (row) =>
                row.kind === "cluster"
                    ? `${row.cluster.site ?? ""}|${String(row.cluster.vrid ?? 0).padStart(3, "0")}`
                    : row.hostName,
            tableCellClassName: (row) => cn("text-sm", dim(row)),
            tableItemRender: (row) => (row.kind === "cluster" ? clusterLabel(row.cluster) : <HostLink row={row} />),
        },
        {
            tableHeader: "Virtual IPs / Instance",
            tableCellClassName: (row) => cn("text-sm", dim(row)),
            tableItemRender: (row) =>
                row.kind === "cluster" ? (
                    clusterVipLabel(row.cluster)
                ) : (
                    <>
                        {row.member.instance.name}
                        {row.member.instance.syncGroup && (
                            <div className="text-xs text-text-muted">
                                Sync group {row.member.instance.syncGroup}
                            </div>
                        )}
                    </>
                ),
        },
        {
            tableHeader: "State",
            sortable: true,
            sortValue: (row) =>
                row.kind === "cluster" ? HEALTH_RANK[row.cluster.health] : STATE_RANK[row.member.instance.state],
            tableItemRender: (row) =>
                row.kind === "cluster" ? (
                    <ClusterHealthBadge health={row.cluster.health} />
                ) : (
                    <MemberStateBadge member={row.member} />
                ),
        },
        {
            tableHeader: "Priority",
            sortable: true,
            sortValue: (row) => (row.kind === "cluster" ? 0 : effectivePriority(row.member)),
            tableCellClassName: (row) => cn("text-sm", dim(row)),
            tableItemRender: (row) => (row.kind === "member" ? <Priority instance={row.member.instance} /> : null),
        },
        {
            tableHeader: "Last transition",
            tableHeaderClassName: "whitespace-nowrap",
            tableCellClassName: (row) => cn("text-sm whitespace-nowrap", dim(row)),
            tableItemRender: (row) =>
                row.kind === "member" ? formatDate(row.member.instance.lastTransition, { seconds: true }) : null,
        },
    ];

    // The list shows the first level only, so each cluster carries its hosts inside it.
    const listColumns: DataListColumnDef<ClusterRow>[] = [
        {
            columnClassName: "flex-1",
            fields: [
                {
                    listLabel: null,
                    listItemRender: (row) =>
                        row.kind === "cluster" && (
                            <div className="flex flex-wrap items-center gap-2 py-1">
                                <ClusterLink cluster={row.cluster} clusters={clusters}>
                                    {clusterVipLabel(row.cluster)}
                                </ClusterLink>
                                <span className="text-sm text-text-muted">{clusterLabel(row.cluster)}</span>
                                <ClusterHealthBadge health={row.cluster.health} />
                            </div>
                        ),
                },
                {
                    listLabel: "Hosts",
                    listItemRender: (row) =>
                        row.kind === "cluster" && (
                            <ul className="space-y-1">
                                {row.children.map(
                                    (child) =>
                                        child.kind === "member" && (
                                            <li
                                                key={child.key}
                                                className="flex flex-wrap items-center gap-2"
                                            >
                                                <span className={dim(child)}>
                                                    <HostLink row={child} />
                                                </span>
                                                <span className={cn("text-text-secondary", dim(child))}>
                                                    {child.member.instance.name}
                                                </span>
                                                <MemberStateBadge member={child.member} />
                                            </li>
                                        ),
                                )}
                            </ul>
                        ),
                },
            ],
        },
    ];

    const loadError = clientsError ?? statesError;
    if (loadError) return <QueryError title="Could not load the clusters" error={loadError} />;

    return (
        <DataMultiView<ClusterRow>
            title={
                <>
                    <Network size={18} className="text-text-muted" /> VRRP Clusters
                </>
            }
            viewMode={{ persist: { key: STORAGE_KEYS.clustersView, scope: "local" } }}
            data={filteredRows}
            getChildren={(row) => (row.kind === "cluster" ? row.children : null)}
            tableDef={tableDef}
            listColumns={listColumns}
            treeExpanded={{ value: expanded, onChange: onExpandedChange }}
            keyField="key"
            searchable
            searchPlaceholder="Search VRID, site, network, address or host…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            emptyMessage="No VRRP instances reported yet. Clusters appear once a registered agent has read keepalived on its host."
            noResultsMessage="No cluster matches this search."
            // `onRowClick` makes every row look clickable; a cluster without a VRID has no page,
            // so its row takes the pointer and the hover back. The list shows cluster rows only.
            rowClassName={(row) =>
                row.kind === "cluster"
                    ? clusterPath(row.cluster, clusters)
                        ? "align-top"
                        : "align-top cursor-default hover:bg-transparent"
                    : "align-top"
            }
            // A cluster row opens the cluster's page, a host row the host. `from` is how the
            // cluster page knows where back is.
            onRowClick={(row) => {
                const to = row.kind === "cluster" ? clusterPath(row.cluster, clusters) : `/client/${row.member.clientId}`;
                if (to) navigate(to, { state: { from: pathname } });
            }}
        />
    );
};
