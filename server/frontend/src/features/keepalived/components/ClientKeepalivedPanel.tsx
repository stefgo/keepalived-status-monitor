import { Network } from "lucide-react";
import { Card } from "@stefgo/react-ui-components";
import type { KeepalivedState } from "@kasm/shared";
import { formatDate } from "../../../utils";
import { LoadingIndicator } from "../../../components/LoadingIndicator";
import { instancePath } from "../lib/vrrp";
import { VrrpInstanceView } from "./VrrpInstanceView";
import { VrrpStateBadge } from "./VrrpStateBadge";

interface ClientKeepalivedPanelProps {
    clientId: string;
    /** The client's last reading, or null before it has sent one. */
    state: KeepalivedState | null;
    online: boolean;
}

/**
 * What one host's keepalived reports: its instances and sync groups. Its state and the
 * instance counts live in the client's header, which stays on screen; an instance's counters
 * are on its own page, next to those of the other hosts in its cluster.
 */
export const ClientKeepalivedPanel = ({ clientId, state, online }: ClientKeepalivedPanelProps) => {
    if (!state) {
        return online ? (
            <LoadingIndicator label="No keepalived reading yet. Waiting for the first one from the agent…" />
        ) : (
            <Card padding="md">
                <p className="text-text-secondary">This host has not reported keepalived yet.</p>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            {!online && (
                <p className="text-sm text-warning">
                    The agent is offline. What follows is its last reading from{" "}
                    {formatDate(state.collectedAt)}, not the present state.
                </p>
            )}

            {state.instances.length > 0 && (
                <VrrpInstanceView
                    title={
                        <>
                            <Network size={18} className="text-text-muted" /> VRRP instances
                        </>
                    }
                    rows={state.instances.map((instance) => ({
                        key: instance.name,
                        instance,
                        stale: !online,
                        href: instancePath(clientId, instance.name),
                    }))}
                />
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
        </div>
    );
};
