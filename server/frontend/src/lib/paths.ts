import { generatePath } from "react-router-dom";
import type { VrrpCluster } from "@kasm/shared";
import { clusterNetworkKey, clustersAt } from "../features/keepalived/lib/vrrp";

/**
 * Every path of the application, once. The routes take their `path`s from here, and
 * whatever navigates takes a pattern (no parameter) or one of the builders in `paths`
 * below. **No path literal anywhere else.**
 *
 * The patterns are absolute, also for a nested route: the tree says who is whose parent,
 * this says what the address bar shows.
 */
export const ROUTES = {
    login: "/login",
    // The dashboard: what needs a look, across every host.
    root: "/",

    clients: "/clients",
    clientNew: "/clients/new",
    client: "/client/:clientId",
    clientEdit: "/client/:clientId/edit",
    // The page of one host's instance, which the cluster page has replaced. Kept as a
    // redirect to the cluster the instance takes part in.
    clientInstance: "/client/:clientId/instance/:instanceName",

    clusters: "/clusters",
    cluster: "/clusters/:vrid",
    // The same page for a cluster of a client with a site: the VRID is only unique there.
    clusterAtSite: "/clusters/:site/:vrid",

    activity: "/activity",
    users: "/users",
    tokens: "/tokens",

    webhooks: "/webhooks",
    webhookNew: "/webhooks/new",
    webhook: "/webhooks/:webhookId",

    settings: "/settings",
} as const;

/**
 * The patterns with their parameters filled in. A pattern without one is used as it is.
 * `generatePath` encodes every parameter, so a site with a slash in it is passed as it is.
 */
export const paths = {
    client: (clientId: string) => generatePath(ROUTES.client, { clientId }),
    clientEdit: (clientId: string) => generatePath(ROUTES.clientEdit, { clientId }),

    webhook: (webhookId: string) => generatePath(ROUTES.webhook, { webhookId }),
};

/** The query parameter that names one of several clusters sharing site and VRID. */
export const CLUSTER_NET_PARAM = "net";

/**
 * Where a cluster has its page: `/clusters/<vrid>`, or `/clusters/<site>/<vrid>` for a
 * client with a site. Only where another cluster shares both does `?net=` name the one
 * meant. A cluster without a VRID has no page -- keepalived reports one for every instance.
 *
 * Not among `paths`: which pattern it fills, and whether it needs the query, depends on the
 * other clusters.
 */
export function clusterPath(cluster: VrrpCluster, clusters: VrrpCluster[]): string | undefined {
    if (cluster.vrid === null) return undefined;
    const vrid = String(cluster.vrid);
    const path = cluster.site
        ? generatePath(ROUTES.clusterAtSite, { site: cluster.site, vrid })
        : generatePath(ROUTES.cluster, { vrid });
    return clustersAt(clusters, cluster.site, cluster.vrid).length > 1
        ? `${path}?${new URLSearchParams({ [CLUSTER_NET_PARAM]: clusterNetworkKey(cluster) })}`
        : path;
}

/** The query parameter a list keeps its search in -- see `useSearchQueryParam`. */
export const SEARCH_PARAM = "search";

/**
 * The activity list with a search set, as a cluster's page opens it. The search is the
 * page's query and not a pattern of its own -- but a link that sets it must not spell it
 * out either.
 */
export const activitySearch = (search: string) => ({
    pathname: ROUTES.activity,
    search: `?${new URLSearchParams({ [SEARCH_PARAM]: search })}`,
});
