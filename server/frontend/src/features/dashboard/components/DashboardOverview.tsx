import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Crown, Monitor, Network, ShieldCheck } from "lucide-react";
import { CLIENT_STATUS, type KeepalivedState } from "@kasm/shared";
import { Card, StatCard, StatCardGrid } from "@stefgo/react-ui-components";
import { useClients } from "../../../queries/clients";
import { QueryError } from "../../../components/QueryError";
import { useKeepalivedStates } from "../../../queries/keepalived";
import { useActivity } from "../../../queries/activity";
import { ActivityView } from "../../activity/components/ActivityView";
import { ClientList } from "../../clients/components/ClientList";
import { SEARCH_PARAM, paths } from "../../../lib/paths";
import { plural } from "../../../utils";
import { useVrrpClusters } from "../../keepalived/hooks/useVrrpClusters";
import {
    clientCount,
    clusterSummary,
    formatOnlineCount,
    hostSummary,
    instanceCount,
    needsAttention,
    problemSummary,
    unseenProblems,
} from "../lib/dashboard";
import { FindingList } from "../../keepalived/components/FindingList";
import { VrrpOverviewCard } from "../../keepalived/components/VrrpOverviewCard";
import { fleetFindings } from "../../keepalived/lib/clusterFindings";
import { FLEET_STATUS, fleetStatus, type FleetStatus } from "../../keepalived/lib/vrrpOverview";
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

/** An icon with nothing to say; one that has something takes the colour of what it says. */
const QUIET = "text-text-muted";

const toPanel = (value: string | null): Panel | null =>
    (PANELS as readonly (string | null)[]).includes(value) ? (value as Panel) : null;

const STATUS_ICON: Record<FleetStatus, string> = {
    healthy: "text-success",
    degraded: "text-warning",
    critical: "text-error",
    unknown: QUIET,
};

/**
 * The landing page, built like sadm's: how VRRP is doing, how many hosts report, how many
 * clusters and MASTERs there are and what in the activity asks for a look. Below the numbers
 * VRRP itself -- its facts and a tile per cluster with its virtual addresses -- and whatever
 * is wrong with it. All of it is there whether anything is wrong or not.
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
    const problems = useMemo(() => unseenProblems(events), [events]);
    const status = useMemo(() => fleetStatus(clusters), [clusters]);
    const findings = useMemo(() => fleetFindings(clusters), [clusters]);
    // A host that is away has no present reading: its sync groups and version are not counted.
    const readings = useMemo(
        () =>
            clients
                .filter((client) => client.status === CLIENT_STATUS.ONLINE)
                .map((client) => states[client.id])
                .filter((state): state is KeepalivedState => state !== undefined),
        [clients, states],
    );

    // Zeroes would say the fleet is empty, which is another statement altogether.
    const loadError = clientsError ?? statesError;
    if (loadError) return <QueryError title="Could not load the fleet" error={loadError} />;

    return (
        <div className="space-y-6">
            <StatCardGrid>
                <StatCard
                    label="VRRP"
                    value={FLEET_STATUS[status].label}
                    sub={findings.length > 0 ? plural(findings.length, "finding") : FLEET_STATUS[status].description}
                    icon={ShieldCheck}
                    classNames={{ icon: STATUS_ICON[status] }}
                />
                <StatCard
                    label="Hosts online"
                    value={formatOnlineCount(hosts)}
                    sub={hostSummary(hosts)}
                    icon={Monitor}
                    onClick={() => togglePanel("hosts")}
                    selected={panel === "hosts"}
                    aria-expanded={panel === "hosts"}
                    classNames={{ icon: hosts.online < hosts.total ? "text-warning" : QUIET }}
                    aria-controls={PANEL_ID}
                />
                <StatCard
                    label="VRRP clusters"
                    value={String(clusters.length)}
                    sub={clusterSummary(clusters, summary.instances)}
                    icon={Network}
                    onClick={() => togglePanel("clusters")}
                    selected={panel === "clusters"}
                    aria-expanded={panel === "clusters"}
                    classNames={{
                        icon:
                            attention.length > 0 || clusters.some((c) => c.health === "unknown")
                                ? "text-warning"
                                : QUIET,
                    }}
                    aria-controls={PANEL_ID}
                />
                <StatCard
                    label="MASTER"
                    value={String(summary.masters)}
                    sub={summary.faults > 0 ? `${summary.faults} in FAULT` : "None in FAULT"}
                    icon={Crown}
                    onClick={() => togglePanel("masters")}
                    selected={panel === "masters"}
                    aria-expanded={panel === "masters"}
                    classNames={{ icon: summary.faults > 0 ? "text-error" : QUIET }}
                    aria-controls={PANEL_ID}
                />
                <StatCard
                    label="Errors / Warnings"
                    value={String(problems.errors + problems.warnings)}
                    sub={problemSummary(problems)}
                    icon={AlertTriangle}
                    onClick={() => togglePanel("activity")}
                    selected={panel === "activity"}
                    aria-expanded={panel === "activity"}
                    classNames={{
                        icon: problems.errors > 0 ? "text-error" : problems.warnings > 0 ? "text-warning" : QUIET,
                    }}
                    aria-controls={PANEL_ID}
                />
            </StatCardGrid>

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

            <VrrpOverviewCard
                clusters={clusters}
                status={status}
                readings={readings}
                onShowAll={() => panel !== "clusters" && togglePanel("clusters")}
            />

            {findings.length > 0 && (
                <Card title="Needs attention" titleAs="h2">
                    <FindingList findings={findings} clusters={clusters} />
                </Card>
            )}
        </div>
    );
};
