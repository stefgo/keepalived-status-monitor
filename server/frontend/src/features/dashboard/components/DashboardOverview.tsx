import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Crown, Monitor, Network } from "lucide-react";
import { StatCard } from "@stefgo/react-ui-components";
import { useClients } from "../../../queries/clients";
import { QueryError } from "../../../components/QueryError";
import { useKeepalivedStates } from "../../../queries/keepalived";
import { useActivity } from "../../../queries/activity";
import { ActivityView } from "../../activity/components/ActivityView";
import { ClientList } from "../../clients/components/ClientList";
import { SEARCH_PARAM, paths } from "../../../lib/paths";
import { useVrrpClusters } from "../../keepalived/hooks/useVrrpClusters";
import { clientCount, formatOnlineCount, instanceCount, needsAttention, unseenProblems } from "../lib/dashboard";
import { ClusterCard } from "../../keepalived/components/ClusterCard";
import { ClusterOverview } from "../../keepalived/components/ClusterOverview";
import { MasterList } from "../../keepalived/components/MasterList";

/**
 * The list a card opens beneath the cards. One at a time: the lists keep their search in
 * the same `search` parameter, so two open at once would filter each other. Kept in the
 * `panel` parameter, so the open list survives a reload and travels with a shared link.
 */
const PANELS = ["hosts", "clusters", "masters", "activity"] as const;
type Panel = (typeof PANELS)[number];
const PANEL_PARAM = "panel";
const PANEL_ID = "dashboard-panel";

const toPanel = (value: string | null): Panel | null =>
    (PANELS as readonly (string | null)[]).includes(value) ? (value as Panel) : null;

/**
 * The landing page: how many hosts report, how many instances they run, and the clusters
 * that need a look. A healthy fleet shows the four numbers and nothing else.
 */
export const DashboardOverview = () => {
    const navigate = useNavigate();
    const { clients, error: clientsError } = useClients();
    const { states, error: statesError } = useKeepalivedStates();
    const clusters = useVrrpClusters();
    const { events } = useActivity();
    const [searchParams, setSearchParams] = useSearchParams();
    const panel = toPanel(searchParams.get(PANEL_PARAM));
    // A second click on the open card closes its list again. The search is dropped either
    // way: a host name typed into one list would otherwise filter the next one to nothing.
    // One write for both: two `setSearchParams` in a row would each start from the same URL,
    // and the second would undo the first. It replaces the history entry, as the search does.
    const togglePanel = (next: Panel) => {
        setSearchParams(
            (prev) => {
                const params = new URLSearchParams(prev);
                if (toPanel(prev.get(PANEL_PARAM)) === next) {
                    params.delete(PANEL_PARAM);
                } else {
                    params.set(PANEL_PARAM, next);
                }
                params.delete(SEARCH_PARAM);
                return params;
            },
            { replace: true },
        );
    };

    const hosts = useMemo(() => clientCount(clients), [clients]);
    const summary = useMemo(() => instanceCount(clients, states), [clients, states]);
    const attention = useMemo(() => needsAttention(clusters), [clusters]);
    const unseenWarnings = useMemo(() => unseenProblems(events), [events]);

    // Four zeroes would say the fleet is empty, which is another statement altogether.
    const loadError = clientsError ?? statesError;
    if (loadError) return <QueryError title="Could not load the fleet" error={loadError} />;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                <StatCard
                    label="Hosts online"
                    value={formatOnlineCount(hosts)}
                    icon={Monitor}
                    onClick={() => togglePanel("hosts")}
                    selected={panel === "hosts"}
                    aria-controls={PANEL_ID}
                />
                <StatCard
                    label="VRRP clusters"
                    value={String(clusters.length)}
                    sub={`${summary.instances} instances`}
                    icon={Network}
                    onClick={() => togglePanel("clusters")}
                    selected={panel === "clusters"}
                    aria-controls={PANEL_ID}
                />
                <StatCard
                    label="MASTER"
                    value={String(summary.masters)}
                    sub={summary.faults > 0 ? `${summary.faults} in FAULT` : undefined}
                    icon={Crown}
                    onClick={() => togglePanel("masters")}
                    selected={panel === "masters"}
                    aria-controls={PANEL_ID}
                />
                <StatCard
                    label="Errors / Warnings"
                    value={String(unseenWarnings)}
                    icon={AlertTriangle}
                    onClick={() => togglePanel("activity")}
                    selected={panel === "activity"}
                    aria-controls={PANEL_ID}
                />
            </div>

            {panel && (
                <div id={PANEL_ID}>
                    {panel === "hosts" && (
                        <ClientList
                            clients={clients}
                            setSelectedClient={(client) => client && navigate(paths.client(client.id))}
                        />
                    )}
                    {panel === "clusters" && <ClusterOverview />}
                    {panel === "masters" && <MasterList />}
                    {panel === "activity" && <ActivityView initialLevel="warning" />}
                </div>
            )}

            <div className="space-y-6">
                {attention.map((cluster) => (
                    <ClusterCard key={cluster.key} cluster={cluster} />
                ))}
            </div>
        </div>
    );
};
