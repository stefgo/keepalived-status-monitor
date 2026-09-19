import { FastifyReply, FastifyRequest } from "fastify";
import { WS_EVENTS } from "@kasm/shared";
import { KeepalivedStateService } from "../services/KeepalivedStateService.js";
import { ProxyService } from "../services/ProxyService.js";
import { ClientRepository } from "../repositories/ClientRepository.js";

export class KeepalivedController {
    /** `GET /api/v1/keepalived/states` -- the last reading of every client. */
    static async listStates() {
        return KeepalivedStateService.getAll();
    }

    /** `GET /api/v1/keepalived/clusters` -- instances of all hosts grouped by virtual router. */
    static async listClusters() {
        return KeepalivedStateService.getClusters();
    }

    /** `GET /api/v1/clients/:clientId/keepalived` */
    static async getState(request: FastifyRequest, reply: FastifyReply) {
        const { clientId } = request.params as { clientId: string };
        if (!ClientRepository.findById(clientId)) {
            return reply.code(404).send({ error: "Client not found" });
        }
        const state = KeepalivedStateService.getByClientId(clientId);
        if (!state) {
            return reply.code(404).send({ error: "No keepalived reading from this client yet" });
        }
        return state;
    }

    /**
     * `POST /api/v1/clients/:clientId/keepalived/refresh` -- asks the agent to read now. The
     * reading arrives over the dashboard WebSocket like any other; the reply only says that
     * the agent was asked.
     */
    static async refresh(request: FastifyRequest, reply: FastifyReply) {
        const { clientId } = request.params as { clientId: string };
        if (!ClientRepository.findById(clientId)) {
            return reply.code(404).send({ error: "Client not found" });
        }
        if (!ProxyService.getClientSocket(clientId)) {
            return reply.code(409).send({ error: "Client is offline" });
        }
        ProxyService.sendFireAndForget(clientId, WS_EVENTS.REQUEST_STATE_UPDATE, {});
        return { status: "requested" };
    }
}
