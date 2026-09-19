import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Checkbox } from "@stefgo/react-ui-components";
import type { VrrpCluster } from "@kasm/shared";
import { useClientStore } from "../../../stores/useClientStore";
import { clientName } from "../../../utils";
import { StatusDot } from "../../clients/components/StatusDot";
import { useClusterPath } from "../hooks/useVrrpClusters";
import { clusterVipLabel, memberKey } from "../lib/vrrp";
import { ClusterHealthBadge } from "./ClusterHealthBadge";
import { VrrpInstanceView } from "./VrrpInstanceView";

export interface ClusterCompare {
    /** Whether the member with this `memberKey` is compared. */
    selected: (key: string) => boolean;
    onToggle: (key: string, on: boolean) => void;
    onToggleAll: (on: boolean) => void;
}

interface ClusterCardProps {
    cluster: VrrpCluster;
    /**
     * Replaces the cluster's addresses, VRID, site and health in the card header -- for the
     * cluster's own page, whose header says all of that already.
     */
    title?: ReactNode;
    /** Adds a column to pick the hosts whose counters are compared -- for the cluster's own page. */
    compare?: ClusterCompare;
}

/**
 * One virtual router and every host that takes part in it. The instance view is the card
 * itself: it brings its own, and a second one around it would nest two frames. A row opens
 * that host; the title opens the cluster's page.
 */
export const ClusterCard = ({ cluster, title, compare }: ClusterCardProps) => {
    const { pathname } = useLocation();
    const clients = useClientStore((s) => s.clients);
    const clusterPath = useClusterPath();
    const path = clusterPath(cluster);
    const vipLabel = <span className="font-mono">{clusterVipLabel(cluster)}</span>;

    const compared = compare ? cluster.members.filter((m) => compare.selected(memberKey(m))).length : 0;

    return (
        <VrrpInstanceView
            showHost
            // The addresses and the VRID are part of what makes the cluster: every member
            // reports the same ones.
            showVips={false}
            showVrid={false}
            title={
                title ?? (
                    <span className="flex flex-wrap items-center gap-2">
                        {path ? (
                            <Link to={path} state={{ from: pathname }} className="hover:text-primary">
                                {vipLabel}
                            </Link>
                        ) : (
                            vipLabel
                        )}
                        <span className="text-sm font-normal text-text-muted">
                            VRID {cluster.vrid ?? "?"}
                        </span>
                        {cluster.site && (
                            <span className="text-sm font-normal text-text-muted">
                                Site {cluster.site}
                            </span>
                        )}
                    </span>
                )
            }
            extraActions={title === undefined && <ClusterHealthBadge health={cluster.health} />}
            leadingHeader={
                compare && (
                    <Checkbox
                        aria-label="Compare all hosts"
                        title="Compare counters"
                        checked={compared > 0 && compared === cluster.members.length}
                        indeterminate={compared > 0 && compared < cluster.members.length}
                        onChange={(e) => compare.onToggleAll(e.target.checked)}
                    />
                )
            }
            rows={[...cluster.members]
                .sort((a, b) => (b.instance.effectivePriority ?? 0) - (a.instance.effectivePriority ?? 0))
                .map((member) => {
                    const client = clients.find((c) => c.id === member.clientId);
                    const name = client ? clientName(client) : member.clientId;
                    const key = memberKey(member);
                    return {
                        key,
                        href: `/client/${member.clientId}`,
                        instance: member.instance,
                        stale: !member.online,
                        host: (
                            <span className="flex items-center gap-2">
                                <StatusDot online={member.online} />
                                {name}
                            </span>
                        ),
                        leading: compare && (
                            // The row opens the host; ticking the box must not.
                            <span className="flex items-center" onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                    aria-label={`Compare ${name}`}
                                    checked={compare.selected(key)}
                                    onChange={(e) => compare.onToggle(key, e.target.checked)}
                                />
                            </span>
                        ),
                    };
                })}
        />
    );
};
