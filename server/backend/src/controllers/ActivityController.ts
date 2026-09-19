import { FastifyReply, FastifyRequest } from "fastify";
import { ActivityService } from "../services/ActivityService.js";

export class ActivityController {
    static async list(_request: FastifyRequest, _reply: FastifyReply) {
        return ActivityService.list();
    }

    static async markSeen(request: FastifyRequest, reply: FastifyReply) {
        const { id } = request.params as { id: string };
        const ok = ActivityService.markSeen(id, request.user.id);
        if (!ok) return reply.code(404).send({ error: "Activity event not found" });
        return { ok: true };
    }

    static async markAllSeen(request: FastifyRequest, _reply: FastifyReply) {
        ActivityService.markAllSeen(request.user.id);
        return { ok: true };
    }

    static async deleteOne(request: FastifyRequest, reply: FastifyReply) {
        const { id } = request.params as { id: string };
        const ok = ActivityService.delete(id);
        if (!ok) return reply.code(404).send({ error: "Activity event not found" });
        return { ok: true };
    }

    static async deleteAll(_request: FastifyRequest, _reply: FastifyReply) {
        ActivityService.deleteAll();
        return { ok: true };
    }
}
