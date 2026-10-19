import { FastifyReply, FastifyRequest } from "fastify";
import crypto, { randomUUID } from "crypto";
import { ProxyService } from "../services/ProxyService.js";
import { ClientConnector } from "../services/ClientConnector.js";
import { ActivityService } from "../services/ActivityService.js";
import { KeepalivedStateService } from "../services/KeepalivedStateService.js";
import { ClientRepository } from "../repositories/ClientRepository.js";
import { secretKeyPersisted } from "../config/AppConfig.js";
import {
    CONNECTION_MODE,
    CreateInboundClientSchema,
    CreateOutboundClientSchema,
    RegistrationPayloadSchema,
    UpdateClientSchema,
    firstIssue,
    normaliseIp,
    type CreatedInboundClient,
    type RegistrationToken,
} from "@kasm/shared";

/** How long a registration token is valid once issued. */
const REGISTRATION_TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * Issues a registration token for an inbound client and stores its hash on the row. The
 * returned value is the one time the token exists in the clear.
 */
function openRegistration(clientId: string): RegistrationToken {
    const token = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + REGISTRATION_TOKEN_TTL_MS).toISOString();
    ClientRepository.setRegistrationToken(clientId, token, expiresAt);
    return { token, expiresAt };
}

export class ClientController {
    /**
     * Retrieves a list of all clients combined with their live WebSocket connection status.
     */
    static async list(_request: FastifyRequest, _reply: FastifyReply) {
        return ProxyService.getClientsWithStatus();
    }

    /**
     * Creates an inbound client that waits for its agent, and the token the agent registers
     * with. The client is there from now on -- in the list, under the name given here --
     * and the token is a property of it, not an object of its own.
     */
    static async createInbound(request: FastifyRequest, reply: FastifyReply) {
        const parsed = CreateInboundClientSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: firstIssue(parsed.error) });
        }
        const id = randomUUID();
        ClientRepository.createPendingInbound(
            id,
            parsed.data.displayName,
            parsed.data.inboundAllowedIp ?? null,
        );
        const registration = openRegistration(id);
        ProxyService.broadcastClientUpdate();
        return { id, ...registration } satisfies CreatedInboundClient;
    }

    /**
     * Issues a new registration token for an inbound client, replacing one that was still
     * open. For a client that waits, this is a token that has not run out; for a registered
     * one, the way to put a reinstalled agent back under the same client. The agent that is
     * connected now keeps its auth token until another agent registers with this one.
     */
    static async issueRegistrationToken(request: FastifyRequest, reply: FastifyReply) {
        const { clientId } = request.params as { clientId: string };
        const client = ClientRepository.findById(clientId);
        if (!client) {
            return reply.code(404).send({ error: "Client not found" });
        }
        if (client.connection_mode !== CONNECTION_MODE.INBOUND) {
            return reply.code(400).send({ error: "Only inbound clients register with a token" });
        }
        const registration = openRegistration(clientId);
        ProxyService.broadcastClientUpdate();
        return registration;
    }

    /**
     * An agent registers with the token issued for its client. Unauthenticated: the token
     * is the credential, and it is good for one registration only.
     */
    static async register(request: FastifyRequest, reply: FastifyReply) {
        // The one unauthenticated endpoint with a body, so its shape is checked first -- and
        // ahead of the token lookup, so a malformed request learns nothing from the status
        // code about whether the token it sent exists.
        const parsed = RegistrationPayloadSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: firstIssue(parsed.error) });
        }
        const { token } = parsed.data;
        const client = ClientRepository.findByValidRegistrationToken(token);
        if (!client) {
            return reply.code(403).send({ error: "Invalid or expired token" });
        }

        try {
            const hostname = parsed.data.hostname || "unknown";
            const reregistered = client.auth_token !== null;

            // The server issues the auth token. The client id is the one the token was issued
            // for: taking it from the caller would let anyone holding a token name another
            // client and impersonate that host from then on.
            const authToken = crypto.randomBytes(64).toString("hex");

            // Without an address given when the client was created, the one it registers
            // from becomes its allowed address; the client editor can widen or switch off
            // the check. Normalised, so a dual-stack peer is stored as the IPv4 address it
            // is. Behind a reverse proxy this is the forwarded address only if the proxy is
            // listed in security.trusted_proxies -- see docs/security.md.
            const registered = ClientRepository.completeRegistration(
                client.id,
                token,
                hostname,
                authToken,
                normaliseIp(request.ip),
            );
            if (!registered) {
                return reply.code(403).send({ error: "Invalid or expired token" });
            }

            // The agent that was connected under this client presents an auth token that is
            // no longer stored; it goes now rather than at its next reconnect.
            if (reregistered) {
                const socket = ProxyService.getClientSocket(client.id);
                if (socket) {
                    socket.close(4000, "Client re-registered");
                    ProxyService.unregisterClient(client.id, socket);
                }
            }

            ActivityService.record({
                kind: "client.registered",
                level: "info",
                clientId: client.id,
                data: {
                    hostname,
                    connectionMode: CONNECTION_MODE.INBOUND,
                    ip: ClientRepository.findById(client.id)?.inbound_allowed_ip ?? null,
                    reregistered,
                },
            });

            ProxyService.broadcastClientUpdate();

            return { token: authToken, clientId: client.id };
        } catch (e: unknown) {
            request.log.error({ err: e }, "Registration failed");
            return reply.code(500).send({ error: "Registration failed" });
        }
    }

    /**
     * Attempts registration and AUTH handshake with the client first.
     * Only writes to the database if the connection was fully established.
     */
    static async createOutbound(request: FastifyRequest, reply: FastifyReply) {
        const parsed = CreateOutboundClientSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: firstIssue(parsed.error) });
        }
        const { hostname, outboundTargetAddress, registrationSecret } = parsed.data;

        // The token is stored encrypted, and that happens only after the agent has accepted
        // the registration. Failing there would leave an agent that counts itself as
        // registered and a server that has no row for it -- so refuse before the handshake.
        if (!secretKeyPersisted()) {
            return reply.code(500).send({
                error: "secretKey could not be written to config.yaml — make the file writable and restart the server.",
            });
        }

        const id = randomUUID();
        const resolvedHostname = hostname?.trim() || outboundTargetAddress;

        const result = await ClientConnector.firstConnect(
            id,
            outboundTargetAddress,
            registrationSecret,
            (authToken, version) => {
                ClientRepository.createOutbound(id, resolvedHostname, outboundTargetAddress, authToken);
                // Outbound client: the server dialled it, so there is no remote address.
                ClientRepository.updateAuthSuccess(id, version, null);
                ActivityService.record({
                    kind: "client.registered",
                    level: "info",
                    clientId: id,
                    data: {
                        hostname: resolvedHostname,
                        connectionMode: CONNECTION_MODE.OUTBOUND,
                        address: outboundTargetAddress,
                        version,
                    },
                });
            },
        );

        if (!result.ok) {
            // The reason comes from the handshake with the agent (e.g. "already registered"),
            // so the operator can act on it instead of guessing.
            const reason = result.error ?? "Unknown error.";
            return reply.code(503).send({ error: `Could not establish connection to client. ${reason}` });
        }

        ProxyService.broadcastClientUpdate();
        return { id, hostname: resolvedHostname };
    }

    /**
     * Deletes a client from the database. If the client is currently connected,
     * immediately terminates their WebSocket session.
     */
    static async delete(request: FastifyRequest, reply: FastifyReply) {
        const { clientId } = request.params as { clientId: string };
        const client = ClientRepository.findById(clientId);

        if (!client) {
            return reply.code(404).send({ error: "Client not found" });
        }

        // Cancel any pending reconnects for outbound clients
        if (client.connection_mode === CONNECTION_MODE.OUTBOUND) {
            ClientConnector.disconnectClient(clientId);
        }

        const info = ClientRepository.delete(clientId);
        if (info.changes === 0) {
            return reply.code(404).send({ error: "Client not found" });
        }
        KeepalivedStateService.delete(clientId);

        // Disconnect if online
        const socket = ProxyService.getClientSocket(clientId);
        if (socket) {
            socket.close(4000, "Client deleted");
            ProxyService.unregisterClient(clientId, socket);
        }

        ProxyService.broadcastClientUpdate();
        return { status: "deleted" };
    }

    /**
     * Triggers an immediate reconnect attempt for an offline outbound client.
     * Cancels any pending backoff timer and resets the attempt counter first.
     */
    static async reconnect(request: FastifyRequest, reply: FastifyReply) {
        const { clientId } = request.params as { clientId: string };
        const client = ClientRepository.findById(clientId);

        if (!client) {
            return reply.code(404).send({ error: "Client not found" });
        }

        if (client.connection_mode !== CONNECTION_MODE.OUTBOUND) {
            return reply.code(400).send({ error: "Client is not an outbound client" });
        }

        ClientConnector.disconnectClient(clientId);
        ClientConnector.connectClient(client);

        return { status: "reconnecting" };
    }

    /**
     * Updates a client's display name and site, for inbound clients the
     * address or network its connections must come from, and for outbound clients the
     * address the server dials. `inboundAllowedIp: null` switches that check off; an absent
     * key leaves it alone.
     */
    static async update(request: FastifyRequest, reply: FastifyReply) {
        const { clientId } = request.params as { clientId: string };
        const parsed = UpdateClientSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: firstIssue(parsed.error) });
        }
        const { displayName, site, inboundAllowedIp, outboundTargetAddress } = parsed.data;

        const client = ClientRepository.findById(clientId);
        if (!client) {
            return reply.code(404).send({ error: "Client not found" });
        }
        const isOutbound = client.connection_mode === CONNECTION_MODE.OUTBOUND;
        if (inboundAllowedIp !== undefined && isOutbound) {
            return reply.code(400).send({
                error: "inboundAllowedIp: Only inbound clients have an allowed address",
            });
        }
        if (outboundTargetAddress !== undefined && !isOutbound) {
            return reply.code(400).send({
                error: "outboundTargetAddress: Only outbound clients are dialled by the server",
            });
        }

        if (displayName !== undefined) {
            ClientRepository.updateDisplayName(clientId, displayName);
        }
        if (site !== undefined) {
            // The schema has trimmed it already; an empty site is no site.
            ClientRepository.updateSite(clientId, site || null);
        }
        if (inboundAllowedIp !== undefined) {
            ClientRepository.updateInboundAllowedIp(clientId, inboundAllowedIp);
        }

        // A changed address has to take effect now, not at the next backoff step: the open
        // socket still points at the old host, and leaving it up would mean the client shows
        // as online at an address the operator has just corrected.
        if (
            outboundTargetAddress !== undefined &&
            outboundTargetAddress !== client.outbound_target_address
        ) {
            ClientRepository.updateOutboundTargetAddress(clientId, outboundTargetAddress);

            const socket = ProxyService.getClientSocket(clientId);
            if (socket) {
                socket.close(4000, "Target address changed");
                ProxyService.unregisterClient(clientId, socket);
            }
            // Clears the pending reconnect and its attempt counter, so the new address is
            // dialled straight away rather than after the old ladder runs down.
            ClientConnector.disconnectClient(clientId);

            const updated = ClientRepository.findById(clientId);
            if (updated) {
                // Not awaited: the reply should not wait out a connection attempt to a host
                // that may be unreachable. A failure schedules its own reconnect.
                void ClientConnector.connectOrRegister(updated);
            }
        }

        ProxyService.broadcastClientUpdate();
        return { success: true };
    }
}
