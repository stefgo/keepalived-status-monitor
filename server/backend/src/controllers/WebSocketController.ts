import { FastifyInstance, FastifyRequest } from "fastify";
import { WebSocket } from "ws";
import {
    WS_EVENTS,
    WsMessage,
    AuthPayloadSchema,
    CONNECTION_MODE,
    isIpAllowed,
    isIpInNetworks,
} from "@kasm/shared";
import { ProxyService } from "../services/ProxyService.js";
import { KeepalivedStateService } from "../services/KeepalivedStateService.js";
import { ActivityService } from "../services/ActivityService.js";
import { appConfig } from "../config/AppConfig.js";

import { ClientRepository } from "../repositories/ClientRepository.js";
import { logger } from "@kasm/shared/node";
import { attachHeartbeat } from "./websocket/Heartbeat.js";
import { routeAgentMessage } from "./websocket/AgentMessageRouter.js";
import { SESSION_COOKIE } from "../services/SessionCookie.js";

/** The identity the agent route accepts in its query string. */
export type AgentQuery = { token?: string; clientId?: string };

/** The agent route's request, with its query string named rather than read out of `any`. */
type AgentRequest = FastifyRequest<{ Querystring: AgentQuery }>;

/**
 * The name a connection event is shown under. Stored with the event, so the line still names
 * the host after it has been renamed or removed.
 */
function clientName(clientId: string): string {
    const client = ClientRepository.findById(clientId);
    return client?.display_name || client?.hostname || clientId;
}

export class WebSocketController {
    static async handleDashboardConnection(
        socket: WebSocket,
        req: FastifyRequest,
        fastify: FastifyInstance,
    ) {
        // Attached before the auth checks below: those close the socket and return early,
        // and attachHeartbeat registers the close handler that clears the interval. The
        // interval used to be cleared only by the handler at the end of this method, so
        // every rejected connection left a ping timer running forever.
        attachHeartbeat(socket);

        // Read from the session cookie, which the browser attaches to the handshake by itself.
        // It used to arrive as ?token=<JWT>: the browser WebSocket API cannot set headers, so
        // the query string was the only place for it -- and from there it went into every
        // proxy and server access log along the way.
        const token: string | undefined = req.cookies?.[SESSION_COOKIE];
        if (!token) {
            socket.close(4001, "Unauthorized");
            return;
        }

        try {
            fastify.jwt.verify(token);
        } catch {
            socket.close(4001, "Invalid Token");
            return;
        }

        ProxyService.addDashboardClient(socket);

        // Send initial state
        const clients = ProxyService.getClientsWithStatus();
        socket.send(
            JSON.stringify({ type: WS_EVENTS.CLIENTS_UPDATE, payload: clients }),
        );

        // The last keepalived reading of every known client, offline ones included: what a
        // host last reported is still worth showing, marked as such by its status.
        for (const state of KeepalivedStateService.getAll()) {
            socket.send(
                JSON.stringify({
                    type: WS_EVENTS.KEEPALIVED_STATE_UPDATE,
                    payload: state,
                }),
            );
        }

        // Send the initial activity list
        socket.send(JSON.stringify({
            type: WS_EVENTS.ACTIVITY_UPDATE,
            payload: ActivityService.list(),
        }));

        socket.on("close", () => {
            ProxyService.removeDashboardClient(socket);
        });
    }

    /**
     * Handles a server-initiated (outbound) WebSocket connection to an inbound client.
     * The client sends AUTH after the connection is established; the server responds
     * with AUTH_SUCCESS and then routes all further messages normally.
     *
     * @param clientId - The client's UUID (already known from DB)
     * @param socket   - The already-open WebSocket socket
     * @param onClose  - Called when the connection closes (e.g. to schedule reconnect)
     */
    static handleOutboundAgentConnection(
        clientId: string,
        socket: WebSocket,
        onClose: () => void,
        onAuthResult?: (success: boolean) => void,
        onPersist?: (version: string | null) => void,
    ): void {
        logger.info({ clientId }, "ClientConnector: outbound agent connection established, awaiting AUTH");

        attachHeartbeat(socket);

        let isAuthenticated = false;

        // Ensures onAuthResult is called exactly once regardless of failure mode.
        let authResultSent = false;
        const notifyAuthResult = (success: boolean) => {
            if (!authResultSent) {
                authResultSent = true;
                onAuthResult?.(success);
            }
        };

        const authTimeout = setTimeout(() => {
            if (!isAuthenticated) {
                logger.warn({ clientId }, "Outbound agent authentication timed out");
                notifyAuthResult(false);
                socket.close(4001, "Authentication timed out");
            }
        }, 5000);

        socket.on("message", (message: Buffer) => {
            try {
                const data = JSON.parse(message.toString()) as WsMessage;

                if (!isAuthenticated) {
                    if (data.type === WS_EVENTS.AUTH) {
                        const parsed = AuthPayloadSchema.safeParse(data.payload);
                        if (!parsed.success) {
                            notifyAuthResult(false);
                            socket.close(4000, "Invalid payload");
                            return;
                        }

                        isAuthenticated = true;
                        clearTimeout(authTimeout);

                        const version = parsed.data.version || null;

                        // onPersist creates the DB entry for new clients (first-time connection).
                        // For reconnects the entry already exists; updateAuthSuccess updates it.
                        // No address to record: the server dialled this agent, so the only
                        // address involved is the one it was dialled at, already stored as
                        // outbound_target_address.
                        onPersist?.(version);
                        ClientRepository.updateAuthSuccess(clientId, version, null);

                        logger.info({ clientId }, "Outbound agent authenticated");
                        ProxyService.registerClient(clientId, socket, parsed.data.capabilities);
                        ActivityService.record({
                            kind: "client.connected",
                            level: "trace",
                            clientId,
                            data: {
                                connectionMode: CONNECTION_MODE.OUTBOUND,
                                version,
                                clientName: clientName(clientId),
                            },
                        });
                        notifyAuthResult(true);

                        socket.send(JSON.stringify({
                            type: WS_EVENTS.AUTH_SUCCESS,
                            payload: { lastSyncTime: null },
                        }));
                        ProxyService.broadcastClientUpdate();

                        socket.on("close", () => {
                            ClientRepository.updateLastSeen(clientId);
                            ProxyService.unregisterClient(clientId, socket);
                            logger.info({ clientId }, "Outbound agent disconnected");
                            ActivityService.record({
                                kind: "client.disconnected",
                                level: "trace",
                                clientId,
                                data: {
                                    connectionMode: CONNECTION_MODE.OUTBOUND,
                                    clientName: clientName(clientId),
                                },
                            });
                            ProxyService.broadcastClientUpdate();
                            onClose();
                        });
                    } else {
                        notifyAuthResult(false);
                        socket.close(4003, "Forbidden");
                    }
                    return;
                }

                routeAgentMessage(clientId, data);
            } catch (err) {
                logger.error({ msg: "Error processing outbound agent message", err });
            }
        });

        socket.on("error", (err) => {
            logger.error({ clientId, err: err.message }, "Outbound agent socket error");
            socket.close();
        });

        // Covers all remaining failure paths: socket closed before AUTH completed,
        // or after an error — notifyAuthResult is a no-op if already called.
        socket.on("close", () => {
            // The heartbeat clears itself — attachHeartbeat registers its own close
            // handler for exactly that.
            clearTimeout(authTimeout);
            notifyAuthResult(false);
        });
    }

    static async handleAgentConnection(
        socket: WebSocket,
        req: AgentRequest,
        fastify: FastifyInstance,
    ) {
        // Correctly handle IP address with trustProxy (configured in Fastify)
        const clientIp = req.ip;
        fastify.log.info({ msg: "Client connected", ip: clientIp });

        attachHeartbeat(socket, () =>
            fastify.log.warn({
                msg: "Agent client connection timed out (no pong). Terminating.",
                ip: clientIp,
                clientId,
            }),
        );
        let isAuthenticated = false;
        let clientId: string | null = null;

        // AUTHENTICATION LOGIC (Identity + IP)
        // 1. Extract the identity: query params first, then Authorization header for the
        // token. WebSocket connections from a browser usually use query params ?token=...,
        // agents might use headers.
        const query = req.query;
        let token = query.token;
        if (!token && req.headers["authorization"]) {
            const parts = req.headers["authorization"].split(" ");
            if (parts.length === 2 && parts[0] === "Bearer") {
                token = parts[1];
            }
        }
        const presentedId = query.clientId;

        if (!token || !presentedId) {
            fastify.log.warn({
                msg: "Client connected without a complete identity",
                ip: clientIp,
            });
            socket.close(4001, "Authentication required");
            return;
        }

        // Both halves have to name the same row.
        const client = ClientRepository.findByIdAndToken(presentedId, token);

        if (!client) {
            fastify.log.warn({
                msg: "Invalid credentials used",
                ip: clientIp,
                clientId: presentedId,
            });
            socket.close(4003, "Invalid credentials");
            return;
        }

        // Global Security Check: Allowed Networks
        const allowedNetworks = appConfig.security.allowed_networks;
        if (!isIpInNetworks(clientIp, allowedNetworks, true)) {
            fastify.log.warn({
                msg: "Connection denied: IP not in allowed networks",
                ip: clientIp,
            });
            socket.close(4003, "Access denied");
            return;
        }

        // An outbound client is dialled by the server and never connects here. Refused
        // explicitly: its auth token has no allowed address, and with null meaning "check
        // switched off" that token would otherwise be accepted from anywhere.
        if (client.connection_mode === CONNECTION_MODE.OUTBOUND) {
            fastify.log.warn({
                msg: "Outbound client tried to connect inbound",
                ip: clientIp,
                clientId: client.id,
            });
            socket.close(4003, "Access denied");
            return;
        }

        // Per-client address check. trusted_networks used to skip it for listed networks,
        // which meant the stored value was checked or not depending on a setting elsewhere;
        // it is gone, and a client whose address changes is edited or unrestricted instead.
        if (!isIpAllowed(clientIp, client.inbound_allowed_ip)) {
            fastify.log.warn({
                msg: "IP mismatch for client",
                expected: client.inbound_allowed_ip,
                actual: clientIp,
                clientId: client.id,
            });
            socket.close(4003, "IP address mismatch");
            return;
        }

        // The agent must send { type: 'AUTH' } as its first message to confirm readiness.
        // We enforce a 5-second timeout to prevent zombie connections.

        const authTimeout = setTimeout(() => {
            if (!isAuthenticated && socket.readyState === socket.OPEN) {
                fastify.log.warn({
                    msg: "Client authentication timed out",
                    ip: clientIp,
                });
                socket.close(4001, "Authentication timed out");
            }
        }, 5000);

        socket.on("message", (message: Buffer) => {
            try {
                const data = JSON.parse(message.toString()) as WsMessage;

                if (!isAuthenticated) {
                    if (data.type === WS_EVENTS.AUTH) {
                        const parsed = AuthPayloadSchema.safeParse(
                            data.payload,
                        );
                        if (!parsed.success) {
                            socket.close(4000, "Invalid payload");
                            return;
                        }

                        isAuthenticated = true;
                        clientId = client.id;
                        clearTimeout(authTimeout);

                        const authPayload = parsed.data;
                        // clientIp is recorded only here, past the allowed-address check
                        // above: the stored value is then always an address that was let in,
                        // which is what makes it a useful reference in the client editor.
                        ClientRepository.updateAuthSuccess(
                            clientId!,
                            authPayload.version || null,
                            clientIp,
                        );

                        fastify.log.info({
                            msg: "Client authenticated",
                            clientId,
                        });
                        ProxyService.registerClient(
                            clientId!,
                            socket,
                            authPayload.capabilities,
                        );
                        ActivityService.record({
                            kind: "client.connected",
                            level: "trace",
                            clientId: clientId!,
                            data: {
                                connectionMode: CONNECTION_MODE.INBOUND,
                                version: authPayload.version || null,
                                ip: clientIp,
                                clientName: clientName(clientId!),
                            },
                        });

                        socket.send(
                            JSON.stringify({
                                type: WS_EVENTS.AUTH_SUCCESS,
                                payload: { lastSyncTime: null },
                            }),
                        );
                        ProxyService.broadcastClientUpdate();

                        socket.on("close", () => {
                            if (clientId) {
                                ClientRepository.updateLastSeen(clientId);
                                ProxyService.unregisterClient(clientId, socket);
                                fastify.log.info({
                                    msg: "Client disconnected",
                                    clientId,
                                });
                                ActivityService.record({
                                    kind: "client.disconnected",
                                    level: "trace",
                                    clientId,
                                    data: {
                                        connectionMode: CONNECTION_MODE.INBOUND,
                                        clientName: clientName(clientId),
                                    },
                                });
                                ProxyService.broadcastClientUpdate();
                            }
                        });
                    } else {
                        socket.send(
                            JSON.stringify({
                                type: WS_EVENTS.AUTH_FAILURE,
                                payload: {},
                            }),
                        );
                        socket.close(4003, "Forbidden");
                    }
                    return;
                }

                routeAgentMessage(clientId!, data);
            } catch (err) {
                fastify.log.error({
                    msg: "Error processing WebSocket message",
                    err,
                });
            }
        });
    }
}
