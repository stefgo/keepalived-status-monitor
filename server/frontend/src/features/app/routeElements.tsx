import { ReactNode } from "react";
import { Navigate, Outlet, generatePath, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { LoadingIndicator } from "@stefgo/react-ui-components";
import type { Client } from "@kasm/shared";

import Login from "../../pages/Login";
import { NotFoundCard } from "../../components/NotFoundCard";
import { QueryError } from "../../components/QueryError";
import { useAuth } from "../auth/AuthContext";
import { useBackPath } from "../../hooks/useBackPath";
import { NotFoundError } from "../../lib/notFound";
import { CLUSTER_NET_PARAM, ROUTES, clusterPath, paths } from "../../lib/paths";
import { queryClient } from "../../lib/queryClient";
import {
    useClient,
    useClients,
    useCreateOutboundClient,
    useDeleteClient,
    useUpdateClient,
} from "../../queries/clients";
import { useKeepalivedStates } from "../../queries/keepalived";
import { tokenListOptions } from "../../queries/tokens";
import { useVrrpClusters } from "../keepalived/hooks/useVrrpClusters";
import { clusterOf } from "../keepalived/lib/vrrp";
import { useRouteClient } from "./routeContext";
import { AddClientWizard, ClientEditor, ClientOverview, ClusterDetail, ManagedClients } from "./lazyPages";

// ---------------------------------------------------------------------------
// What the route tree in `routes.tsx` renders. Each element pulls what it needs
// from the query cache itself; none of them knows a path -- those come from
// `lib/paths.ts`, and "back" from the tree through `useBackPath`.
// ---------------------------------------------------------------------------

export function ProtectedRoute({ children }: { children: ReactNode }) {
    const { isAuthenticated } = useAuth();
    if (!isAuthenticated) {
        return <Navigate to={ROUTES.login} replace />;
    }
    return <>{children}</>;
}

export function LoginRoute() {
    const { isAuthenticated } = useAuth();
    return isAuthenticated ? <Navigate to={ROUTES.root} /> : <Login />;
}

export function NotFound() {
    const { pathname } = useLocation();

    return (
        <NotFoundCard title="Page not found" backTo={ROUTES.clients} backLabel="Back to clients">
            There is nothing at <code className="font-mono text-sm">{pathname}</code>.
        </NotFoundCard>
    );
}

/**
 * An address from before the client pages took the plural of their list (`LEGACY_ROUTES`),
 * sent on to the pattern that replaced it. The parameters keep their names; query and
 * fragment travel along, and the old address leaves the history.
 */
export function LegacyRedirect({ to }: { to: string }) {
    const params = useParams();
    const { search, hash } = useLocation();
    const pathname = generatePath(to, params as Record<string, string>);

    return <Navigate to={{ pathname, search, hash }} replace />;
}

// --- Clients ---------------------------------------------------------------

export function ClientsRoute() {
    const navigate = useNavigate();
    const { clients, error, refetch } = useClients();
    const deleteClient = useDeleteClient();

    // Instead of the list: an empty one would say no client is registered.
    if (error) return <QueryError title="Could not load the clients" error={error} />;

    return (
        <ManagedClients
            clients={clients}
            onSelect={(c) => navigate(c ? paths.client(c.id) : ROUTES.clients)}
            onRefresh={() => {
                void refetch();
            }}
            onDelete={(id) => deleteClient.mutateAsync(id)}
            onAdd={() => navigate(ROUTES.clientNew)}
            onEdit={(c) => navigate(paths.clientEdit(c.id))}
        />
    );
}

export function AddClientRoute() {
    const navigate = useNavigate();
    const back = useBackPath();
    const createOutboundClient = useCreateOutboundClient();

    return (
        <AddClientWizard
            onClose={() => navigate(back)}
            onCreateOutbound={(data) => createOutboundClient.mutateAsync(data)}
            onTokenCreated={() => void queryClient.invalidateQueries({ queryKey: tokenListOptions.queryKey })}
        />
    );
}

/**
 * The layout route at `/clients/:clientId`: resolves the client once for everything below
 * it and hands it down as the outlet context (`useRouteClient`).
 *
 * The client comes from the cached list. While that is pending this shows the spinner: a
 * reloaded or shared URL renders before the first fetch returns, and an empty list then
 * says nothing about whether the client exists. Only after that is a missing client
 * really gone -- a stale bookmark or a deleted client gets the not-found card, and the URL
 * stays where it was. The routes used to show the client list in both cases, under an
 * address that named a client.
 */
export function ClientBoundary() {
    const { clientId } = useParams();
    const { isPending, error } = useClients();
    const client = useClient(clientId);

    if (!client) {
        // Not "not found": without the list nothing says whether the client exists.
        if (error) return <QueryError title="Could not load the client" error={error} />;
        if (isPending) return <LoadingIndicator label="Loading client…" />;
        throw new NotFoundError("client");
    }
    return <Outlet context={client satisfies Client} />;
}

export function ClientDetailRoute() {
    return <ClientOverview client={useRouteClient()} />;
}

export function ClientEditRoute() {
    const client = useRouteClient();
    // Optimistic: the list shows the change at once and takes it back if the server refuses.
    const { mutateAsync: updateClient } = useUpdateClient();

    return <ClientEditor client={client} onSave={(clientId, data) => updateClient({ clientId, data })} />;
}

/**
 * The page of one host's instance, which the cluster page has replaced. An old link lands
 * on the cluster the instance takes part in -- once the readings are in, which is why this
 * waits on them rather than giving up on the first render.
 */
export function ClientInstanceRoute() {
    const client = useRouteClient();
    // Decoded by the router already.
    const { instanceName = "" } = useParams();
    const clusters = useVrrpClusters();
    const { isPending, error } = useKeepalivedStates();

    const cluster = clusterOf(clusters, client.id, instanceName);
    const path = cluster && clusterPath(cluster, clusters);
    if (!path) {
        if (error) return <QueryError title="Could not load the keepalived readings" error={error} />;
        if (isPending) return <LoadingIndicator />;
        return (
            <NotFoundCard title="Instance not found" backTo={paths.client(client.id)} backLabel="Back to the host">
                No cluster has the VRRP instance <code className="font-mono text-sm">{instanceName}</code> of this
                host.
            </NotFoundCard>
        );
    }
    return <Navigate to={path} replace />;
}

// --- Clusters --------------------------------------------------------------

/** `/clusters/<vrid>` or `/clusters/<site>/<vrid>`; `?net=` where several clusters share both. */
export function ClusterRoute() {
    // Decoded by the router already.
    const { site, vrid = "" } = useParams();
    const [searchParams] = useSearchParams();
    if (!/^\d+$/.test(vrid)) return <NotFound />;

    // A cluster that no host reports is the cluster page's own case: it is derived from the
    // readings and comes back with the next one, so the page says so and stays.
    return <ClusterDetail site={site ?? null} vrid={Number(vrid)} net={searchParams.get(CLUSTER_NET_PARAM)} />;
}
