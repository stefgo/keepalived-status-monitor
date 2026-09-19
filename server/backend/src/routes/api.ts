import { FastifyInstance } from "fastify";
import { AuthController } from "../controllers/AuthController.js";
import { UserController } from "../controllers/UserController.js";
import { ClientController } from "../controllers/ClientController.js";
import { TokenController } from "../controllers/TokenController.js";
import { SettingsController } from "../controllers/SettingsController.js";
import { KeepalivedController } from "../controllers/KeepalivedController.js";
import { ActivityController } from "../controllers/ActivityController.js";
import db from "../core/Database.js";

export default async function apiRoutes(fastify: FastifyInstance) {
    /**
     * Liveness for the container's HEALTHCHECK, the CI smoke test and monitoring.
     * Unauthenticated: a probe has no session, and the answer discloses nothing.
     *
     * Under /api on purpose. index.ts answers every path outside /api with the SPA's
     * index.html and HTTP 200, so a /health route that failed to register would keep
     * "succeeding" with an HTML body. Under /api an unknown path is a 404.
     *
     * Deliberately narrow: can this process serve requests and reach its database. Agent
     * connections are not consulted -- one offline agent must not mark the control plane
     * as broken.
     */
    fastify.get("/health", async (request, reply) => {
        try {
            db.prepare("SELECT 1").get();
            return { status: "ok" };
        } catch (err) {
            request.log.error({ err }, "Health check failed: database unreachable");
            return reply.code(503).send({ status: "error" });
        }
    });

    // Auth
    // The one unauthenticated endpoint that password guesses can be aimed at, and the
    // default admin/admin account exists until somebody changes it. Ten attempts per
    // quarter hour is far above what a person typing a password needs and far below
    // what guessing needs.
    fastify.post(
        "/login",
        {
            config: {
                rateLimit: { max: 10, timeWindow: "15 minutes" },
            },
        },
        AuthController.login,
    );
    // Unauthenticated on purpose: it only clears cookies, and requiring a valid session
    // would make an expired one impossible to log out of.
    fastify.post("/auth/logout", AuthController.logout);
    fastify.get("/auth/config", AuthController.getConfig);
    fastify.get("/auth/login", AuthController.oidcLogin);
    fastify.get("/auth/callback", AuthController.oidcCallback);

    // Register /api/v1 routes
    fastify.register(
        async (v1) => {
            // Protected Routes
            v1.register(async (protectedRoutes) => {
                protectedRoutes.addHook("onRequest", async (request, reply) => {
                    try {
                        await request.jwtVerify();
                    } catch (err) {
                        reply.send(err);
                    }
                });

                // The session's own identity. Behind the JWT hook like everything else here,
                // so an expired session answers 401 and the UI logs out through the same
                // path as for any other call.
                protectedRoutes.get("/me", AuthController.me);

                // Users
                protectedRoutes.get("/users", UserController.list);
                protectedRoutes.post("/users", UserController.create);
                protectedRoutes.put("/users/:userId", UserController.update);
                protectedRoutes.delete("/users/:userId", UserController.delete);

                // Clients
                protectedRoutes.get("/clients", ClientController.list);
                protectedRoutes.post("/clients/outbound", ClientController.createOutbound);
                protectedRoutes.delete(
                    "/clients/:clientId",
                    ClientController.delete,
                );
                protectedRoutes.put(
                    "/clients/:clientId",
                    ClientController.update,
                );
                protectedRoutes.post(
                    "/clients/:clientId/reconnect",
                    ClientController.reconnect,
                );

                // Registration Tokens
                protectedRoutes.get("/tokens", TokenController.list);
                protectedRoutes.post("/tokens", TokenController.create);
                protectedRoutes.delete(
                    "/tokens/:token",
                    TokenController.delete,
                );

                // keepalived
                protectedRoutes.get("/keepalived/states", KeepalivedController.listStates);
                protectedRoutes.get("/keepalived/clusters", KeepalivedController.listClusters);
                protectedRoutes.get(
                    "/clients/:clientId/keepalived",
                    KeepalivedController.getState,
                );
                protectedRoutes.post(
                    "/clients/:clientId/keepalived/refresh",
                    KeepalivedController.refresh,
                );

                // Settings
                protectedRoutes.get(
                    "/settings/cleanup",
                    SettingsController.getSettings,
                );
                protectedRoutes.put(
                    "/settings/cleanup",
                    SettingsController.updateSettings,
                );
                protectedRoutes.post(
                    "/settings/cleanup/invalid-tokens",
                    SettingsController.runInvalidTokenCleanup,
                );
                protectedRoutes.get(
                    "/settings/scheduler-status",
                    SettingsController.getSchedulerStatus,
                );
                protectedRoutes.post(
                    "/settings/cleanup/notifications",
                    SettingsController.runNotificationCleanup,
                );

                // Activity -- what happened on the hosts and in the control plane. The
                // dashboard still calls the page "Notifications"; the domain does not.
                protectedRoutes.get("/activity", ActivityController.list);
                protectedRoutes.post("/activity/seen-all", ActivityController.markAllSeen);
                protectedRoutes.post("/activity/:id/seen", ActivityController.markSeen);
                protectedRoutes.delete("/activity/:id", ActivityController.deleteOne);
                protectedRoutes.delete("/activity", ActivityController.deleteAll);
            });

            // Register Client (Public but API)
            v1.post("/register", TokenController.register);

            // "Is there a KASM server at this URL?" -- the agent asks this for an address an
            // operator has just typed. Not the same as /api/health, and the two must not be
            // merged: this one checks nothing on purpose, because a server with a broken
            // database is still reachable, and "no server here" would send the operator to
            // fix the wrong thing.
            v1.get("/ping", async (request, reply) => {
                return { status: "ok" };
            });
        },
        { prefix: "/v1" },
    );
}
