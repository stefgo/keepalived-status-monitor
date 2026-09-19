import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { config, persistIdentity, persistServerUrl, deleteRegistrationSecret } from "../core/Config.js";
import { Connection } from "../core/Connection.js";
import { KeepalivedService } from "../services/KeepalivedService.js";
import { isCertificateError, serverRequest } from "../core/ServerHttp.js";
import { logger } from "@kasm/shared/node";
import { initSetupPin, rotateSetupPin, verifySetupPin } from "../core/SetupPin.js";
import {
    WS_EVENTS,
    AgentWebRegisterSchema,
    RegistrationRequestSchema,
    firstIssue,
    isIpInNetworks,
} from "@kasm/shared";

/** The optional server URL the status endpoint may be asked to check instead of the configured one. */
type StatusQuery = { url?: string };

/** The identity the agent WebSocket route accepts in the query string. */
type AgentQuery = { token?: string; clientId?: string };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let fastifyInstance: any = null;

/**
 * Returns true when the web server is needed:
 * - status or register page enabled, OR
 * - `outbound` mode is applicable, so the server has to be able to dial this agent
 *   (registrationSecret set, or authToken present without serverUrl)
 *
 * The mode names are the server's: `outbound` is the server dialling out to this agent.
 */
export function isWebServerNeeded(): boolean {
    if (config.enableStatusPage !== false) return true;
    if (config.enableRegisterPage !== false) return true;
    if (config.registrationSecret) return true;
    if (config.authToken && !config.serverUrl) return true;
    return false;
}

export async function startWebServer() {
    fastifyInstance = Fastify({ logger: false });
    const fastify = fastifyInstance;

    await fastify.register(fastifyWebSocket);

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

    if (publicPath) {
        logger.info(`Serving static files from ${publicPath}`);
        await fastify.register(fastifyStatic, {
            root: publicPath,
            prefix: "/",
            serve: true,
        });
    } else {
        logger.error("Could not find public directory for Client Web UI!");
        logger.debug("Tried paths: " + possiblePaths.join(", "));
    }

    // Redirect / to the first available page
    fastify.get("/", async (request: FastifyRequest, reply: FastifyReply) => {
        const hasToken = !!config.authToken?.trim();
        if (config.enableStatusPage !== false && hasToken) return reply.redirect("/status");
        if (config.enableRegisterPage !== false) return reply.redirect("/register");
        if (config.enableStatusPage !== false) return reply.redirect("/status");
        return reply.code(404).send({ error: "No web UI available" });
    });

    const sendFileSafe = async (reply: FastifyReply, file: string) => {
        if (typeof (reply as any).sendFile === "function") {
            return (reply as any).sendFile(file);
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
    if (config.enableStatusPage !== false) {
        fastify.get(
            "/status",
            async (_request: FastifyRequest, reply: FastifyReply) => {
                return sendFileSafe(reply, "status.html");
            },
        );
    }

    // Serve registration page
    if (config.enableRegisterPage !== false) {
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
        async (request: FastifyRequest, reply: FastifyReply) => {
            const query = request.query as StatusQuery;
            const checkUrl = query.url || config.serverUrl;
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
                } catch (e) {
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
        async (request: FastifyRequest, reply: FastifyReply) => {
            return {
                hasAuthToken:
                    !!config.authToken && config.authToken.trim().length > 0,
            };
        },
    );

    // Check current connection status
    fastify.get(
        "/api/status/connection",
        async (request: FastifyRequest, reply: FastifyReply) => {
            return {
                connected: Connection.isConnected(),
            };
        },
    );

    // Return config-derived mode info for the status page
    fastify.get(
        "/api/status/config",
        async (request: FastifyRequest, reply: FastifyReply) => {
            return {
                hasRegistrationSecret: !!config.registrationSecret,
                hasAuthToken: !!config.authToken && config.authToken.trim().length > 0,
                hasServerUrl: !!config.serverUrl && config.serverUrl.trim().length > 0,
            };
        },
    );

    /**
     * What the agent last read out of keepalived, for the status page. Only the summary:
     * the page is not behind a login, and the instance list is the server's to show.
     */
    fastify.get("/api/status/keepalived", async () => {
        const status = KeepalivedService.latest();
        if (!status) return { collected: false };
        return {
            collected: true,
            running: status.running,
            version: status.version ?? null,
            error: status.error ?? null,
            instances: status.instances.length,
            master: status.instances.filter((instance) => instance.state === "MASTER").length,
            collectedAt: status.collectedAt,
        };
    });

    /**
     * Liveness for the container's HEALTHCHECK and for monitoring: the process answers.
     *
     * The server connection is deliberately not consulted -- that question has its own
     * endpoint above. An agent that cannot reach the server is still running and keeps
     * reading keepalived; reporting it unhealthy would turn a network problem into "agent
     * broken". keepalived itself is not probed either: a stopped keepalived is something the
     * agent reports, not a fault of the agent.
     */
    fastify.get("/api/health", async () => ({ status: "ok" }));

    // Attempt to establish connection
    fastify.post(
        "/api/connect",
        async (request: FastifyRequest, reply: FastifyReply) => {
            const result = await Connection.connect();
            return {
                connected: result.connected,
                error: result.error,
            };
        },
    );

    // API for registering this agent with the server (`inbound` mode: the agent dials in).
    // Registered only together with the register page:
    // with the page disabled there is no legitimate caller, and the endpoint decides which
    // server this agent obeys.
    if (config.enableRegisterPage !== false) {
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
                        persistIdentity(data.token, data.clientId);
                        persistServerUrl(url);
                        logger.info(
                            { clientId: data.clientId },
                            "Web Registration successful! Identity received.",
                        );
                        // Each PIN registers once; a later re-registration needs the next one.
                        rotateSetupPin();
                        // Connect straight away rather than when the status page next asks:
                        // a registration made through the API has no page to do that.
                        void Connection.connect();

                        return {
                            success: true,
                            message: "Registration successful",
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
        (socket: any, req: FastifyRequest) => {
            if (!isFromAllowedNetwork(req)) {
                logger.warn(
                    { ip: req.ip },
                    "Registration connection denied: not in allowedNetworks",
                );
                socket.close(4003, "Access denied");
                return;
            }
            if (config.authToken) {
                socket.close(4003, "Already registered");
                return;
            }

            if (!config.registrationSecret) {
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

                        if (secret !== config.registrationSecret) {
                            clearTimeout(timeout);
                            logger.warn("Registration rejected: secret mismatch");
                            socket.send(JSON.stringify({
                                type: WS_EVENTS.REGISTRATION_FAILURE,
                                payload: { error: "Secret mismatch" },
                            }));
                            socket.close(4003, "Invalid secret");
                            return;
                        }

                        persistIdentity(authToken, clientId);
                        deleteRegistrationSecret();
                        clearTimeout(timeout);

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

    // Outbound mode: the server connects here for the regular agent session.
    // Always active — server authenticates via token query param.
    fastify.get(
        "/ws/agent",
        { websocket: true },
        (socket: any, req: FastifyRequest) => {
            if (!isFromAllowedNetwork(req)) {
                logger.warn(
                    { ip: req.ip },
                    "Agent connection denied: not in allowedNetworks",
                );
                socket.close(4003, "Access denied");
                return;
            }

            const { token, clientId } = (req.query as AgentQuery) ?? {};

            if (!token || !config.authToken || token !== config.authToken) {
                logger.warn("Agent connection from the server rejected: invalid token");
                socket.close(4001, "Unauthorized");
                return;
            }

            // The id is checked as well as the token: the server has to be dialling the
            // client it thinks it is, or a target address pointed at the wrong host would
            // report that host's keepalived under somebody else's name.
            if (!clientId || clientId !== config.clientId) {
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

    try {
        const port = config.listenPort;
        await fastify.listen({ port, host: "0.0.0.0" });
        logger.info(`Client Web UI listening on port ${port}`);
        // Logged after the "listening" line, where an operator is already looking.
        if (config.enableRegisterPage !== false) {
            initSetupPin(port);
        }
    } catch (err) {
        logger.error({ err: err }, "Failed to start Client Web UI server");
    }
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
