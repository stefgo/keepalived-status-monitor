import { beforeEach, describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";

/** Whether invalidating `prefix` reaches `key` -- asked of the cache itself, not rebuilt here. */
function reaches(prefix: readonly unknown[], key: readonly unknown[]): boolean {
    const queryClient = new QueryClient();
    queryClient.setQueryData(key, "cached");
    return queryClient.getQueryCache().findAll({ queryKey: prefix }).length === 1;
}

describe("queryKeys", () => {
    it("reaches each entry from the `all` of its area", () => {
        expect(reaches(queryKeys.clients.all, queryKeys.clients.list())).toBe(true);
        expect(reaches(queryKeys.keepalived.all, queryKeys.keepalived.states())).toBe(true);
        expect(reaches(queryKeys.activity.all, queryKeys.activity.list())).toBe(true);
    });

    // The client list is its own entry: the readings are not below it, so a CLIENTS_UPDATE
    // that replaces the list leaves every reading where it is.
    it("does not reach the readings from the client list", () => {
        expect(reaches(queryKeys.clients.all, queryKeys.keepalived.states())).toBe(false);
    });

    it("reaches the scheduler status from settings.all, and nothing else from there", () => {
        expect(reaches(queryKeys.settings.all, queryKeys.settings.schedulerStatus())).toBe(true);
        expect(reaches(queryKeys.settings.all, queryKeys.webhooks.list())).toBe(false);
    });
});

/**
 * What the socket handler relies on: an update is written with a function that receives
 * what is cached, and an entry that was never read is not created by it.
 */
describe("an update to an entry that was never read", () => {
    let queryClient: QueryClient;
    const key = queryKeys.activity.list();

    beforeEach(() => {
        queryClient = new QueryClient();
    });

    it("creates no entry", () => {
        queryClient.setQueryData<string[]>(key, (events) => events && [...events, "e1"]);
        expect(queryClient.getQueryData(key)).toBeUndefined();
        expect(queryClient.getQueryCache().find({ queryKey: key })).toBeUndefined();
    });

    it("changes one that was", () => {
        queryClient.setQueryData<string[]>(key, []);
        queryClient.setQueryData<string[]>(key, (events) => events && [...events, "e1"]);
        expect(queryClient.getQueryData(key)).toEqual(["e1"]);
    });
});
