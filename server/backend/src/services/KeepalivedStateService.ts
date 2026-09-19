import {
    KeepalivedState,
    KeepalivedStatusSchema,
    VrrpCluster,
    WS_EVENTS,
    buildVrrpClusters,
    firstIssue,
} from "@kasm/shared";
import { logger } from "@kasm/shared/node";
import { ClientRepository } from "../repositories/ClientRepository.js";
import { KeepalivedStateRepository } from "../repositories/KeepalivedStateRepository.js";
import { ProxyService } from "./ProxyService.js";

/**
 * The last keepalived reading of every client: stored, handed to the dashboards, and grouped
 * into VRRP clusters. Failover events are not made here -- the agent compares its readings
 * itself and reports them as activity, so a change it saw while the server was away is not
 * lost.
 */
export class KeepalivedStateService {
    /** Called by the agent message router for every KEEPALIVED_UPDATE. */
    static handleUpdate(clientId: string, payload: unknown): void {
        const parsed = KeepalivedStatusSchema.safeParse(payload);
        if (!parsed.success) {
            logger.warn(
                { clientId, error: firstIssue(parsed.error) },
                "Discarding malformed KEEPALIVED_UPDATE from agent",
            );
            return;
        }

        const state: KeepalivedState = {
            ...parsed.data,
            clientId,
            receivedAt: new Date().toISOString(),
        };
        KeepalivedStateRepository.upsert(
            clientId,
            JSON.stringify(parsed.data),
            state.receivedAt,
        );
        ProxyService.broadcastToDashboard({
            type: WS_EVENTS.KEEPALIVED_STATE_UPDATE,
            payload: state,
        });
    }

    static getByClientId(clientId: string): KeepalivedState | null {
        const row = KeepalivedStateRepository.findByClientId(clientId);
        return row ? this.fromRow(row.client_id, row.status, row.received_at) : null;
    }

    static getAll(): KeepalivedState[] {
        return KeepalivedStateRepository.findAll()
            .map((row) => this.fromRow(row.client_id, row.status, row.received_at))
            .filter((state): state is KeepalivedState => state !== null);
    }

    static getClusters(): VrrpCluster[] {
        const sites = new Map(ClientRepository.findAll().map((client) => [client.id, client.site]));
        return buildVrrpClusters(
            this.getAll(),
            ProxyService.getConnectedClientIds(),
            (clientId) => sites.get(clientId) ?? null,
        );
    }

    static delete(clientId: string): void {
        KeepalivedStateRepository.delete(clientId);
    }

    /**
     * Parsed again on the way out: the row was written by an older build, possibly, and
     * a document that no longer fits is dropped rather than handed to the dashboard.
     */
    private static fromRow(clientId: string, status: string, receivedAt: string): KeepalivedState | null {
        try {
            const parsed = KeepalivedStatusSchema.safeParse(JSON.parse(status));
            return parsed.success ? { ...parsed.data, clientId, receivedAt } : null;
        } catch {
            return null;
        }
    }
}
