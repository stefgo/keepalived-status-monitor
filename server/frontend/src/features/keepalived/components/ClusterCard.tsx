import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { VrrpCluster } from "@kasm/shared";
import { useClientStore } from "../../../stores/useClientStore";
import { clientName } from "../../../utils";
import { StatusDot } from "../../clients/components/StatusDot";
import { useClusterPath } from "../hooks/useVrrpClusters";
import { clusterVipLabel } from "../lib/vrrp";
import { ClusterHealthBadge } from "./ClusterHealthBadge";
import { VrrpInstanceView } from "./VrrpInstanceView";

interface ClusterCardProps {
    cluster: VrrpCluster;
    /**
     * Replaces the cluster's addresses, VRID, site and health in the card header -- for the
     * cluster's own page, whose header says all of that already.
     */
    title?: ReactNode;
}

/**
 * One virtual router and every host that takes part in it. The instance view is the card
 * itself: it brings its own, and a second one around it would nest two frames. A row opens
 * that host; the title opens the cluster's page.
 */
export const ClusterCard = ({ cluster, title }: ClusterCardProps) => {
    const { pathname } = useLocation();
    const clients = useClientStore((s) => s.clients);
    const clusterPath = useClusterPath();
    const path = clusterPath(cluster);
    const vipLabel = <span className="font-mono">{clusterVipLabel(cluster)}</span>;

    return (
        <VrrpInstanceView
            showHost
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
            rows={[...cluster.members]
                .sort((a, b) => (b.instance.effectivePriority ?? 0) - (a.instance.effectivePriority ?? 0))
                .map((member) => {
                    const client = clients.find((c) => c.id === member.clientId);
                    return {
                        key: `${member.clientId}:${member.instance.name}`,
                        href: `/client/${member.clientId}`,
                        instance: member.instance,
                        stale: !member.online,
                        host: (
                            <span className="flex items-center gap-2">
                                <StatusDot online={member.online} />
                                {client ? clientName(client) : member.clientId}
                            </span>
                        ),
                    };
                })}
        />
    );
};
