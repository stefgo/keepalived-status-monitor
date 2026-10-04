import type { ActivityRecord, VrrpCluster } from "@kasm/shared";
import { clusterPath, paths } from "../../../lib/paths";
import { clusterOf } from "../../keepalived/lib/vrrp";

/**
 * Where the chips of an event lead: the page of the host it happened on, and the page of
 * the cluster its VRRP instance belongs to. A chip without a target stays text.
 *
 * A client that has been deleted since has no page left, which is why the ids of the known
 * clients are asked for. The cluster is looked up among the ones the hosts report now: an
 * instance that is gone from every reading has no cluster, and a VRID alone names one only
 * while no second cluster uses it.
 */
export interface ActivityLinks {
    client?: string;
    cluster?: string;
}

export function activityLinks(
    event: ActivityRecord,
    knownClientIds: ReadonlySet<string>,
    clusters: VrrpCluster[],
): ActivityLinks {
    const links: ActivityLinks = {};
    const subject = event.subject;
    const clientId = event.clientId && knownClientIds.has(event.clientId) ? event.clientId : null;

    if (clientId) links.client = paths.client(clientId);

    const byInstance =
        clientId && subject?.instanceName ? clusterOf(clusters, clientId, subject.instanceName) : undefined;
    const withVrid = subject?.vrid !== undefined ? clusters.filter((c) => c.vrid === subject.vrid) : [];
    const cluster = byInstance ?? (withVrid.length === 1 ? withVrid[0] : undefined);
    const to = cluster && clusterPath(cluster, clusters);
    if (to) links.cluster = to;

    return links;
}
