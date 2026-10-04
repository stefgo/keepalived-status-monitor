import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Crown } from "lucide-react";
import {
    DataMultiView,
    EmptyState,
    type DataColumnDef,
    StatusDot,
    listGroups,
} from "@stefgo/react-ui-components";
import type { VrrpCluster } from "@kasm/shared";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { RelativeTime } from "../../../components/RelativeTime";
import { useVrrpClusters } from "../hooks/useVrrpClusters";
import { clusterPath, paths } from "../../../lib/paths";
import { clusterLabel, type NamedClusterMember } from "../lib/vrrp";
import { Vips } from "./VrrpInstanceView";
import { VrrpStateBadge } from "./VrrpStateBadge";
import { STORAGE_KEYS } from "../../../lib/storageKeys";

/** One MASTER instance, with the cluster it answers for. */
interface MasterRow {
    key: string;
    member: NamedClusterMember;
    cluster: VrrpCluster;
}

const HostLink = ({ row }: { row: MasterRow }) => (
    <Link
        to={paths.client(row.member.clientId)}
        // The row leads to the cluster; the host name leads to the host.
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-2 hover:text-primary"
    >
        <StatusDot tone={row.member.online ? "success" : "neutral"} />
        {row.member.hostName}
    </Link>
);

// Handed to the view instead of applied in front of it: only then can the view tell a search
// without a hit from a list with nothing in it.
const matchesSearch = (row: MasterRow, search: string) => {
    const query = search.trim().toLowerCase();
    return (
        row.member.hostName.toLowerCase().includes(query) ||
        String(row.cluster.vrid ?? "").includes(query) ||
        !!row.cluster.site?.toLowerCase().includes(query) ||
        row.member.instance.vips.some((vip) => vip.toLowerCase().includes(query))
    );
};

/**
 * Every instance in MASTER on an online host -- the ones the MASTER card counts. A row leads
 * to its cluster, the host name to the host.
 */
export const MasterList = () => {
    const navigate = useNavigate();
    const clusters = useVrrpClusters();
    const [searchQuery, setSearchQuery] = useSearchQueryParam();

    const rows = useMemo(
        () =>
            clusters.flatMap((cluster) =>
                cluster.members
                    .filter((member) => member.online && member.instance.state === "MASTER")
                    .map(
                        (member): MasterRow => ({
                            key: `${cluster.key}/${member.clientId}:${member.instance.name}`,
                            member,
                            cluster,
                        }),
                    ),
            ),
        [clusters],
    );

    const columns: DataColumnDef<MasterRow>[] = [
        {
            header: "Host",
            sortable: true,
            sortValue: (row) => row.member.hostName,
            table: { cellClassName: "text-sm" },
            list: { label: null },
            // The list has no VRID and no State column: both stand beside the host.
            render: (row, view) =>
                view === "list" ? (
                    <div className="flex flex-wrap items-center gap-2 py-1">
                        <span className="font-medium text-text-primary">
                            <HostLink row={row} />
                        </span>
                        <span className="text-sm text-text-muted">{clusterLabel(row.cluster)}</span>
                        <VrrpStateBadge state={row.member.instance.state} />
                    </div>
                ) : (
                    <HostLink row={row} />
                ),
        },
        {
            header: "VRID",
            sortable: true,
            // By site first, then numerically by VRID (1–255, hence the padding).
            sortValue: (row) => `${row.cluster.site ?? ""}|${String(row.cluster.vrid ?? 0).padStart(3, "0")}`,
            table: { cellClassName: "text-sm" },
            list: false,
            render: (row) => clusterLabel(row.cluster),
        },
        {
            header: "Virtual IPs",
            table: { cellClassName: "text-sm" },
            render: (row) => <Vips instance={row.member.instance} />,
        },
        {
            header: "State",
            list: false,
            render: (row) => <VrrpStateBadge state={row.member.instance.state} />,
        },
        {
            header: "Last transition",
            sortable: true,
            sortValue: (row) => row.member.instance.lastTransition ?? "",
            table: { headerClassName: "whitespace-nowrap", cellClassName: "text-sm whitespace-nowrap" },
            render: (row) => <RelativeTime date={row.member.instance.lastTransition} seconds />,
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
            data={rows}
            columns={columns}
            listGroups={listGroups()}
            keyField="key"
            searchable
            searchPlaceholder="Search host, VRID, site or address…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            searchFilter={matchesSearch}
            emptyMessage={
                <EmptyState
                    icon={Crown}
                    title="No host is MASTER"
                    description="An instance is listed here while an online host holds it as MASTER."
                />
            }
            noResultsMessage="No MASTER matches this search."
            // A cluster without a VRID has no page, so its row takes the pointer and the hover back.
            rowClassName={(row) =>
                clusterPath(row.cluster, clusters) ? "align-top" : "align-top cursor-default hover:bg-transparent"
            }
            onRowClick={(row) => {
                const to = clusterPath(row.cluster, clusters);
                if (to) navigate(to);
            }}
        />
    );
};
