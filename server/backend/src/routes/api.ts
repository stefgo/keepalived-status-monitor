import { FastifyInstance } from "fastify";
import { AuthController } from "../controllers/AuthController.js";
import { UserController } from "../controllers/UserController.js";
import { ClientController } from "../controllers/ClientController.js";
import { SettingsController } from "../controllers/SettingsController.js";
import { KeepalivedController } from "../controllers/KeepalivedController.js";
import { ActivityController } from "../controllers/ActivityController.js";
import { WebhookController } from "../controllers/WebhookController.js";
import { HealthRepository } from "../repositories/HealthRepository.js";
import { AuthService } from "../services/AuthService.js";
import { sessionHook, statusAuthHook } from "../services/statusAuth.js";
import { StatusController } from "../controllers/StatusController.js";
import { statusToken } from "../config/AppConfig.js";

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
            HealthRepository.check();
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
                // A valid signature is not enough: the user may have been deleted or had their
                // password changed since the token was signed.
                protectedRoutes.addHook("onRequest", sessionHook((payload) => AuthService.isSessionCurrent(payload)));

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
                protectedRoutes.post("/clients/inbound", ClientController.createInbound);
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
                protectedRoutes.post(
                    "/clients/:clientId/registration-token",
                    ClientController.issueRegistrationToken,
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
                protectedRoutes.get(
                    "/settings/scheduler-status",
                    SettingsController.getSchedulerStatus,
                );
                protectedRoutes.post(
                    "/settings/cleanup/notifications",
                    SettingsController.runNotificationCleanup,
                );

                // Activity -- what happened on the hosts and in the control plane.
                protectedRoutes.get("/activity", ActivityController.list);
                protectedRoutes.post("/activity/seen", ActivityController.markManySeen);
                protectedRoutes.delete("/activity", ActivityController.deleteAll);

                // Webhooks -- where events are reported to outside of the dashboard.
                protectedRoutes.get("/webhooks", WebhookController.list);
                protectedRoutes.post("/webhooks", WebhookController.create);
                // Registered before /webhooks/:webhookId, which it would otherwise look like.
                protectedRoutes.post("/webhooks/test", WebhookController.test);
                protectedRoutes.put("/webhooks/:webhookId", WebhookController.update);
                protectedRoutes.delete("/webhooks/:webhookId", WebhookController.delete);
            });

            // Register Client (Public but API)
            v1.post("/register", ClientController.register);

            // "Is there a KASM server at this URL?" -- the agent's status and register pages
            // ask this of its configured server. Not the same as /api/health, and the two must not be
            // merged: this one checks nothing on purpose, because a server with a broken
            // database is still reachable, and "no server here" would send the operator to
            // fix the wrong thing.
            v1.get("/ping", async () => {
                return { status: "ok" };
            });

            // The dashboard's verdict and findings, for a reader that is not a browser. Outside
            // the protected routes because it takes the status token as well as a session --
            // and only this route does: the token is worth nothing anywhere else.
            v1.get(
                "/status",
                {
                    onRequest: statusAuthHook(statusToken, sessionHook((payload) => AuthService.isSessionCurrent(payload))),
                    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
                },
                StatusController.get,
            );
        },
        { prefix: "/v1" },
    );
}
