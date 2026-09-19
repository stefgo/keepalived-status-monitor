import { useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Network } from "lucide-react";
import {
    Badge,
    DataMultiView,
    type DataListColumnDef,
    type DataTableDef,
} from "@stefgo/react-ui-components";
import type { Client, VrrpCluster, VrrpClusterHealth, VrrpClusterMember, VrrpState } from "@kasm/shared";
import { useClientStore } from "../../../stores/useClientStore";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { clientName, formatDate } from "../../../utils";
import { StatusDot } from "../../clients/components/StatusDot";
import { useVrrpClusters } from "../hooks/useVrrpClusters";
import { CLUSTER_HEALTH, instancePath } from "../lib/vrrp";
import { Priority } from "./VrrpInstanceView";
import { VrrpStateBadge } from "./VrrpStateBadge";

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
    degraded: 2,
    unknown: 3,
    ok: 4,
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

const effectivePriority = (member: VrrpClusterMember) =>
    member.instance.effectivePriority ?? member.instance.priority ?? 0;

const HealthBadge = ({ health }: { health: VrrpClusterHealth }) => (
    <span title={CLUSTER_HEALTH[health].description}>
        <Badge variant={CLUSTER_HEALTH[health].variant}>{CLUSTER_HEALTH[health].label}</Badge>
    </span>
);

/** The VRID is unique per site only, so the site leads it. */
const vridLabel = (cluster: VrrpCluster) =>
    `${cluster.site ? `${cluster.site} / ` : ""}VRID ${cluster.vrid ?? "?"}`;

const vipLabel = (cluster: VrrpCluster) =>
    cluster.vips.length > 0 ? cluster.vips.join(", ") : cluster.members[0]?.instance.name;

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

/** A cluster matches on its VRID, site or an address, or when one of its hosts matches. */
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
        row.children.some((child) => matches(child, query))
    );
}

const HostLink = ({ row }: { row: Extract<ClusterRow, { kind: "member" }> }) => (
    <Link
        to={`/client/${row.member.clientId}`}
        // The row opens the instance; the name opens the host.
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-2 hover:text-primary"
    >
        <StatusDot online={row.member.online} />
        {row.hostName}
    </Link>
);

/**
 * Every VRRP cluster across the fleet as a tree: the virtual router with its addresses, and
 * under it the hosts that answer for it. The clusters that need attention come first.
 */
export const ClusterOverview = () => {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const clusters = useVrrpClusters();
    const clients = useClientStore((s) => s.clients);
    const [searchQuery, setSearchQuery] = useSearchQueryParam();

    const rows = useMemo(() => toRows(clusters, clients), [clusters, clients]);
    const filteredRows = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        return query ? rows.filter((row) => matches(row, query)) : rows;
    }, [rows, searchQuery]);

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
            tableCellClassName: "text-sm",
            tableItemRender: (row) => (row.kind === "cluster" ? vridLabel(row.cluster) : <HostLink row={row} />),
        },
        {
            tableHeader: "Virtual IPs / Instance",
            tableCellClassName: "text-sm",
            tableItemRender: (row) =>
                row.kind === "cluster" ? (
                    vipLabel(row.cluster)
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
                    <HealthBadge health={row.cluster.health} />
                ) : (
                    <VrrpStateBadge state={row.member.instance.state} />
                ),
        },
        {
            tableHeader: "Priority",
            sortable: true,
            sortValue: (row) => (row.kind === "cluster" ? 0 : effectivePriority(row.member)),
            tableCellClassName: "text-sm",
            tableItemRender: (row) => (row.kind === "member" ? <Priority instance={row.member.instance} /> : null),
        },
        {
            tableHeader: "Last transition",
            tableHeaderClassName: "whitespace-nowrap",
            tableCellClassName: "text-sm whitespace-nowrap",
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
                                <span className="text-text-primary">
                                    {vipLabel(row.cluster)}
                                </span>
                                <span className="text-sm text-text-muted">{vridLabel(row.cluster)}</span>
                                <HealthBadge health={row.cluster.health} />
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
                                                className={`flex flex-wrap items-center gap-2 ${child.member.online ? "" : "opacity-60"}`}
                                            >
                                                <HostLink row={child} />
                                                <Link
                                                    to={instancePath(child.member.clientId, child.member.instance.name)}
                                                    state={{ from: pathname }}
                                                    className="text-text-secondary hover:text-primary"
                                                >
                                                    {child.member.instance.name}
                                                </Link>
                                                <VrrpStateBadge state={child.member.instance.state} />
                                            </li>
                                        ),
                                )}
                            </ul>
                        ),
                },
            ],
        },
    ];

    return (
        <DataMultiView<ClusterRow>
            title={
                <>
                    <Network size={18} className="text-text-muted" /> VRRP Clusters
                </>
            }
            viewMode={{ persist: { key: "clusterViewMode", scope: "local" } }}
            data={filteredRows}
            getChildren={(row) => (row.kind === "cluster" ? row.children : null)}
            tableDef={tableDef}
            listColumns={listColumns}
            treeExpanded={{ all: true }}
            keyField="key"
            searchable
            searchPlaceholder="Search VRID, site, address or host…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            emptyMessage="No VRRP instances reported yet. Clusters appear once a registered agent has read keepalived on its host."
            noResultsMessage="No cluster matches this search."
            // `onRowClick` makes every row look clickable; a cluster row does nothing on click,
            // so it takes the pointer and the hover back. The list shows cluster rows only.
            rowClassName={(row) =>
                row.kind === "cluster"
                    ? "align-top cursor-default hover:bg-transparent"
                    : row.member.online
                      ? "align-top"
                      : "align-top opacity-60"
            }
            // A host opens its instance; a cluster row only expands and collapses. `from` is
            // how the instance page knows where back is.
            onRowClick={(row) =>
                row.kind === "member" &&
                navigate(instancePath(row.member.clientId, row.member.instance.name), { state: { from: pathname } })
            }
        />
    );
};
