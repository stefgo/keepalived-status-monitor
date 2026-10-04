/**
 * Every key the cache is addressed by, in one place.
 *
 * The keys are hierarchical on purpose: `invalidateQueries({ queryKey: settings.all })`
 * reaches the cleanup settings and the scheduler status alike, because a key matches
 * whatever it is a prefix of. `queryKeys.test.ts` holds the prefix relations the code
 * relies on.
 */
export const queryKeys = {
    clients: {
        all: ["clients"] as const,
        list: () => ["clients", "list"] as const,
    },
    keepalived: {
        all: ["keepalived"] as const,
        /** The last reading of every client, in one entry: the server answers them in one list. */
        states: () => ["keepalived", "states"] as const,
    },
    activity: {
        all: ["activity"] as const,
        list: () => ["activity", "list"] as const,
    },
    webhooks: {
        all: ["webhooks"] as const,
        list: () => ["webhooks", "list"] as const,
    },
    settings: {
        all: ["settings"] as const,
        cleanup: () => ["settings", "cleanup"] as const,
        schedulerStatus: () => ["settings", "scheduler-status"] as const,
    },
    tokens: {
        all: ["tokens"] as const,
        list: () => ["tokens", "list"] as const,
    },
    users: {
        all: ["users"] as const,
        list: () => ["users", "list"] as const,
    },
};
