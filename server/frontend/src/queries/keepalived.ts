import { queryOptions, useQuery } from "@tanstack/react-query";
import { KeepalivedStateListSchema, type KeepalivedState } from "@kasm/shared";
import { api } from "../lib/api";
import { mergeKeepalivedStates, type KeepalivedStates } from "../lib/cacheUpdates";
import { queryClient } from "../lib/queryClient";
import { queryKeys } from "../lib/queryKeys";

const NO_STATES: KeepalivedStates = {};

/**
 * The last reading of every client, by client id.
 *
 * Never stale by age: the server sends every reading on socket connect and each new one as
 * `KEEPALIVED_STATE_UPDATE`. The request covers a slow socket, and its answer is laid over
 * what the socket has delivered meanwhile -- per client the later reading stays.
 */
export const keepalivedStatesOptions = queryOptions({
    queryKey: queryKeys.keepalived.states(),
    queryFn: async (): Promise<KeepalivedStates> => {
        const fetched = await api.get("/api/v1/keepalived/states", KeepalivedStateListSchema, {
            fallback: "Could not load the keepalived readings",
        });
        return mergeKeepalivedStates(queryClient.getQueryData<KeepalivedStates>(queryKeys.keepalived.states()), fetched);
    },
    staleTime: Infinity,
});

/**
 * `isPending` until the readings have arrived once; an empty set before that says nothing.
 * `error` is why there are none -- not a reload that failed behind readings on screen.
 */
export function useKeepalivedStates() {
    const { data, isPending, error } = useQuery(keepalivedStatesOptions);
    return { states: data ?? NO_STATES, isPending, error: data === undefined ? error : null };
}

/** One client's last reading; `undefined` while there is none. */
export function useKeepalivedState(clientId: string): KeepalivedState | undefined {
    return useQuery({
        ...keepalivedStatesOptions,
        select: (states) => states[clientId],
    }).data;
}

/**
 * Asks the agent to read keepalived now. Not cached: the reading arrives over the socket
 * as `KEEPALIVED_STATE_UPDATE`, and a refusal ("Client is offline") is the answer here.
 */
export const refreshKeepalived = (clientId: string) =>
    api.post(`/api/v1/clients/${clientId}/keepalived/refresh`, undefined, undefined, {
        fallback: "Failed to ask the agent for a reading",
    });
