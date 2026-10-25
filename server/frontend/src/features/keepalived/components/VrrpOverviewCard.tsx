import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Network } from "lucide-react";
import {
    Badge,
    Card,
    DescriptionList,
    EmptyState,
    FOCUS_RING,
    StatusDot,
    cn,
    type DescriptionItem,
} from "@stefgo/react-ui-components";
import type { KeepalivedState } from "@kasm/shared";
import { RelativeTime } from "../../../components/RelativeTime";
import { clusterPath } from "../../../lib/paths";
import { EMPTY_VALUE, plural } from "../../../utils";
import { clusterFindings } from "../lib/clusterFindings";
import { clusterLabel, clusterVipLabel, type NamedVrrpCluster } from "../lib/vrrp";
import {
    FLEET_STATUS,
    clusterLastChange,
    clusterTone,
    visibleTiles,
    vrrpOverview,
    type Fact,
    type FleetStatus,
} from "../lib/vrrpOverview";
import { ClusterHealthBadge } from "./ClusterHealthBadge";

const TONE_CLASS = { warning: "text-warning", error: "text-error" } as const;

const FactText = ({ fact }: { fact: Fact }) => (
    <span className={fact.tone ? TONE_CLASS[fact.tone] : undefined}>{fact.text}</span>
);

/** One cluster: its name, addresses and health, who holds it, and its worst finding. */
const ClusterTile = ({ cluster, clusters }: { cluster: NamedVrrpCluster; clusters: NamedVrrpCluster[] }) => {
    const live = cluster.members.filter((member) => member.online && member.reporting);
    const masters = live.filter((member) => member.instance.state === "MASTER");
    const lastChange = clusterLastChange(cluster);
    const [worst, ...rest] = clusterFindings(cluster);
    const summary = worst ? (rest.length > 0 ? `${worst.text} (+${rest.length} more)` : worst.text) : "No findings";
    const path = clusterPath(cluster, clusters);

    const body = (
        <>
            <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                    <StatusDot tone={clusterTone(cluster.health)} />
                    <span className="truncate font-semibold text-text-primary">{clusterLabel(cluster)}</span>
                </span>
                <ClusterHealthBadge health={cluster.health} />
            </div>
            {/* The addresses, as the cluster's page names them: what applications reach it under. */}
            <div className="mt-1 truncate text-xs text-text-muted" title={clusterVipLabel(cluster)}>
                {clusterVipLabel(cluster) ?? EMPTY_VALUE}
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className="min-w-0">
                    <dt className="text-text-muted">MASTER</dt>
                    <dd
                        // No MASTER among live members, or more than one, is what turns a badge red.
                        className={cn(
                            "truncate font-medium",
                            live.length > 0 && masters.length !== 1 ? "text-error" : "text-text-primary",
                        )}
                        title={masters.map((member) => member.hostName).join(", ") || undefined}
                    >
                        {masters.length === 0
                            ? live.length === 0
                                ? EMPTY_VALUE
                                : "None"
                            : masters.length === 1
                              ? masters[0].hostName
                              : plural(masters.length, "host")}
                    </dd>
                </div>
                <div>
                    <dt className="text-text-muted">Members</dt>
                    <dd className="font-medium text-text-primary">
                        {live.length} / {cluster.members.length}
                    </dd>
                </div>
                <div>
                    <dt className="text-text-muted">Last change</dt>
                    <dd className="font-medium text-text-primary">
                        {lastChange ? <RelativeTime date={lastChange} /> : EMPTY_VALUE}
                    </dd>
                </div>
            </dl>
            <p
                className={cn(
                    "mt-3 truncate text-xs",
                    worst?.severity === "error" ? "text-error" : worst ? "text-warning" : "text-text-muted",
                )}
                title={summary}
            >
                {summary}
            </p>
        </>
    );

    const frame = "block rounded-lg border border-border bg-app-bg p-4";
    return path ? (
        <Link to={path} className={cn(frame, "hover:border-primary", FOCUS_RING)}>
            {body}
        </Link>
    ) : (
        <div className={frame}>{body}</div>
    );
};

interface VrrpOverviewCardProps {
    clusters: NamedVrrpCluster[];
    status: FleetStatus;
    /** The readings of the hosts that are online. */
    readings: KeepalivedState[];
    /** Opens the list of every cluster, for the tiles left out beyond `TILE_LIMIT`. */
    onShowAll: () => void;
}

/**
 * VRRP at a glance, as sadm's domain card shows the domain: the fleet's status in the title,
 * the facts about VRRP on the left, a tile per cluster on the right. It is there whether
 * anything is wrong or not.
 */
export const VrrpOverviewCard = ({ clusters, status, readings, onShowAll }: VrrpOverviewCardProps) => {
    const overview = useMemo(() => vrrpOverview(clusters, readings), [clusters, readings]);
    const { shown, hidden } = visibleTiles(clusters);

    const items: DescriptionItem[] = [
        { label: "Clusters", value: overview.clusters },
        { label: "Instances", value: overview.instances },
        { label: "MASTER held by", value: overview.masters },
        { label: "Virtual IPs", value: <FactText fact={overview.vips} /> },
        ...(overview.syncGroups ? [{ label: "Sync groups", value: <FactText fact={overview.syncGroups} /> }] : []),
        ...(overview.versions ? [{ label: "keepalived", value: <FactText fact={overview.versions} /> }] : []),
        {
            label: "Last failover",
            value: overview.lastFailover ? (
                <span>
                    {overview.lastFailover.text} · <RelativeTime date={overview.lastFailover.at} />
                </span>
            ) : (
                EMPTY_VALUE
            ),
        },
        ...(overview.sites ? [{ label: "Sites", value: overview.sites }] : []),
    ];

    let tiles: ReactNode;
    if (clusters.length === 0) {
        tiles = (
            <EmptyState
                icon={Network}
                title="No VRRP cluster in sight"
                description="Clusters appear once an agent reports keepalived's instances."
            />
        );
    } else {
        tiles = (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:content-start">
                {shown.map((cluster) => (
                    <ClusterTile key={cluster.key} cluster={cluster} clusters={clusters} />
                ))}
                {hidden > 0 && (
                    <button
                        type="button"
                        onClick={onShowAll}
                        className={cn(
                            "rounded-lg border border-dashed border-border p-4 text-sm text-text-secondary hover:border-primary hover:text-primary",
                            FOCUS_RING,
                        )}
                    >
                        {plural(hidden, "more healthy cluster")} · Show all
                    </button>
                )}
            </div>
        );
    }

    return (
        <Card
            title={
                <span className="flex flex-wrap items-center gap-2">
                    VRRP
                    <span title={FLEET_STATUS[status].description}>
                        <Badge variant={FLEET_STATUS[status].variant}>{FLEET_STATUS[status].label}</Badge>
                    </span>
                </span>
            }
            titleAs="h2"
            padding="md"
        >
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <DescriptionList items={items} columns={2} />
                {tiles}
            </div>
        </Card>
    );
};
