import {
    buildNamedClusters,
    clientCount,
    countFindings,
    fleetFindings,
    fleetFindingText,
    fleetStatus,
    instanceCount,
    needsAttention,
    type StatusReport,
} from "@kasm/shared";
import { appVersion } from "../core/version.js";
import { KeepalivedStateService } from "./KeepalivedStateService.js";
import { ProxyService } from "./ProxyService.js";

/**
 * The status report of `GET /api/v1/status`: the fleet's VRRP verdict and its findings, as
 * the dashboard shows them.
 *
 * Nothing is judged here. The clusters are built by `buildNamedClusters` from the same two
 * things the dashboard builds them from -- the clients with their connection, and their last
 * readings -- and the verdict and the findings come from the functions in `shared` the
 * dashboard calls, so the two cannot disagree.
 */
export class StatusService {
    static report(now = Date.now()): StatusReport {
        const clients = ProxyService.getClientsWithStatus();
        const states = KeepalivedStateService.getAll();
        const clusters = buildNamedClusters(clients, states);
        const findings = fleetFindings(clusters).map((finding) => ({
            id: finding.id,
            type: finding.type,
            severity: finding.severity,
            text: fleetFindingText(finding),
            since: null,
        }));
        return {
            app: "kasm",
            version: appVersion,
            status: fleetStatus(clusters),
            checkedAt: new Date(now).toISOString(),
            counts: countFindings(findings),
            summary: {
                hosts: clientCount(clients),
                clusters: {
                    total: clusters.length,
                    needingAttention: needsAttention(clusters).length,
                    unknown: clusters.filter((cluster) => cluster.health === "unknown").length,
                },
                ...instanceCount(clients, Object.fromEntries(states.map((state) => [state.clientId, state]))),
            },
            findings,
        };
    }
}
