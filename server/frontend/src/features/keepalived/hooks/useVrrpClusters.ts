import { useMemo } from "react";
import { buildVrrpClusters, CLIENT_STATUS } from "@kasm/shared";
import { useClients } from "../../../queries/clients";
import { useKeepalivedStates } from "../../../queries/keepalived";

/**
 * The clusters as the server would compute them, recomputed here on every reading and every
 * change of a client's connection -- the same function in `shared`, so the two cannot drift.
 */
export function useVrrpClusters() {
    const { states } = useKeepalivedStates();
    const { clients } = useClients();

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

