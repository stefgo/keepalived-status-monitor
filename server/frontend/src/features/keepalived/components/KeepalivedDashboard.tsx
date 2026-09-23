import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Crown, Monitor, Network } from "lucide-react";
import { Card, StatCard } from "@stefgo/react-ui-components";
import { CLIENT_STATUS } from "@kasm/shared";
import { useClientStore } from "../../../stores/useClientStore";
import { useKeepalivedStore } from "../../../stores/useKeepalivedStore";
import { clientName } from "../../../utils";
import { useVrrpClusters } from "../hooks/useVrrpClusters";
import { ClusterCard } from "./ClusterCard";

/**
 * The landing page: how many hosts report, how many instances they run, and the clusters
 * and hosts that need a look. A healthy fleet shows four numbers and a line saying so.
 */
export const KeepalivedDashboard = () => {
    const navigate = useNavigate();
    const clients = useClientStore((s) => s.clients);
    const states = useKeepalivedStore((s) => s.states);
    const clusters = useVrrpClusters();

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
    const warnings = attention.length + summary.troubledHosts.length;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    label="Hosts online"
                    value={`${summary.online} / ${clients.length}`}
                    icon={Monitor}
                    onClick={() => navigate("/clients")}
                />
                <StatCard
                    label="VRRP clusters"
                    value={String(clusters.length)}
                    sub={`${summary.instances} instances`}
                    icon={Network}
                    onClick={() => navigate("/clusters")}
                />
                <StatCard
                    label="MASTER"
                    value={String(summary.masters)}
                    sub={summary.faults > 0 ? `${summary.faults} in FAULT` : undefined}
                    icon={Crown}
                />
                <StatCard
                    label="Warnings"
                    value={String(warnings)}
                    icon={AlertTriangle}
                    onClick={() => navigate("/activity")}
                />
            </div>

            {summary.troubledHosts.length > 0 && (
                <Card title="Hosts without a reading" titleAs="h3" padding="md">
                    <ul className="space-y-2">
                        {summary.troubledHosts.map((client) => {
                            const state = states[client.id];
                            return (
                                <li key={client.id} className="text-sm">
                                    <button
                                        type="button"
                                        className="font-medium text-text-primary hover:text-primary"
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

            {attention.length > 0 ? (
                attention.map((cluster) => <ClusterCard key={cluster.key} cluster={cluster} />)
            ) : (
                <Card padding="md">
                    <p className="text-text-secondary">
                        {clusters.length === 0
                            ? "No VRRP instances reported yet. Register an agent on a host running keepalived to see it here."
                            : "Every VRRP cluster has exactly one MASTER and all members reporting."}
                    </p>
                </Card>
            )}
        </div>
    );
};
