import {
    KeepalivedState,
    KeepalivedStatus,
    KeepalivedStatusSchema,
    VrrpCluster,
    VrrpInstance,
    VrrpInstanceSchema,
    WS_EVENTS,
    buildVrrpClusters,
    firstIssue,
} from "@kasm/shared";
import { logger } from "@kasm/shared/node";
import { ClientRepository } from "../repositories/ClientRepository.js";
import { KeepalivedStateRepository, type KeepalivedStateRow } from "../repositories/KeepalivedStateRepository.js";
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

        const reading = parsed.data;
        const lastInstances = this.lastInstancesAfter(reading, KeepalivedStateRepository.findByClientId(clientId));
        const receivedAt = new Date().toISOString();
        KeepalivedStateRepository.upsert(
            clientId,
            JSON.stringify(reading),
            receivedAt,
            lastInstances ? JSON.stringify(lastInstances) : null,
        );
        const state = this.toState(clientId, reading, receivedAt, lastInstances);
        ProxyService.broadcastToDashboard({
            type: WS_EVENTS.KEEPALIVED_STATE_UPDATE,
            payload: state,
        });
    }

    static getByClientId(clientId: string): KeepalivedState | null {
        const row = KeepalivedStateRepository.findByClientId(clientId);
        return row ? this.fromRow(row) : null;
    }

    static getAll(): KeepalivedState[] {
        return KeepalivedStateRepository.findAll()
            .map((row) => this.fromRow(row))
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
     * What to keep as the host's last known instances after this reading. A reading with
     * instances replaces them. One of a stopped or unreadable keepalived carries none and
     * keeps the previous ones, so the host stays in its clusters. One of a running, readable
     * keepalived without instances clears them: the host really left its clusters.
     */
    private static lastInstancesAfter(
        reading: KeepalivedStatus,
        previous: KeepalivedStateRow | undefined,
    ): VrrpInstance[] | null {
        if (reading.instances.length > 0) {
            // The counters change with every reading and say nothing about membership.
            return reading.instances.map((instance) => ({ ...instance, stats: undefined }));
        }
        const silent = !reading.running || !!reading.error;
        return silent && previous ? this.parseInstances(previous.last_instances) : null;
    }

    /** The state as the dashboard gets it: the last known instances only where there are no current ones. */
    private static toState(
        clientId: string,
        reading: KeepalivedStatus,
        receivedAt: string,
        lastInstances: VrrpInstance[] | null,
    ): KeepalivedState {
        const state: KeepalivedState = { ...reading, clientId, receivedAt };
        if (reading.instances.length === 0 && lastInstances?.length) state.lastKnownInstances = lastInstances;
        return state;
    }

    /** A column written by an older build, or damaged, counts as nothing known. */
    private static parseInstances(json: string | null): VrrpInstance[] | null {
        if (!json) return null;
        try {
            const parsed = VrrpInstanceSchema.array().safeParse(JSON.parse(json));
            return parsed.success ? parsed.data : null;
        } catch {
            return null;
        }
    }

    /**
     * Parsed again on the way out: the row was written by an older build, possibly, and
     * a document that no longer fits is dropped rather than handed to the dashboard.
     */
    private static fromRow(row: KeepalivedStateRow): KeepalivedState | null {
        try {
            const parsed = KeepalivedStatusSchema.safeParse(JSON.parse(row.status));
            return parsed.success
                ? this.toState(row.client_id, parsed.data, row.received_at, this.parseInstances(row.last_instances))
                : null;
        } catch {
            return null;
        }
    }
}
