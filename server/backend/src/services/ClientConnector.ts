import WebSocket from "ws";
import { randomUUID } from "crypto";
import { WS_EVENTS, CONNECTION_MODE, agentBaseUrl, isTlsTarget } from "@kasm/shared";
import { logger } from "@kasm/shared/node";
import { appConfig } from "../config/AppConfig.js";
import { ClientRepository, type ClientRow } from "../repositories/ClientRepository.js";
import { WebSocketController } from "../controllers/WebSocketController.js";

const RECONNECT_DELAYS = [5000, 10000, 30000, 60000];

export class ClientConnector {
    private static reconnectTimers = new Map<string, NodeJS.Timeout>();
    private static reconnectAttempts = new Map<string, number>();

    /**
     * Connects to all outbound clients stored in the database that already have an authToken.
     * Registration cannot be retried on startup — it requires the secret from the UI.
     */
    static async connectAll(): Promise<void> {
        const clients = ClientRepository.findOutboundClients();
        const ready = clients.filter((c) => c.auth_token);
        logger.info(`ClientConnector: connecting to ${ready.length} outbound client(s) on startup`);
        for (const client of ready) {
            await this.connectClient(client);
        }
    }

    /**
     * First-time connection for a new outbound client that is not yet in the database.
     * Performs registration (if no authToken yet) and the full AUTH handshake.
     * Calls onPersist(authToken, version) only on AUTH success — the caller must write to DB there.
     * Returns whether AUTH succeeded and, if not, why. Nothing is written to DB on failure.
     */
    static async firstConnect(
        id: string,
        outboundTargetAddress: string,
        registrationSecret: string,
        onPersist: (authToken: string, version: string | null) => void,
    ): Promise<{ ok: boolean; error?: string }> {
        const registration = await this.performRegistration(id, outboundTargetAddress, registrationSecret);
        if (!registration.authToken) {
            return { ok: false, error: registration.error };
        }

        const connected = await this.connectWithToken(
            id,
            outboundTargetAddress,
            registration.authToken,
            onPersist,
        );
        return connected
            ? { ok: true }
            : {
                  ok: false,
                  error: "Registration succeeded, but the agent session (AUTH) could not be established afterwards. The client has already stored its authToken and used up the secret — remove the authToken on the client host and set a new registrationSecret before trying again.",
              };
    }

    /**
     * One of the agent's WebSocket routes, and the options the socket is opened with.
     *
     * The scheme is not decided here: it comes out of the stored address, so a client the
     * operator wrote as `wss://…` is dialled over TLS and every address stored before TLS
     * existed keeps meaning exactly what it did. The certificate is checked unless the
     * operator switched that off for the whole installation -- an agent on a home network
     * usually carries a self-signed one, which is a decision about the installation rather
     * than about this connection.
     *
     * The returned `url` carries no query. Callers that need one append it themselves and
     * keep logging this one: the auth token goes in that query, and a log line travels
     * further than this process.
     */
    private static agentSocket(
        address: string,
        path: string,
    ): { url: string; options: WebSocket.ClientOptions } {
        return {
            url: `${agentBaseUrl(address)}${path}`,
            options: isTlsTarget(address)
                ? {
                      rejectUnauthorized:
                          !appConfig.security.allow_self_signed_agent_certificates,
                  }
                : {},
        };
    }

    /**
     * A readable message for a socket error. A refused connection to a host name that
     * resolves to both IPv4 and IPv6 (e.g. localhost) arrives as an AggregateError whose
     * own message is empty — the details are in its `errors`.
     */
    private static describeSocketError(err: unknown): string {
        const nested = (err as { errors?: unknown[] })?.errors;
        if (Array.isArray(nested) && nested.length > 0) {
            return nested.map((e) => (e instanceof Error ? e.message : String(e))).join("; ");
        }
        if (err instanceof Error) {
            return err.message || (err as NodeJS.ErrnoException).code || err.name;
        }
        return String(err);
    }

    /** Turns a WebSocket close code from the agent's /ws/register into a message for the operator. */
    private static describeRegistrationClose(code: number, reason: string): string {
        if (code === 4003 && reason === "Already registered") {
            return "The client is already registered (authToken in its config.yaml). Remove the authToken on the client host and set a new registrationSecret before adding it again.";
        }
        if (code === 4003 && reason === "Access denied") {
            return "The client refused the connection: this server's address is not in the agent's allowedNetworks.";
        }
        if (code === 4003 && reason === "No registration secret configured") {
            return "No registrationSecret is configured on the client host. Set one in the agent's config.yaml and restart the agent.";
        }
        if (code === 4003) {
            return "The client rejected the registration secret.";
        }
        if (code === 4001) {
            return "The client closed the registration because the handshake timed out.";
        }
        return `The client closed the registration connection (code ${code}${reason ? `: ${reason}` : ""}).`;
    }

    /**
     * Performs the registration handshake and returns the generated authToken, or an error
     * describing why it failed. Does not write anything to the database.
     *
     * Every terminal event — including a bare `close` without any protocol message, which is
     * how the agent rejects an already-registered host — has to settle the promise. It used
     * to only clear the timeout there, so the request that started the handshake hung until
     * the timeout fired and then reported no reason at all.
     */
    private static async performRegistration(
        id: string,
        outboundTargetAddress: string,
        registrationSecret: string,
    ): Promise<{ authToken: string | null; error?: string }> {
        const { url: wsUrl, options } = this.agentSocket(outboundTargetAddress, "/ws/register");
        logger.info({ url: wsUrl }, "ClientConnector: starting registration");

        return new Promise((resolve) => {
            let settled = false;
            let timeout: NodeJS.Timeout | undefined;
            const finish = (authToken: string | null, error?: string) => {
                if (settled) return;
                settled = true;
                if (timeout) clearTimeout(timeout);
                resolve({ authToken, error });
            };

            let ws: WebSocket;
            try {
                ws = new WebSocket(wsUrl, options);
            } catch (err) {
                logger.error({ err }, "ClientConnector: failed to create registration socket");
                finish(
                    null,
                    `Could not open the registration connection: ${this.describeSocketError(err)}`,
                );
                return;
            }

            const authToken = randomUUID();
            timeout = setTimeout(() => {
                logger.warn("ClientConnector: registration timed out");
                finish(null, "Registration timed out — the client did not respond.");
                ws.terminate();
            }, 10000);

            ws.on("open", () => {
                ws.send(JSON.stringify({
                    type: WS_EVENTS.REGISTRATION_REQUEST,
                    // clientId lets the agent store the id this server knows it by, instead of
                    // one it made up. Agents that predate it ignore the extra field.
                    payload: { secret: registrationSecret, authToken, clientId: id },
                }));
            });

            ws.on("message", (data: WebSocket.RawData) => {
                try {
                    const message = JSON.parse(data.toString());
                    if (message.type === WS_EVENTS.REGISTRATION_SUCCESS) {
                        logger.info("ClientConnector: registration successful");
                        finish(authToken);
                        ws.close(1000, "Registration complete");
                    } else if (message.type === WS_EVENTS.REGISTRATION_FAILURE) {
                        logger.error("ClientConnector: client rejected registration secret");
                        finish(
                            null,
                            message?.payload?.error
                                ? `The client rejected the registration: ${message.payload.error}`
                                : "The client rejected the registration secret.",
                        );
                        ws.close();
                    }
                } catch (err) {
                    logger.error({ err }, "ClientConnector: error parsing registration response");
                    finish(null, "The client sent an invalid response to the registration.");
                    ws.close();
                }
            });

            ws.on("error", (err) => {
                const detail = this.describeSocketError(err);
                logger.error({ err: detail }, "ClientConnector: registration connection error");
                finish(null, `Registration connection failed: ${detail}`);
            });

            // A close without a protocol message is a rejection by the agent — settle it
            // instead of leaving the promise to the timeout. After a success or failure
            // message this is a no-op.
            ws.on("close", (code: number, reason: Buffer) => {
                const text = reason?.toString() ?? "";
                logger.warn({ code, reason: text }, "ClientConnector: registration socket closed");
                finish(null, this.describeRegistrationClose(code, text));
            });
        });
    }

    /**
     * Opens an agent WebSocket connection using the given authToken (client not necessarily in DB).
     * Calls onPersist(version) on AUTH success before the client is registered in ProxyService.
     */
    private static async connectWithToken(
        id: string,
        outboundTargetAddress: string,
        authToken: string,
        onPersist: (authToken: string, version: string | null) => void,
    ): Promise<boolean> {
        // The id goes on the wire next to the token: the agent checks the pair and refuses
        // a server that dials it under someone else's identity.
        const { url, options } = this.agentSocket(outboundTargetAddress, "/ws/agent");
        const wsUrl = `${url}?clientId=${encodeURIComponent(
            id,
        )}&token=${encodeURIComponent(authToken)}`;
        logger.info({ clientId: id, url }, "ClientConnector: connecting");

        return new Promise((resolve) => {
            let ws: WebSocket;
            try {
                ws = new WebSocket(wsUrl, options);
            } catch (err) {
                logger.error({ err, clientId: id }, "ClientConnector: failed to create socket");
                resolve(false);
                return;
            }

            const timeout = setTimeout(() => {
                ws.terminate();
                logger.warn({ clientId: id }, "ClientConnector: connection timed out");
                resolve(false);
            }, 10000);

            ws.on("open", () => {
                clearTimeout(timeout);
                this.reconnectAttempts.delete(id);
                WebSocketController.handleOutboundAgentConnection(
                    id,
                    ws,
                    () => this.scheduleReconnect(id),
                    (authSuccess) => resolve(authSuccess),
                    (version) => onPersist(authToken, version),
                );
            });

            ws.on("error", (err) => {
                clearTimeout(timeout);
                logger.error({ err: err.message, clientId: id }, "ClientConnector: connection error");
                resolve(false);
            });

            // Safety net: a close that never produced an AUTH result must still settle the
            // promise. After a successful AUTH this resolve is a no-op.
            ws.on("close", () => {
                clearTimeout(timeout);
                resolve(false);
            });
        });
    }

    /**
     * Reconnects an existing outbound client that is already stored in the database.
     * registrationSecret is only needed if the client has no authToken yet.
     */
    static async connectOrRegister(client: ClientRow, registrationSecret?: string): Promise<boolean> {
        if (!client.outbound_target_address) {
            logger.warn({ clientId: client.id }, "ClientConnector: missing outbound_target_address, skipping");
            return false;
        }

        if (!client.auth_token) {
            if (!registrationSecret) {
                logger.warn({ clientId: client.id }, "ClientConnector: no registration secret provided, cannot register");
                return false;
            }
            return await this.registerClient(client, client.outbound_target_address, registrationSecret);
        } else {
            return await this.connectClient(client);
        }
    }

    /**
     * Registration + connect for an existing DB client (e.g. re-registration after token loss).
     * Writes authToken to DB after successful registration.
     */
    private static async registerClient(
        client: ClientRow,
        outboundTargetAddress: string,
        registrationSecret: string,
    ): Promise<boolean> {
        const registration = await this.performRegistration(client.id, outboundTargetAddress, registrationSecret);
        if (!registration.authToken) {
            logger.warn({ clientId: client.id, error: registration.error }, "ClientConnector: re-registration failed");
            this.scheduleReconnect(client.id);
            return false;
        }

        ClientRepository.updateAuthToken(client.id, registration.authToken);
        const updatedClient = ClientRepository.findById(client.id);
        // Deleted while the registration handshake was running.
        if (!updatedClient) return false;
        return this.connectClient(updatedClient);
    }

    /**
     * Opens a regular agent connection for a client already stored in the database.
     */
    static async connectClient(client: ClientRow): Promise<boolean> {
        if (!client.outbound_target_address || !client.auth_token) {
            logger.warn({ clientId: client.id }, "ClientConnector: missing fields, cannot connect");
            return false;
        }

        // Same pair as in connectWithToken: the agent refuses a caller that does not name
        // the id it was registered under, so the id has to go on the wire here too.
        const { url, options } = this.agentSocket(client.outbound_target_address, "/ws/agent");
        const wsUrl = `${url}?clientId=${encodeURIComponent(
            client.id,
        )}&token=${encodeURIComponent(client.auth_token)}`;
        logger.info({ clientId: client.id, url }, "ClientConnector: connecting");

        return new Promise((resolve) => {
            let ws: WebSocket;
            try {
                ws = new WebSocket(wsUrl, options);
            } catch (err) {
                logger.error({ err, clientId: client.id }, "ClientConnector: failed to create socket");
                this.scheduleReconnect(client.id);
                resolve(false);
                return;
            }

            const timeout = setTimeout(() => {
                ws.terminate();
                logger.warn({ clientId: client.id }, "ClientConnector: connection timed out");
                this.scheduleReconnect(client.id);
                resolve(false);
            }, 10000);

            ws.on("open", () => {
                clearTimeout(timeout);
                this.reconnectAttempts.delete(client.id);
                WebSocketController.handleOutboundAgentConnection(
                    client.id,
                    ws,
                    () => this.scheduleReconnect(client.id),
                    (authSuccess) => resolve(authSuccess),
                );
            });

            ws.on("error", (err) => {
                clearTimeout(timeout);
                logger.error({ err: err.message, clientId: client.id }, "ClientConnector: connection error");
                this.scheduleReconnect(client.id);
                resolve(false);
            });
        });
    }

    /**
     * Schedules a reconnect attempt with exponential backoff.
     */
    static scheduleReconnect(clientId: string): void {
        if (this.reconnectTimers.has(clientId)) return;

        const attempt = this.reconnectAttempts.get(clientId) ?? 0;
        const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
        this.reconnectAttempts.set(clientId, attempt + 1);

        logger.info({ clientId, delay }, "ClientConnector: scheduling reconnect");

        const timer = setTimeout(async () => {
            this.reconnectTimers.delete(clientId);
            const client = ClientRepository.findById(clientId);
            if (client && client.connection_mode === CONNECTION_MODE.OUTBOUND) {
                await this.connectOrRegister(client);
            }
        }, delay);

        this.reconnectTimers.set(clientId, timer);
    }

    /**
     * Cancels any pending reconnect for a client.
     */
    static disconnectClient(clientId: string): void {
        const timer = this.reconnectTimers.get(clientId);
        if (timer) {
            clearTimeout(timer);
            this.reconnectTimers.delete(clientId);
        }
        this.reconnectAttempts.delete(clientId);
    }
}
