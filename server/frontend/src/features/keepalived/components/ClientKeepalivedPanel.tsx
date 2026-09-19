import { Activity, AlertTriangle, Crown, ShieldCheck } from "lucide-react";
import { Card, Collapsible, StatCard } from "@stefgo/react-ui-components";
import type { KeepalivedState } from "@kasm/shared";
import { formatDate } from "../../../utils";
import { LoadingIndicator } from "../../../components/LoadingIndicator";
import { statLabel } from "../lib/vrrp";
import { VrrpInstanceTable } from "./VrrpInstanceTable";
import { VrrpStateBadge } from "./VrrpStateBadge";

interface ClientKeepalivedPanelProps {
    /** The client's last reading, or null before it has sent one. */
    state: KeepalivedState | null;
    online: boolean;
}

/** What one host's keepalived reports: its instances, sync groups and counters. */
export const ClientKeepalivedPanel = ({ state, online }: ClientKeepalivedPanelProps) => {
    if (!state) {
        return online ? (
            <LoadingIndicator label="No keepalived reading yet. Waiting for the first one from the agent…" />
        ) : (
            <Card padding="md">
                <p className="text-text-secondary">This host has not reported keepalived yet.</p>
            </Card>
        );
    }

    const masters = state.instances.filter((instance) => instance.state === "MASTER").length;
    const faults = state.instances.filter((instance) => instance.state === "FAULT").length;
    const withStats = state.instances.filter(
        (instance) => instance.stats && Object.keys(instance.stats).length > 0,
    );

    return (
        <div className="space-y-6">
            {!online && (
                <p className="text-sm text-warning">
                    The agent is offline. What follows is its last reading from{" "}
                    {formatDate(state.collectedAt)}, not the present state.
                </p>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    label="keepalived"
                    value={state.running ? (state.error ? "Unreadable" : "Running") : "Stopped"}
                    sub={state.pid ? `PID ${state.pid}` : undefined}
                    icon={ShieldCheck}
                />
                <StatCard label="Instances" value={String(state.instances.length)} icon={Activity} />
                <StatCard label="MASTER" value={String(masters)} icon={Crown} />
                <StatCard label="FAULT" value={String(faults)} icon={AlertTriangle} />
            </div>

            {state.error && (
                <Card padding="md">
                    <p className="text-error text-sm">{state.error}</p>
                </Card>
            )}

            {state.instances.length > 0 && (
                <Card title="VRRP instances" titleAs="h3">
                    <VrrpInstanceTable
                        rows={state.instances.map((instance) => ({
                            key: instance.name,
                            instance,
                            stale: !online,
                        }))}
                    />
                </Card>
            )}

            {state.syncGroups.length > 0 && (
                <Card title="Sync groups" titleAs="h3" padding="md">
                    <ul className="space-y-2">
                        {state.syncGroups.map((group) => (
                            <li key={group.name} className="flex flex-wrap items-center gap-2 text-sm">
                                <span className="font-medium text-text-primary">{group.name}</span>
                                <VrrpStateBadge state={group.state} />
                                <span className="text-text-secondary">{group.instances.join(", ")}</span>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}

            {withStats.length > 0 && (
                <Card title="Counters" titleAs="h3" padding="md" classNames={{ content: "space-y-2" }}>
                    {withStats.map((instance) => (
                        <Collapsible key={instance.name} title={instance.name}>
                            <dl className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-sm">
                                {Object.entries(instance.stats ?? {}).map(([key, value]) => (
                                    <div key={key} className="flex justify-between gap-4">
                                        <dt className="text-text-secondary">{statLabel(key)}</dt>
                                        <dd className="font-mono text-text-primary">{value}</dd>
                                    </div>
                                ))}
                            </dl>
                        </Collapsible>
                    ))}
                </Card>
            )}
        </div>
    );
};
