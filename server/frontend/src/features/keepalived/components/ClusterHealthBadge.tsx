import { Badge } from "@stefgo/react-ui-components";
import type { VrrpClusterHealth } from "@kasm/shared";
import { CLUSTER_HEALTH } from "../lib/vrrp";

/** A cluster's health, with what it means as the tooltip. */
export const ClusterHealthBadge = ({ health }: { health: VrrpClusterHealth }) => (
    <span title={CLUSTER_HEALTH[health].description}>
        <Badge variant={CLUSTER_HEALTH[health].variant}>{CLUSTER_HEALTH[health].label}</Badge>
    </span>
);
