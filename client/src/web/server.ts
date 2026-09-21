import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fastifyWebSocket, { type WebSocket } from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { config, readTlsMaterial } from "../core/Config.js";
import { getIdentity, setIdentity } from "../core/Identity.js";
import {
    consumeRegistrationSecret,
    getAgentMode,
    getRegistrationSecret,
    getServerUrl,
    setServerUrl,
} from "../core/RegistrationState.js";
import { Connection } from "../core/Connection.js";
import { KeepalivedService } from "../services/KeepalivedService.js";
import { NotifyFifoWatcher } from "../services/NotifyFifoWatcher.js";
import { isCertificateError, serverRequest } from "../core/ServerHttp.js";
import { logger } from "@kasm/shared/node";
import { initSetupPin, rotateSetupPin, verifySetupPin } from "../core/SetupPin.js";
import { secretEquals } from "../core/secrets.js";
import {
    WS_EVENTS,
    AgentWebRegisterSchema,
    RegistrationRequestSchema,
    firstIssue,
    isIpInCidr,
    isIpInNetworks,
} from "@kasm/shared";

/** The optional server URL the status endpoint may be asked to check instead of the configured one. */
type StatusQuery = { url?: string };

/** The identity the agent WebSocket route accepts in the query string. */
type AgentQuery = { token?: string; clientId?: string };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let fastifyInstance: FastifyInstance | null = null;

/**
 * What to tell the operator when a registration could not be stored, or null when both
 * halves are on disk. The identity and the server URL live in different files, and which of
 * them failed decides what has to be made writable.
 */
function registrationWarning(identityStored: boolean, urlStored: boolean): string | null {
    if (identityStored && urlStored) return null;
    const what = !identityStored
        ? "the identity in this agent's data directory"
        : "the server URL in this agent's config.yaml";
    return (
        `Registered, but ${what} could not be written. ` +
        "The agent is connected now and will come back unregistered after a restart -- " +
        "make the file writable and register again."
    );
}

/** Whether the request carries `Authorization: Bearer <expected>`. */
function hasBearerToken(request: FastifyRequest, expected: string): boolean {
    const match = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? "");
    return match !== null && secretEquals(match[1], expected);
}

/**
 * Which groups of routes this agent serves. Settled once at startup, from what the
 * configuration says the agent is for.
 *
 * - `statusPage` / `registerPage` -- the operator's two pages and the endpoints they call.
 * - `outbound` -- `/ws/register` and `/ws/agent`, the server dialling in. An agent without a
 *   server URL is outbound when it holds a registration secret *or* an identity: the secret is
 *   consumed by the registration, so a registered outbound agent has only its identity left,
 *   and still needs `/ws/agent`. A server URL means inbound, which needs no route here -- the
 *   agent dials out itself. Both set is inbound, as in `getAgentMode()`.
 * - `notify` -- `/api/keepalived/notify`, with `keepalived.notifyToken` set.
 * - `health` -- `/api/health`, for the container's HEALTHCHECK only.
 */
export interface WebRoutes {
    statusPage: boolean;
    registerPage: boolean;
    outbound: boolean;
    notify: boolean;
    health: boolean;
}

/**
 * Set by the client images. The health route exists for Docker's HEALTHCHECK, and an agent
 * installed on the host has nothing that would call it.
 */
function isRunningInContainer(): boolean {
    return process.env.KASM_CONTAINER === "true";
}

export function getWebRoutes(): WebRoutes {
    return {
        statusPage: config.enableStatusPage,
        registerPage: config.enableRegisterPage,
        outbound: !getServerUrl() && (getRegistrationSecret() !== null || getIdentity() !== null),
        notify: !!config.keepalived.notifyToken,
        health: isRunningInContainer(),
    };
}

/**
 * Whether a request comes from this machine -- or, in a container, from inside the
 * container's own network namespace, which is where Docker runs a HEALTHCHECK.
 *
 * The socket's peer rather than `request.ip`, although the two agree while this Fastify runs
 * without `trustProxy`: this check must never start trusting a forwarding header should that
 * change. `isIpInCidr` strips the IPv4-mapped prefix and reads every other IPv6 address as 0,
 * which lies outside 127.0.0.0/8 -- so `::1` is the one IPv6 address to name.
 */
function isLoopback(request: FastifyRequest): boolean {
    const ip = request.socket.remoteAddress ?? "";
    return ip === "::1" || isIpInCidr(ip, "127.0.0.0/8");
}

export async function startWebServer() {
    const routes = getWebRoutes();
    const pages = routes.statusPage || routes.registerPage;

    if (!pages && !routes.outbound && !routes.notify && !routes.health) {
        logger.info(
            "Web server not started: status page, register page and notify endpoint are disabled, and the agent is not in outbound mode.",
        );
        return;
    }

    // Two calls rather than one conditional options object: `https` is what picks Fastify's
    // server type, so a ternary inside the argument leaves it with no overload to match.
    // The certificate and key were validated in Config.ts, so material that is present
    // here is material that works. Without a tls block the server stays plain HTTP.
    const tls = readTlsMaterial();
    fastifyInstance = tls
        ? Fastify({ logger: false, https: { cert: tls.cert, key: tls.key } })
        : Fastify({ logger: false });
    const fastify = fastifyInstance;

    if (routes.outbound) {
        await fastify.register(fastifyWebSocket);
    }

    if (pages) {
        await registerPages(fastify, routes);
    }

    if (routes.notify) {
        registerNotify(fastify);
    }

    if (routes.health) {
        registerHealth(fastify);
    }

    if (routes.outbound) {
        registerOutbound(fastify);
    }

    // Without a page, the notify endpoint or the outbound routes nothing here is meant for
    // another machine, and the health route only answers loopback anyway -- so the socket
    // need not be reachable. The notify endpoint keeps 0.0.0.0: KASM_NOTIFY_URL may point
    // the script at this agent from elsewhere.
    const host = pages || routes.outbound || routes.notify ? "0.0.0.0" : "127.0.0.1";
    try {
        const port = config.listenPort;
        await fastify.listen({ port, host });
        logger.info(
            { ...routes },
            `Client Web UI listening on ${host}:${port} (${config.tls ? "https" : "http"})`,
        );
        // Logged after the "listening" line, where an operator is already looking.
        if (routes.registerPage) {
            initSetupPin(port);
        }
    } catch (err) {
        logger.error({ err: err }, "Failed to start Client Web UI server");
    }
}

/** The status and register pages, their static files and the endpoints they call. */
async function registerPages(fastify: FastifyInstance, routes: WebRoutes) {
    // Serve static assets (CSS, etc.)
    // We check multiple locations to handle both dev (src) and prod (dist)
    const possiblePaths = [
        path.join(__dirname, "public"),
        path.join(__dirname, "../src/web/public"),
        path.join(process.cwd(), "src/web/public"),
        path.join(process.cwd(), "dist/web/public"),
    ];

    let publicPath = "";
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            publicPath = p;
            break;
        }
    }

    // The static handler would otherwise serve a disabled page as /status.html or
    // /register.html, next to the route that was left out on purpose.
    const hiddenFiles = new Set<string>();
    if (!routes.statusPage) hiddenFiles.add("status.html");
    if (!routes.registerPage) hiddenFiles.add("register.html");

    if (publicPath) {
        logger.info(`Serving static files from ${publicPath}`);
        await fastify.register(fastifyStatic, {
            root: publicPath,
            prefix: "/",
            serve: true,
            allowedPath: (pathName) => !hiddenFiles.has(path.posix.basename(pathName)),
        });
    } else {
        logger.error("Could not find public directory for Client Web UI!");
        logger.debug("Tried paths: " + possiblePaths.join(", "));
    }

    // Redirect / to the first available page
    fastify.get("/", async (request: FastifyRequest, reply: FastifyReply) => {
        const registered = !!getIdentity();
        if (config.enableStatusPage && registered) return reply.redirect("/status");
        if (config.enableRegisterPage) return reply.redirect("/register");
        if (config.enableStatusPage) return reply.redirect("/status");
        return reply.code(404).send({ error: "No web UI available" });
    });

    const sendFileSafe = async (reply: FastifyReply, file: string) => {
        if (typeof reply.sendFile === "function") {
            return reply.sendFile(file);
        }

        logger.error(
            `reply.sendFile is not a function. Frontend files might be missing. Attempted to send: ${file}`,
        );
        return reply.status(500).send({
            error: "Internal Server Error",
            message:
                "Static file serving is not initialized. The 'public' directory might be missing in the distribution.",
            details: `Attempted to serve: ${file}`,
        });
    };

    // Serve status page
    if (config.enableStatusPage) {
        fastify.get(
            "/status",
            async (_request: FastifyRequest, reply: FastifyReply) => {
                return sendFileSafe(reply, "status.html");
            },
        );
    }

    // Serve registration page
    if (config.enableRegisterPage) {
        fastify.get(
            "/register",
            async (_request: FastifyRequest, reply: FastifyReply) => {
                return sendFileSafe(reply, "register.html");
            },
        );
    }

    // Check server reachability
    fastify.get(
        "/api/status/server",
        async (request: FastifyRequest, _reply: FastifyReply) => {
            const query = request.query as StatusQuery;
            const checkUrl = query.url || getServerUrl();
            let serverReachable = false;

            if (checkUrl) {
                try {
                    // Always tolerant: the answer is only "is there a KASM server at this URL",
                    // nothing is sent and nothing is trusted from the reply.
                    const checkRes = await serverRequest(`${checkUrl}/api/v1/ping`, {
                        timeoutMs: 2000,
                        allowSelfSigned: true,
                    });
                    if (checkRes.ok) {
                        serverReachable = true;
                    }
                } catch {
                    // Server not reachable
                }
            }

            return {
                serverUrl: checkUrl || null,
                serverReachable,
            };
        },
    );

    // Check auth token existence
    fastify.get(
        "/api/status/auth",
        async (_request: FastifyRequest, _reply: FastifyReply) => {
            return {
                hasAuthToken: !!getIdentity(),
            };
        },
    );

    if (routes.statusPage) registerStatusApi(fastify);

    // API for registering this agent with the server (`inbound` mode: the agent dials in).
    // Registered only together with the register page:
    // with the page disabled there is no legitimate caller, and the endpoint decides which
    // server this agent obeys.
    if (config.enableRegisterPage) {
        fastify.post(
            "/api/register",
            async (request: FastifyRequest, reply: FastifyReply) => {
                // firstIssue names the field, so the caller does not have to guess which of the
                // three it was.
                const parsed = AgentWebRegisterSchema.safeParse(request.body ?? {});
                if (!parsed.success) {
                    return reply.status(400).send({ error: firstIssue(parsed.error) });
                }
                const { token, url, pin } = parsed.data;

                // Checked before the server is contacted, so a caller without the PIN cannot make
                // this agent send requests anywhere.
                if (!verifySetupPin(pin)) {
                    logger.warn(
                        { ip: request.ip },
                        "Registration denied: wrong setup PIN",
                    );
                    return reply.status(403).send({
                        error: "Wrong setup PIN. The current PIN is printed in this agent's log.",
                    });
                }

                logger.info(`Web UI Registration requested with ${url}...`);

                try {
                    // The registration token goes out and the auth token comes back, so the
                    // certificate is checked unless the operator decided otherwise.
                    const response = await serverRequest(`${url}/api/v1/register`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        // No clientId: the server issues it and returns it below.
                        body: JSON.stringify({
                            token,
                            hostname: os.hostname(),
                        }),
                        allowSelfSigned: config.allowSelfSignedCertificates,
                    });

                    if (!response.ok) {
                        let errorMsg = response.text;
                        try {
                            const errorJson = JSON.parse(response.text);
                            if (errorJson.error) errorMsg = errorJson.error;
                        } catch {
                            // Response is not JSON, use raw text
                        }
                        return reply.status(400).send({ error: errorMsg });
                    }

                    const data = JSON.parse(response.text);

                    if (data.token && data.clientId) {
                        // Both are stored before anything else is reported: the server has
                        // registered this agent either way, so what is still open is only
                        // whether the agent will still know it after a restart.
                        const identityStored = setIdentity(data.clientId, data.token);
                        const urlStored = setServerUrl(url);
                        logger.info(
                            { clientId: data.clientId },
                            "Web Registration successful! Identity received.",
                        );
                        // Each PIN registers once; a later re-registration needs the next one.
                        rotateSetupPin();
                        // Connect straight away rather than when the status page next asks:
                        // a registration made through the API has no page to do that.
                        void Connection.connect();

                        // Reported rather than logged: the registration worked and the agent
                        // is connecting, but it would come back unregistered. Whoever is
                        // standing in front of the register page is the one who can fix it,
                        // and they are not reading the log.
                        const warning = registrationWarning(identityStored, urlStored);
                        if (warning) logger.error(warning);

                        return {
                            success: true,
                            message: "Registration successful",
                            ...(warning ? { warning } : {}),
                        };
                    } else {
                        return reply.status(500).send({
                            error: "Registration failed: The server did not return a token and client id.",
                        });
                    }
                } catch (e: unknown) {
                    logger.error({ err: e }, "Web registration error:");
                    if (isCertificateError(e)) {
                        return reply.status(502).send({
                            error:
                                `The server's certificate could not be verified (${(e as Error).message}). ` +
                                "If it is self-signed on purpose, set allowSelfSignedCertificates: true in this agent's config.yaml and restart it.",
                        });
                    }
                    return reply.status(500).send({
                        error:
                            (e instanceof Error ? e.message : String(e)) ||
                            "Unknown error occurred during registration",
                    });
                }
            },
        );
    }
}

/** The endpoints only the status page calls. */
function registerStatusApi(fastify: FastifyInstance) {
    // Check current connection status
    fastify.get(
        "/api/status/connection",
        async (_request: FastifyRequest, _reply: FastifyReply) => {
            return {
                connected: Connection.isConnected(),
            };
        },
    );

    // Return config-derived mode info for the status page
    fastify.get(
        "/api/status/config",
        async (_request: FastifyRequest, _reply: FastifyReply) => {
            return {
                hasRegistrationSecret: !!getRegistrationSecret(),
                hasAuthToken: !!getIdentity(),
                hasServerUrl: !!getServerUrl(),
            };
        },
    );

    /**
     * What the agent last read out of keepalived, for the status page. Only the summary:
     * the page is not behind a login, and the instance list is the server's to show.
     */
    fastify.get("/api/status/keepalived", async () => {
        const status = KeepalivedService.latest();
        // What makes the agent read keepalived, so an operator can see a FIFO that is set
        // but not found without going through the log.
        const triggers = {
            poll: config.keepalived.pollInterval,
            fifo: NotifyFifoWatcher.state(),
            endpoint: !!config.keepalived.notifyToken,
        };
        if (!status) return { collected: false, triggers };
        return {
            collected: true,
            triggers,
            running: status.running,
            version: status.version ?? null,
            error: status.error ?? null,
            instances: status.instances.length,
            master: status.instances.filter((instance) => instance.state === "MASTER").length,
            collectedAt: status.collectedAt,
        };
    });

    // Attempt to establish connection
    fastify.post(
        "/api/connect",
        async (_request: FastifyRequest, _reply: FastifyReply) => {
            const result = await Connection.connect();
            return {
                connected: result.connected,
                error: result.error,
            };
        },
    );
}

function registerHealth(fastify: FastifyInstance) {
    /**
     * Liveness for the container's HEALTHCHECK, and for nothing else: registered only in the
     * container image, and answering only loopback, which is where Docker runs the check.
     * Everyone else gets the 404 an absent route would give.
     *
     * The server connection is deliberately not consulted -- that question has its own
     * endpoint, `/api/status/connection`. An agent that cannot reach the server is still
     * running and keeps reading keepalived; reporting it unhealthy would turn a network
     * problem into "agent broken". keepalived itself is not probed either: a stopped
     * keepalived is something the agent reports, not a fault of the agent.
     */
    fastify.get("/api/health", async (request: FastifyRequest, reply: FastifyReply) => {
        if (!isLoopback(request)) {
            return reply.callNotFound();
        }
        return { status: "ok" };
    });
}

function registerNotify(fastify: FastifyInstance) {
    /**
     * Called by a keepalived notify script (`curl`, see client/scripts/kasm-notify.sh) when an
     * instance or sync group changes state. It only triggers a reading: the body -- the
     * arguments keepalived passed the script -- goes to the debug log and nowhere else.
     *
     * Registered only with keepalived.notifyToken set, and guarded by that token rather than
     * by allowedNetworks: the caller is keepalived on this host, not the server. Answers
     * before the reading is taken, so the script never holds keepalived up.
     */
    const notifyToken = config.keepalived.notifyToken;
    if (notifyToken) {
        fastify.post(
            "/api/keepalived/notify",
            { bodyLimit: 1024 },
            async (request: FastifyRequest, reply: FastifyReply) => {
                if (!hasBearerToken(request, notifyToken)) {
                    logger.warn({ ip: request.ip }, "keepalived notify rejected: invalid token");
                    return reply.code(401).send({ error: "Unauthorized" });
                }
                logger.debug({ notify: request.body ?? null }, "keepalived notify endpoint");
                KeepalivedService.trigger("endpoint");
                return reply.code(202).send({ status: "triggered" });
            },
        );
    }
}

function registerOutbound(fastify: FastifyInstance) {
    /**
     * The two routes below are how the server reaches this agent, and they listen on every
     * interface. /ws/register in particular takes the auth token the agent then stores from
     * the caller, so who may knock at all is worth deciding. Without a list nothing changes.
     *
     * The reason is logged, not sent: the caller learns that it was refused, not why.
     * `req.ip` is the socket peer -- this Fastify has no trustProxy, so no forwarding header
     * gets past the list. Behind a reverse proxy the proxy's address is what is checked.
     */
    const isFromAllowedNetwork = (req: FastifyRequest): boolean =>
        isIpInNetworks(req.ip, config.allowedNetworks, true);

    // Outbound mode: the server connects here to register the client.
    // Only active when no authToken exists yet and a registrationSecret is configured.
    fastify.get(
        "/ws/register",
        { websocket: true },
        (socket: WebSocket, req: FastifyRequest) => {
            if (!isFromAllowedNetwork(req)) {
                logger.warn(
                    { ip: req.ip },
                    "Registration connection denied: not in allowedNetworks",
                );
                socket.close(4003, "Access denied");
                return;
            }
            if (getIdentity()) {
                socket.close(4003, "Already registered");
                return;
            }

            if (!getRegistrationSecret()) {
                socket.close(4003, "No registration secret configured");
                return;
            }

            logger.info("Registration connection received from the server (outbound mode)");

            const timeout = setTimeout(() => {
                if (socket.readyState === socket.OPEN) {
                    socket.close(4001, "Registration timed out");
                }
            }, 10000);

            socket.on("message", (data: Buffer) => {
                try {
                    const message = JSON.parse(data.toString());

                    if (message.type === WS_EVENTS.REGISTRATION_REQUEST) {
                        // The authToken in here is stored permanently, so the shape is
                        // checked before the secret is even compared.
                        const parsed = RegistrationRequestSchema.safeParse(message.payload);
                        if (!parsed.success) {
                            clearTimeout(timeout);
                            logger.warn(
                                { issues: parsed.error.issues },
                                "Registration rejected: malformed request",
                            );
                            socket.send(JSON.stringify({
                                type: WS_EVENTS.REGISTRATION_FAILURE,
                                payload: { error: `Invalid request: ${firstIssue(parsed.error)}` },
                            }));
                            socket.close(4000, "Protocol error");
                            return;
                        }
                        const { secret, authToken, clientId } = parsed.data;

                        if (!secretEquals(secret, getRegistrationSecret())) {
                            clearTimeout(timeout);
                            logger.warn("Registration rejected: secret mismatch");
                            socket.send(JSON.stringify({
                                type: WS_EVENTS.REGISTRATION_FAILURE,
                                payload: { error: "Secret mismatch" },
                            }));
                            socket.close(4003, "Invalid secret");
                            return;
                        }

                        const identityStored = setIdentity(clientId, authToken);
                        consumeRegistrationSecret();
                        clearTimeout(timeout);

                        // Logged, not sent back: the caller here is the server, which has
                        // registered this client either way. What a failed write costs is the
                        // next restart, and that is an operator's problem on this host.
                        if (!identityStored) {
                            logger.error(
                                "Registered, but the identity could not be written to the data directory -- " +
                                    "this agent will come back unregistered after a restart.",
                            );
                        }
                        logger.info({ clientId }, "Registration successful, identity stored");
                        socket.send(JSON.stringify({
                            type: WS_EVENTS.REGISTRATION_SUCCESS,
                            payload: { hostname: os.hostname() },
                        }));
                        socket.close(1000, "Registration complete");
                    }
                } catch (err) {
                    clearTimeout(timeout);
                    logger.error({ err }, "Error during registration handshake");
                    socket.close(4000, "Protocol error");
                }
            });

            socket.on("close", () => {
                clearTimeout(timeout);
            });
        },
    );

    // Outbound mode: the server connects here for the regular agent session and
    // authenticates via the token query param.
    fastify.get(
        "/ws/agent",
        { websocket: true },
        (socket: WebSocket, req: FastifyRequest) => {
            if (!isFromAllowedNetwork(req)) {
                logger.warn(
                    { ip: req.ip },
                    "Agent connection denied: not in allowedNetworks",
                );
                socket.close(4003, "Access denied");
                return;
            }

            // The routes are settled at startup, the mode is not: an agent started for
            // outbound can still be registered inbound through its register page, and from
            // then on it dials the server itself.
            if (getAgentMode() !== "outbound") {
                logger.warn("Agent connection from the server rejected: not in outbound mode");
                socket.close(4003, "Not in outbound mode");
                return;
            }

            const { token, clientId } = (req.query as AgentQuery) ?? {};
            const identity = getIdentity();

            if (!secretEquals(token, identity?.authToken)) {
                logger.warn("Agent connection from the server rejected: invalid token");
                socket.close(4001, "Unauthorized");
                return;
            }

            // The id is checked as well as the token: the server has to be dialling the
            // client it thinks it is, or a target address pointed at the wrong host would
            // report that host's keepalived under somebody else's name.
            if (!clientId || clientId !== identity?.clientId) {
                logger.warn(
                    { presented: clientId },
                    "Agent connection from the server rejected: client id mismatch",
                );
                socket.close(4001, "Unauthorized");
                return;
            }

            logger.info("Agent connection from the server accepted");
            Connection.handleIncoming(socket);
        },
    );
}


export async function stopWebServer() {
    if (fastifyInstance) {
        logger.info("Shutting down Client Web UI...");
        try {
            await fastifyInstance.close();
            logger.info("Client Web UI shut down gracefully.");
        } catch (err) {
            logger.error({ err: err }, "Error shutting down Client Web UI");
        }
    }
}
