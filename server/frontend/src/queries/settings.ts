import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ManualRunResultSchema, SettingsResponseSchema } from "@kasm/shared";
import { api } from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import { schedulerStatusOptions } from "./scheduler";

/** The settings block as the fields hold it: every value a string. */
export type SettingsValues = Record<string, string>;

/**
 * The settings block of config.yaml. A value an operator wrote by hand is a number there
 * and a string once the UI has saved it, so everything is read as the string a field shows.
 */
export const settingsOptions = queryOptions({
    queryKey: queryKeys.settings.cleanup(),
    queryFn: async (): Promise<SettingsValues> => {
        const settings = await api.get("/api/v1/settings/cleanup", SettingsResponseSchema, {
            fallback: "Failed to fetch settings",
        });
        return Object.fromEntries(
            Object.entries(settings)
                .filter(([, value]) => value !== null && value !== undefined)
                .map(([key, value]) => [key, String(value)]),
        );
    },
});

export function useSettings() {
    return useQuery(settingsOptions);
}

/**
 * Saves the keys it is given; the server merges them into the stored block and names the
 * offending field when it refuses. The cached block takes the same keys, and the scheduler
 * status is read again: a changed interval moves the next scheduled run.
 */
export function useSaveSettings() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (values: SettingsValues) =>
            api.put("/api/v1/settings/cleanup", values, undefined, { fallback: "Failed to save settings" }),
        onSuccess: (_data, values) => {
            queryClient.setQueryData(settingsOptions.queryKey, (settings) => settings && { ...settings, ...values });
            return queryClient.invalidateQueries({ queryKey: schedulerStatusOptions.queryKey });
        },
    });
}

/**
 * Starts a maintenance job now and returns what it reports. Not cached: the run is made
 * now or not at all, and the scheduler's status follows as `SCHEDULER_STATUS_UPDATE`.
 */
export const runCleanup = (job: "invalid-tokens" | "notifications") =>
    api.post(`/api/v1/settings/cleanup/${job}`, undefined, ManualRunResultSchema, {
        fallback: "The server refused to start the job",
    });
