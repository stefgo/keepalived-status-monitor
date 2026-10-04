import { useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Crown } from "lucide-react";
import {
    DataMultiView,
    type DataListColumnDef,
    type DataTableDef,
    StatusDot,
} from "@stefgo/react-ui-components";
import type { VrrpCluster, VrrpClusterMember } from "@kasm/shared";
import { useClients } from "../../../queries/clients";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { clientName, formatDate } from "../../../utils";
import { useVrrpClusters } from "../hooks/useVrrpClusters";
import { clusterPath, paths } from "../../../lib/paths";
import { clusterLabel } from "../lib/vrrp";
import { Vips } from "./VrrpInstanceView";
import { VrrpStateBadge } from "./VrrpStateBadge";
import { STORAGE_KEYS } from "../../../lib/storageKeys";

/** One MASTER instance, with the cluster it answers for. The host's name is resolved once. */
interface MasterRow {
    key: string;
    member: VrrpClusterMember;
    cluster: VrrpCluster;
    hostName: string;
}

const HostLink = ({ row }: { row: MasterRow }) => (
    <Link
        to={paths.client(row.member.clientId)}
        // The row leads to the cluster; the host name leads to the host.
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-2 hover:text-primary"
    >
        <StatusDot tone={row.member.online ? "success" : "neutral"} />
        {row.hostName}
    </Link>
);

const lastTransition = (row: MasterRow) => formatDate(row.member.instance.lastTransition, { seconds: true });

/**
 * Every instance in MASTER on an online host -- the ones the MASTER card counts. A row leads
 * to its cluster, the host name to the host.
 */
export const MasterList = () => {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const clusters = useVrrpClusters();
    const { clients } = useClients();
    const [searchQuery, setSearchQuery] = useSearchQueryParam();

    const rows = useMemo(
        () =>
            clusters.flatMap((cluster) =>
                cluster.members
                    .filter((member) => member.online && member.instance.state === "MASTER")
                    .map((member): MasterRow => {
                        const client = clients.find((c) => c.id === member.clientId);
                        return {
                            key: `${cluster.key}/${member.clientId}:${member.instance.name}`,
                            member,
                            cluster,
                            hostName: client ? clientName(client) : member.clientId,
                        };
                    }),
            ),
        [clusters, clients],
    );

    const filteredRows = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return rows;
        return rows.filter(
            (row) =>
                row.hostName.toLowerCase().includes(query) ||
                String(row.cluster.vrid ?? "").includes(query) ||
                !!row.cluster.site?.toLowerCase().includes(query) ||
                row.member.instance.vips.some((vip) => vip.toLowerCase().includes(query)),
        );
    }, [rows, searchQuery]);

    const tableDef: DataTableDef<MasterRow>[] = [
        {
            tableHeader: "Host",
            sortable: true,
            sortValue: (row) => row.hostName,
            tableCellClassName: "text-sm",
            tableItemRender: (row) => <HostLink row={row} />,
        },
        {
            tableHeader: "VRID",
            sortable: true,
            // By site first, then numerically by VRID (1–255, hence the padding).
            sortValue: (row) => `${row.cluster.site ?? ""}|${String(row.cluster.vrid ?? 0).padStart(3, "0")}`,
            tableCellClassName: "text-sm",
            tableItemRender: (row) => clusterLabel(row.cluster),
        },
        {
            tableHeader: "Virtual IPs",
            tableCellClassName: "text-sm",
            tableItemRender: (row) => <Vips instance={row.member.instance} />,
        },
        {
            tableHeader: "State",
            tableItemRender: (row) => <VrrpStateBadge state={row.member.instance.state} />,
        },
        {
            tableHeader: "Last transition",
            sortable: true,
            sortValue: (row) => row.member.instance.lastTransition ?? "",
            tableHeaderClassName: "whitespace-nowrap",
            tableCellClassName: "text-sm whitespace-nowrap",
            tableItemRender: lastTransition,
        },
    ];

    const listColumns: DataListColumnDef<MasterRow>[] = [
        {
            columnClassName: "flex-1",
            fields: [
                {
                    listLabel: null,
                    listItemRender: (row) => (
                        <div className="flex flex-wrap items-center gap-2 py-1">
                            <span className="font-medium text-text-primary">
                                <HostLink row={row} />
                            </span>
                            <span className="text-sm text-text-muted">{clusterLabel(row.cluster)}</span>
                            <VrrpStateBadge state={row.member.instance.state} />
                        </div>
                    ),
                },
                { listLabel: "Virtual IPs", listItemRender: (row) => <Vips instance={row.member.instance} /> },
                { listLabel: "Last transition", listItemRender: lastTransition },
            ],
        },
    ];

    return (
        <DataMultiView<MasterRow>
            title={
                <>
                    <Crown size={18} className="text-text-muted" /> MASTER
                </>
            }
            viewMode={{ persist: { key: STORAGE_KEYS.mastersView, scope: "local" } }}
            data={filteredRows}
            tableDef={tableDef}
            listColumns={listColumns}
            keyField="key"
            searchable
            searchPlaceholder="Search host, VRID, site or address…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            emptyMessage="No host is MASTER of a VRRP instance."
            noResultsMessage="No MASTER matches this search."
            // A cluster without a VRID has no page, so its row takes the pointer and the hover back.
            rowClassName={(row) =>
                clusterPath(row.cluster, clusters) ? "align-top" : "align-top cursor-default hover:bg-transparent"
            }
            // `from` is how the cluster page knows where back is.
            onRowClick={(row) => {
                const to = clusterPath(row.cluster, clusters);
                if (to) navigate(to, { state: { from: pathname } });
            }}
        />
    );
};
