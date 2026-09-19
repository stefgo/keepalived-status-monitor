import { useCallback, useMemo } from "react";
import { buildVrrpClusters, CLIENT_STATUS, type VrrpCluster } from "@kasm/shared";
import { useClientStore } from "../../../stores/useClientStore";
import { useKeepalivedStore } from "../../../stores/useKeepalivedStore";
import { clusterPath } from "../lib/vrrp";

/**
 * The clusters as the server would compute them, recomputed here on every reading and every
 * change of a client's connection -- the same function in `shared`, so the two cannot drift.
 */
export function useVrrpClusters() {
    const states = useKeepalivedStore((s) => s.states);
    const clients = useClientStore((s) => s.clients);

    return useMemo(() => {
        const sites = new Map(clients.map((client) => [client.id, client.site ?? null]));
        const online = clients
            .filter((client) => client.status === CLIENT_STATUS.ONLINE)
            .map((client) => client.id);
        // A reading of a client that has since been deleted is not part of any cluster.
        const current = Object.values(states).filter((state) => sites.has(state.clientId));
        return buildVrrpClusters(current, online, (clientId) => sites.get(clientId) ?? null);
    }, [states, clients]);
}

/**
 * `clusterPath` against the clusters of the moment: whether a cluster needs `?net=` depends
 * on whether another one shares its site and VRID.
 */
export function useClusterPath() {
    const clusters = useVrrpClusters();
    return useCallback((cluster: VrrpCluster) => clusterPath(cluster, clusters), [clusters]);
}
