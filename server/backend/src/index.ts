import "dotenv/config";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import staticFiles from "@fastify/static";
import jwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import path from "path";
import { fileURLToPath } from "url";

import { initOIDC, appConfig, serverPort } from "./config/AppConfig.js";
import { AuthService } from "./services/AuthService.js";
import { NotificationCleanupService } from "./services/NotificationCleanupService.js";
import apiRoutes from "./routes/api.js";
import { SESSION_COOKIE } from "./services/SessionCookie.js";
import { WebSocketController, type AgentQuery } from "./controllers/WebSocketController.js";
import { ClientConnector } from "./services/ClientConnector.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { initDatabase } from "./core/Database.js";

// Initialize Database & Services
await initDatabase();
await initOIDC();
await AuthService.initializeAdmin(); // Ensure admin user
NotificationCleanupService.startScheduler();

import { loggerOptions } from "@kasm/shared/node";

const server = Fastify({
    // Trust Proxy is required for correct IP detection behind Traefik
    trustProxy: true,
    disableRequestLogging: true,
    logger: loggerOptions,
});

// Custom Logging Hooks
server.addHook("onRequest", async (req) => {
    req.log.debug({ req: req }, "incoming request");
});

server.addHook("onResponse", async (req, reply) => {
    if (reply.statusCode >= 500) {
        req.log.error(
            { res: reply, responseTime: reply.elapsedTime },
            "request errored",
        );
    } else if (reply.statusCode >= 400) {
        req.log.warn(
            { res: reply, responseTime: reply.elapsedTime },
            "request failed",
        );
    } else {
        req.log.debug(
            { res: reply, responseTime: reply.elapsedTime },
            "request completed",
        );
    }
});

// Plugins
// origin: false sends no CORS headers at all, because nothing here is ever a
// cross-origin request: in production this server serves the SPA itself from
// dist/public, and in development Vite proxies /api and /ws to this port, so the
// browser talks to its own origin either way. Registered without options it
// reflected whatever Origin a caller sent.
await server.register(cors, { origin: false });

// Registered without a global limit: the only route that needs one is the login, and a
// blanket limit would also count the dashboard's own polling and the agent handshakes,
// where a larger fleet legitimately produces bursts. Routes opt in via `config.rateLimit`.
// Clients are told apart by request.ip, which honours X-Forwarded-For because of
// trustProxy above -- see docs/install.md on running without a reverse proxy.
await server.register(rateLimit, { global: false });

/**
 * Security headers. Configured explicitly rather than taking helmet's defaults, because
 * two of those defaults are wrong for how this application is deployed.
 *
 * `script-src` is strict, which is where a CSP earns its keep: the built index.html
 * carries no inline script, and the bundle contains no eval or Function constructor.
 *
 * `style-src` deliberately allows inline. React's stylesheet resource handling
 * (`<style precedence>`) is present in the bundle, and whether the UI library ever
 * reaches it cannot be settled without a browser. A CSP that breaks styling costs more than strict
 * style-src buys — style injection is a far smaller problem than script injection, and
 * script-src is untouched by this.
 */
await server.register(helmet, {
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            // Google Fonts: index.html loads the Inter stylesheet from there.
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:"],
            // The dashboard WebSocket. Same origin, but ws:/wss: are separate schemes
            // to the CSP and 'self' alone does not cover them in every browser.
            connectSrc: ["'self'", "ws:", "wss:"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            // Deliberately absent: upgrade-insecure-requests. helmet sets it by default,
            // and on an installation served over plain HTTP it makes the browser rewrite
            // every asset request to https:// against a port that does not speak TLS.
        },
    },
    // Off unless the operator says otherwise — see security.hsts in config.example.yaml.
    // An HSTS header from an http:// installation locks the browser out of it for
    // months, and removing the header again does not undo that.
    hsts: appConfig.security.hsts
        ? { maxAge: 15552000, includeSubDomains: false }
        : false,
    // The SPA and its assets come from this same origin; the stricter isolation headers
    // would only complicate a reverse-proxy setup without protecting anything here.
    crossOriginEmbedderPolicy: false,
});

// Every token carries an expiry now; the branch that signed tokens without one is gone.
// maxAge on verify also retires the tokens issued before that change: they have no exp
// claim, but they do have iat, so they expire by age instead of staying valid forever.
// Defaulted to 12h by AppConfigSchema, so there is always a value.
const jwtExpiresIn = appConfig.jwtExpiresIn;
// Before @fastify/jwt, which reads the session out of the cookie parsed here.
await server.register(cookie);
await server.register(jwt, {
    secret: appConfig.jwtSecret,
    sign: { algorithm: "HS256", expiresIn: jwtExpiresIn },
    verify: { maxAge: jwtExpiresIn },
    // The dashboard sends its session as an httpOnly cookie (services/SessionCookie.ts).
    // The Authorization header keeps working next to it: that is how anything scripted
    // against this API authenticates.
    cookie: { cookieName: SESSION_COOKIE, signed: false },
});

await server.register(staticFiles, {
    root: path.join(__dirname, "../../dist/public"),
    prefix: "/",
});

await server.register(websocket);

// API Routes
server.register(apiRoutes, { prefix: "/api" });

// WebSocket Routes
server.register(async function (fastify) {
    fastify.get("/ws/dashboard", { websocket: true }, (socket, req) =>
        WebSocketController.handleDashboardConnection(socket, req, fastify),
    );
    // The query string is named on the route, so the controller reads token and clientId
    // off a typed request instead of digging them out of `any`.
    fastify.get<{ Querystring: AgentQuery }>(
        "/ws/agent",
        { websocket: true },
        (socket, req) =>
            WebSocketController.handleAgentConnection(socket, req, fastify),
    );
});

// Catch-all for SPA
server.setNotFoundHandler(async (request, reply) => {
    if (request.raw.url && request.raw.url.startsWith("/api")) {
        return reply.code(404).send({ error: "Endpoint not found" });
    }
    return reply.sendFile("index.html");
});

// Start
try {
    await server.listen({
        port: serverPort,
        host: "0.0.0.0",
    });
    await ClientConnector.connectAll();
} catch (err) {
    server.log.error(err);
    process.exit(1);
}

const shutdown = () => {
    server.log.info("Shutting down server...");
    NotificationCleanupService.stopScheduler();
    server.close(() => {
        process.exit(0);
    });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Registered only after listen() and the outbound connections succeeded, so a failed
// startup (migration, OIDC, port already taken) still fails fast instead of being
// swallowed here.

// A rejected promise must not take the control plane down: the schedulers run async
// jobs on their own timers, and one stray rejection there would drop every agent
// WebSocket and every dashboard session with it.
process.on("unhandledRejection", (reason) => {
    server.log.error({ err: reason }, "Unhandled promise rejection");
});

// An uncaught exception leaves the process in an unknown state. Log it and exit so
// the supervisor restarts us (compose.yaml: restart: unless-stopped).
process.on("uncaughtException", (err) => {
    server.log.fatal({ err }, "Uncaught exception, terminating");
    NotificationCleanupService.stopScheduler();
    // Give the pino transport worker a moment to flush before we go.
    setTimeout(() => process.exit(1), 250);
});
