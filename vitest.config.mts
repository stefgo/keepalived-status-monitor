import { defineConfig } from "vitest/config";

// One config for every workspace that has tests, so `npm test` at the root is the
// whole suite. Both projects run in plain Node: what is tested is logic, and a DOM
// would only be needed once a component is.
export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: "shared",
                    environment: "node",
                    include: ["shared/src/**/*.test.ts"],
                },
            },
            {
                // Deliberately not server/frontend/vite.config.js: that one shells out
                // to git for the version and sets up the dev proxy, neither of which a
                // test needs.
                resolve: {
                    // @kasm/shared exports its source under this condition. Without it
                    // the frontend tests would read shared/dist -- which needs a build
                    // first and is stale the moment shared/src changes.
                    conditions: ["development"],
                },
                test: {
                    name: "frontend",
                    environment: "node",
                    include: ["server/frontend/src/**/*.test.ts"],
                },
            },
        ],
    },
});
