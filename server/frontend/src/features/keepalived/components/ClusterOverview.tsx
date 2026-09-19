import { Network } from "lucide-react";
import { Card } from "@stefgo/react-ui-components";
import { useVrrpClusters } from "../hooks/useVrrpClusters";
import { ClusterCard } from "./ClusterCard";

/** Every VRRP cluster across the fleet, the ones that need attention first. */
export const ClusterOverview = () => {
    const clusters = useVrrpClusters();

    return (
        <div className="space-y-6">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary">
                <Network size={18} className="text-text-muted" /> VRRP Clusters
            </h2>
            {clusters.length === 0 ? (
                <Card padding="md">
                    <p className="text-text-secondary">
                        No VRRP instances reported yet. Clusters appear once a registered agent
                        has read keepalived on its host.
                    </p>
                </Card>
            ) : (
                clusters.map((cluster) => <ClusterCard key={cluster.key} cluster={cluster} />)
            )}
        </div>
    );
};
