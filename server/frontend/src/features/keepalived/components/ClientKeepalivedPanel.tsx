import { Network } from "lucide-react";
import { Card } from "@stefgo/react-ui-components";
import type { KeepalivedState } from "@kasm/shared";
import { LoadingIndicator } from "../../../components/LoadingIndicator";
import { instancePath } from "../lib/vrrp";
import { VrrpInstanceView } from "./VrrpInstanceView";
import { VrrpStateBadge } from "./VrrpStateBadge";

interface ClientKeepalivedPanelProps {
    clientId: string;
    /** The client's last reading, or null before it has sent one. */
    state: KeepalivedState | null;
}

/**
 * What one host's keepalived reports: its instances and sync groups. Its state lives in
 * the client's header, which stays on screen; an instance's counters are on its own page,
 * next to those of the other hosts in its cluster. Only shown while the agent is online:
 * an offline host's last reading is not the present state.
 *
 * Nothing at all where keepalived is not running -- the header's badge says so -- or could
 * not be read: its error is in the header, and an empty table would claim there is no VRRP.
 */
export const ClientKeepalivedPanel = ({ clientId, state }: ClientKeepalivedPanelProps) => {
    if (!state) {
        return <LoadingIndicator label="No keepalived reading yet. Waiting for the first one from the agent…" />;
    }
    if (!state.running || state.error) return null;

    return (
        <div className="space-y-6">
            <VrrpInstanceView
                title={
                    <>
                        <Network size={18} className="text-text-muted" /> VRRP instances
                    </>
                }
                rows={state.instances.map((instance) => ({
                    key: instance.name,
                    instance,
                    href: instancePath(clientId, instance.name),
                }))}
                emptyMessage="No VRRP instances found."
            />

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
