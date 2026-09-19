import { useMemo } from "react";
import { buildVrrpClusters, CLIENT_STATUS } from "@kasm/shared";
import { useClientStore } from "../../../stores/useClientStore";
import { useKeepalivedStore } from "../../../stores/useKeepalivedStore";

/**
 * The clusters as the server would compute them, recomputed here on every reading and every
 * change of a client's connection -- the same function in `shared`, so the two cannot drift.
 */
export function useVrrpClusters() {
    const states = useKeepalivedStore((s) => s.states);
    const clients = useClientStore((s) => s.clients);

    return useMemo(() => {
        const known = new Set(clients.map((client) => client.id));
        const online = clients
            .filter((client) => client.status === CLIENT_STATUS.ONLINE)
            .map((client) => client.id);
        // A reading of a client that has since been deleted is not part of any cluster.
        const current = Object.values(states).filter((state) => known.has(state.clientId));
        return buildVrrpClusters(current, online);
    }, [states, clients]);
}
