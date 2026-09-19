import { WebSocket } from "ws";
import {
    WS_EVENTS,
    CLIENT_STATUS,
    CONNECTION_MODE,
} from "@kasm/shared";
import { logger } from "@kasm/shared/node";
import { ClientRepository } from "../repositories/ClientRepository.js";

export class ProxyService {
    private static connectedClients = new Map<string, WebSocket>();
    private static dashboardClients = new Set<WebSocket>();
    /**
     * What each connected agent said it can do, from its AUTH payload. Kept with the
     * connection rather than in the database: it describes the build that is on the wire
     * right now, and an agent updated while it was offline must not be credited with what
     * its predecessor could do.
     */
    private static clientCapabilities = new Map<string, Set<string>>();

    static registerClient(clientId: string, socket: WebSocket, capabilities: string[] = []) {
        const existing = this.connectedClients.get(clientId);
        if (existing) {
            existing.close(4000, "Replaced by new connection");
        }
        this.connectedClients.set(clientId, socket);
        this.clientCapabilities.set(clientId, new Set(capabilities));
    }

    /** Whether the agent currently connected under this id declared that capability. */
    static hasCapability(clientId: string, capability: string): boolean {
        return this.clientCapabilities.get(clientId)?.has(capability) ?? false;
    }

    /**
     * Everything the agent currently connected under this id declared, or `null` if none
     * is connected. For reporting the answer onwards; a server-side decision asks
     * `hasCapability` about the one capability it needs.
     */
    static getCapabilities(clientId: string): string[] | null {
        const capabilities = this.clientCapabilities.get(clientId);
        return capabilities ? [...capabilities] : null;
    }

    static getConnectedClientIds(): string[] {
        return [...this.connectedClients.keys()];
    }

    /**
     * Called when an agent's socket closes. A socket that has already been replaced by a
     * newer one leaves the entry alone -- it belongs to its successor now.
     */
    static unregisterClient(clientId: string, socket: WebSocket) {
        if (this.connectedClients.get(clientId) === socket) {
            this.connectedClients.delete(clientId);
            this.clientCapabilities.delete(clientId);
        }
    }

    static addDashboardClient(socket: WebSocket) {
        this.dashboardClients.add(socket);
    }

    static removeDashboardClient(socket: WebSocket) {
        this.dashboardClients.delete(socket);
    }

    static getClientSocket(clientId: string): WebSocket | undefined {
        return this.connectedClients.get(clientId);
    }

    static getClientsWithStatus() {
        const clients = ClientRepository.findAll();
        return clients.map((client) => ({
            id: client.id,
            hostname: client.hostname,
            displayName: client.display_name,
            status: this.connectedClients.has(client.id)
                ? CLIENT_STATUS.ONLINE
                : CLIENT_STATUS.OFFLINE,
            lastSeen: client.last_seen,
            version: client.version,
            connectionMode: client.connection_mode ?? CONNECTION_MODE.INBOUND,
            inboundAllowedIp: client.inbound_allowed_ip,
            inboundLastIp: client.inbound_last_ip,
            outboundTargetAddress: client.outbound_target_address ?? null,
            /**
             * Only meaningful while the agent is connected: what it can do is a property of
             * the build on the wire, not of the stored client. `null` for an offline one is
             * "not known right now", which is the honest answer and reads differently in the
             * list from an empty list -- a connected agent that can do none of it.
             */
            capabilities: this.connectedClients.has(client.id)
                ? this.getCapabilities(client.id) ?? []
                : null,
            createdAt: client.created_at,
            updatedAt: client.updated_at,
        }));
    }

    /**
     * Broadcasts the complete list of registered clients and their online status
     * to all active dashboard WebSocket sessions.
     */
    static broadcastClientUpdate() {
        try {
            // Serialised once. This used to stringify, parse the result straight back and
            // hand the object to broadcastToDashboard, which stringified it again -- three
            // passes over the full client list on every connect and disconnect.
            this.broadcastToDashboard(
                JSON.stringify({
                    type: WS_EVENTS.CLIENTS_UPDATE,
                    payload: this.getClientsWithStatus(),
                }),
            );
        } catch (e) {
            logger.error({ err: e }, "Broadcast error");
        }
    }

    static broadcastToDashboard(message: any) {
        const msgStr =
            typeof message === "string" ? message : JSON.stringify(message);
        // Multicast message to all connected dashboard sessions
        for (const client of this.dashboardClients) {
            if (client.readyState === client.OPEN) {
                client.send(msgStr);
            }
        }
    }

    /**
     * Sends a one-way message to a client agent without waiting for a response, such as the
     * request to read keepalived now.
     */
    static sendFireAndForget(clientId: string, type: string, payload: any) {
        const socket = this.connectedClients.get(clientId);
        if (!socket) throw new Error("Client not connected");
        socket.send(JSON.stringify({ type, payload }));
    }
}
