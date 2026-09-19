import { Link } from "react-router-dom";
import { Badge } from "@stefgo/react-ui-components";
import type { VrrpCluster } from "@kasm/shared";
import { useClientStore } from "../../../stores/useClientStore";
import { clientName } from "../../../utils";
import { StatusDot } from "../../clients/components/StatusDot";
import { CLUSTER_HEALTH, instancePath } from "../lib/vrrp";
import { VrrpInstanceView } from "./VrrpInstanceView";

/**
 * One virtual router and every host that takes part in it. The instance view is the card
 * itself: it brings its own, and a second one around it would nest two frames. A row opens
 * that host's instance; the host name in it opens the host.
 */
export const ClusterCard = ({ cluster }: { cluster: VrrpCluster }) => {
    const clients = useClientStore((s) => s.clients);
    const health = CLUSTER_HEALTH[cluster.health];
    const title = cluster.vips.length > 0 ? cluster.vips.join(", ") : cluster.members[0]?.instance.name;

    return (
        <VrrpInstanceView
            showHost
            title={
                <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{title}</span>
                    <span className="text-sm font-normal text-text-muted">
                        VRID {cluster.vrid ?? "?"}
                    </span>
                </span>
            }
            extraActions={
                <span title={health.description}>
                    <Badge variant={health.variant}>{health.label}</Badge>
                </span>
            }
            rows={[...cluster.members]
                .sort((a, b) => (b.instance.effectivePriority ?? 0) - (a.instance.effectivePriority ?? 0))
                .map((member) => {
                    const client = clients.find((c) => c.id === member.clientId);
                    return {
                        key: `${member.clientId}:${member.instance.name}`,
                        href: instancePath(member.clientId, member.instance.name),
                        instance: member.instance,
                        stale: !member.online,
                        host: (
                            <Link
                                to={`/client/${member.clientId}`}
                                className="flex items-center gap-2 hover:text-primary"
                            >
                                <StatusDot online={member.online} />
                                {client ? clientName(client) : member.clientId}
                            </Link>
                        ),
                    };
                })}
        />
    );
};
