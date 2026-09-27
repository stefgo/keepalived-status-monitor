import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Crown, Monitor, Network } from "lucide-react";
import { Card, FOCUS_RING, StatCard, cn } from "@stefgo/react-ui-components";
import { ACTIVITY_LEVELS, CLIENT_STATUS } from "@kasm/shared";
import { useClientStore } from "../../../stores/useClientStore";
import { useKeepalivedStore } from "../../../stores/useKeepalivedStore";
import { useActivityStore } from "../../../stores/useActivityStore";
import { clientName } from "../../../utils";
import { ActivityView } from "../../activity/components/ActivityView";
import { groupActivity } from "../../activity/lib/groupActivity";
import { ClientList } from "../../clients/components/ClientList";
import { useVrrpClusters } from "../hooks/useVrrpClusters";
import { ClusterCard } from "./ClusterCard";
import { ClusterOverview } from "./ClusterOverview";
import { MasterList } from "./MasterList";

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
 * and hosts that need a look. A healthy fleet shows the four numbers and nothing else.
 */
export const KeepalivedDashboard = () => {
    const navigate = useNavigate();
    const clients = useClientStore((s) => s.clients);
    const states = useKeepalivedStore((s) => s.states);
    const clusters = useVrrpClusters();
    const events = useActivityStore((s) => s.events);
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
                params.delete("search");
                return params;
            },
            { replace: true },
        );
    };

    const summary = useMemo(() => {
        const online = clients.filter((client) => client.status === CLIENT_STATUS.ONLINE);
        const onlineStates = online.map((client) => states[client.id]).filter(Boolean);
        const instances = onlineStates.flatMap((state) => state.instances);
        const troubledHosts = online.filter((client) => {
            const state = states[client.id];
            return state && (!state.running || state.error);
        });
        return {
            online: online.length,
            instances: instances.length,
            masters: instances.filter((instance) => instance.state === "MASTER").length,
            faults: instances.filter((instance) => instance.state === "FAULT").length,
            troubledHosts,
        };
    }, [clients, states]);

    const attention = clusters.filter((cluster) => cluster.health !== "ok" && cluster.health !== "unknown");

    // What the activity list opens on from the Errors / Warnings card: unseen rows at warning
    // and above, counted as rows -- grouped the way the list groups them.
    const unseenWarnings = useMemo(() => {
        const warning = ACTIVITY_LEVELS.indexOf("warning");
        return groupActivity(events).filter(
            (group) => group.unseen && ACTIVITY_LEVELS.indexOf(group.level) >= warning,
        ).length;
    }, [events]);

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    label="Hosts online"
                    value={`${summary.online} / ${clients.length}`}
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
                            setSelectedClient={(client) => client && navigate(`/client/${client.id}`)}
                        />
                    )}
                    {panel === "clusters" && <ClusterOverview />}
                    {panel === "masters" && <MasterList />}
                    {panel === "activity" && <ActivityView initialLevel="warning" />}
                </div>
            )}

            <div className="space-y-6">
                {summary.troubledHosts.length > 0 && (
                    <Card title="Hosts without a reading" titleAs="h3" padding="md">
                        <ul className="space-y-2">
                            {summary.troubledHosts.map((client) => {
                                const state = states[client.id];
                                return (
                                    <li key={client.id} className="text-sm">
                                        <button
                                            type="button"
                                            className={cn("rounded-sm font-medium text-text-primary hover:text-primary", FOCUS_RING)}
                                            onClick={() => navigate(`/client/${client.id}`)}
                                        >
                                            {clientName(client)}
                                        </button>
                                        <span className="text-text-secondary">
                                            {" — "}
                                            {state?.running ? state.error : "keepalived is not running"}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </Card>
                )}

                {attention.map((cluster) => (
                    <ClusterCard key={cluster.key} cluster={cluster} />
                ))}
            </div>
        </div>
    );
};
