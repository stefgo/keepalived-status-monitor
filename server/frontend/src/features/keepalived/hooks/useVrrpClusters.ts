import { useMemo } from "react";
import { buildNamedClusters } from "@kasm/shared";
import { useClients } from "../../../queries/clients";
import { useKeepalivedStates } from "../../../queries/keepalived";

/**
 * The clusters as the server computes them, recomputed here on every reading and every
 * change of a client's connection -- the same function in `shared`, so the dashboard and the
 * server's status report cannot drift.
 *
 * Each member carries its host's name (`hostName`): the server sends ids, and this is the one
 * place they are looked up.
 */
export function useVrrpClusters() {
    const { states } = useKeepalivedStates();
    const { clients } = useClients();

    return useMemo(() => buildNamedClusters(clients, Object.values(states)), [states, clients]);
}
