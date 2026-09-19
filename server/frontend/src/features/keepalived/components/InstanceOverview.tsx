import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { Network } from "lucide-react";
import { Badge, Card, EntityHeader, type EntityDetail } from "@stefgo/react-ui-components";
import { CLIENT_STATUS, type Client, type VrrpClusterMember } from "@kasm/shared";
import { clientName, formatDate } from "../../../utils";
import { useEscapeToLeave } from "../../../hooks/useEscapeToLeave";
import { useActivityStore } from "../../../stores/useActivityStore";
import { useClientStore } from "../../../stores/useClientStore";
import { useKeepalivedStore } from "../../../stores/useKeepalivedStore";
import { LoadingIndicator } from "../../../components/LoadingIndicator";
import { NotFoundCard } from "../../../components/NotFoundCard";
import { ActivityLevelIcon } from "../../activity/components/ActivityLevelIcon";
import { activityDetail, activityMessage } from "../../activity/lib/activityText";
import { useVrrpClusters } from "../hooks/useVrrpClusters";
import { formatInterval, groupCounters, instancePath } from "../lib/vrrp";
import { ClusterCard } from "./ClusterCard";
import { Priority, Vips } from "./VrrpInstanceView";
import { VrrpStateBadge } from "./VrrpStateBadge";

/** How many of the instance's events the page lists; the rest is one link away. */
const HISTORY_LIMIT = 20;

interface InstanceOverviewProps {
    client: Client;
    instanceName: string;
}

/**
 * One VRRP instance on one host: what keepalived reports about it, the other hosts that
 * answer for the same virtual router, the counters of all of them side by side, and what
 * happened to the instance lately.
 *
 * The counters are only worth reading next to each other: what the MASTER sends, a BACKUP
 * receives, and a count that moves on one host alone is the one to look at.
 */
export const InstanceOverview = ({ client, instanceName }: InstanceOverviewProps) => {
    const { state } = useLocation();
    const clientPath = `/client/${client.id}`;
    // The instance table that opened this page says where it was; a directly opened URL
    // goes back to the host.
    const back = (state as { from?: string } | null)?.from ?? clientPath;
    useEscapeToLeave(back);

    const reading = useKeepalivedStore((s) => s.states[client.id]);
    const clusters = useVrrpClusters();
    const clients = useClientStore((s) => s.clients);
    const events = useActivityStore((s) => s.events);

    const online = client.status === CLIENT_STATUS.ONLINE;
    const instance = reading?.instances.find((i) => i.name === instanceName);

    const cluster = clusters.find((c) =>
        c.members.some((m) => m.clientId === client.id && m.instance.name === instanceName),
    );

    // This host first, then the rest in the order the cluster card shows them.
    const members: VrrpClusterMember[] = instance
        ? [
              { clientId: client.id, online, instance },
              ...(cluster?.members ?? [])
                  .filter((m) => !(m.clientId === client.id && m.instance.name === instanceName))
                  .sort((a, b) => (b.instance.effectivePriority ?? 0) - (a.instance.effectivePriority ?? 0)),
          ]
        : [];

    const history = useMemo(
        () =>
            events
                .filter(
                    (e) =>
                        e.clientId === client.id &&
                        e.subject?.instanceName === instanceName &&
                        // The activity page hides trace by default; so does this excerpt.
                        e.level !== "trace",
                )
                .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
                .slice(0, HISTORY_LIMIT),
        [events, client.id, instanceName],
    );

    if (!reading) {
        return online ? (
            <LoadingIndicator label="No keepalived reading yet. Waiting for the first one from the agent…" />
        ) : (
            <NotFoundCard title="No reading" backTo={clientPath} backLabel={`Back to ${clientName(client)}`}>
                {clientName(client)} has not reported keepalived yet.
            </NotFoundCard>
        );
    }
    if (!instance) {
        return (
            <NotFoundCard
                title="Instance not found"
                backTo={clientPath}
                backLabel={`Back to ${clientName(client)}`}
            >
                The last reading of {clientName(client)} has no VRRP instance{" "}
                <code className="font-mono text-sm">{instanceName}</code>.
            </NotFoundCard>
        );
    }

    const hostName = (clientId: string) => {
        const c = clients.find((c) => c.id === clientId);
        return c ? clientName(c) : clientId;
    };

    const details: EntityDetail[] = [
        {
            label: "Host",
            value: (
                <Link to={clientPath} className="hover:text-primary">
                    {clientName(client)}
                </Link>
            ),
            visibility: "always",
        },
        { label: "VRID", value: instance.vrid ?? "–", visibility: "always" },
        { label: "Priority", value: <Priority instance={instance} />, visibility: "always" },
        { label: "Virtual IPs", value: <Vips instance={instance} />, mono: true, visibility: "always" },
        { label: "Interface", value: instance.interface ?? "–", mono: true },
        { label: "Advertisement interval", value: formatInterval(instance.advertInterval) },
        { label: "Configured state", value: instance.wantedState ?? "–" },
        { label: "Sync group", value: instance.syncGroup ?? "–" },
        { label: "Last transition", value: formatDate(instance.lastTransition, { seconds: true }) },
        { label: "Last reading", value: formatDate(reading.collectedAt, { seconds: true }) },
    ];

    const counters = groupCounters(members.map((m) => m.instance.stats));

    return (
        <div className="space-y-6">
            <EntityHeader
                leading={<Network size={20} className="text-text-muted" />}
                title={instance.name}
                meta={
                    <>
                        <VrrpStateBadge state={instance.state} />
                        {!online && <Badge variant="warning">Offline</Badge>}
                    </>
                }
                alert={
                    !online && (
                        <p className="text-sm text-warning">
                            The agent is offline. What follows is its last reading from{" "}
                            {formatDate(reading.collectedAt)}, not the present state.
                        </p>
                    )
                }
                details={details}
                // Names the view, not the instance: one entry for every instance page.
                persist={{ key: "kasm.instance.details", scope: "local" }}
            />

            {cluster && <ClusterCard cluster={cluster} />}

            <Card title="Counters" titleAs="h3">
                {counters.length === 0 ? (
                    <p className="p-4 text-sm text-text-secondary">keepalived reported no counters for this instance.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="px-4 py-2 text-left font-medium text-text-secondary">
                                        Counter
                                    </th>
                                    {members.map((m, i) => (
                                        <th
                                            key={`${m.clientId}:${m.instance.name}`}
                                            className={`px-4 py-2 text-right font-medium whitespace-nowrap ${m.online ? "" : "opacity-60"}`}
                                        >
                                            <div className="flex items-center justify-end gap-2">
                                                {i === 0 ? (
                                                    <span className="text-text-primary">{hostName(m.clientId)}</span>
                                                ) : (
                                                    <Link
                                                        to={instancePath(m.clientId, m.instance.name)}
                                                        state={{ from: back }}
                                                        className="text-text-secondary hover:text-primary"
                                                    >
                                                        {hostName(m.clientId)}
                                                    </Link>
                                                )}
                                                <VrrpStateBadge state={m.instance.state} />
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            {counters.map((group) => (
                                <tbody key={group.title}>
                                    <tr>
                                        <th
                                            colSpan={members.length + 1}
                                            className="px-4 pt-4 pb-1 text-left text-xs font-semibold uppercase tracking-wide text-text-muted"
                                        >
                                            {group.title}
                                        </th>
                                    </tr>
                                    {group.rows.map((row) => (
                                        <tr key={row.label} className="border-t border-border first:border-t-0">
                                            <td className="px-4 py-1.5 text-text-secondary">{row.label}</td>
                                            {row.values.map((value, i) => (
                                                <td
                                                    key={i}
                                                    className={`px-4 py-1.5 text-right tabular-nums ${
                                                        row.problem && value ? "text-error font-medium" : "text-text-primary"
                                                    } ${members[i].online ? "" : "opacity-60"}`}
                                                >
                                                    {value ?? "–"}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            ))}
                        </table>
                    </div>
                )}
            </Card>

            <Card
                title="Recent activity"
                titleAs="h3"
                action={
                    <Link
                        to={`/notifications?search=${encodeURIComponent(instanceName)}`}
                        className="text-sm text-text-secondary hover:text-primary"
                    >
                        Show all
                    </Link>
                }
            >
                {history.length === 0 ? (
                    <p className="p-4 text-sm text-text-secondary">Nothing has happened to this instance yet.</p>
                ) : (
                    <ul className="divide-y divide-border">
                        {history.map((event) => {
                            const detail = activityDetail(event);
                            return (
                                <li key={event.id} className="flex items-start gap-3 px-4 py-2 text-sm">
                                    <span className="pt-0.5">
                                        <ActivityLevelIcon level={event.level} />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-text-primary">{activityMessage(event)}</div>
                                        {detail && <div className="text-xs text-text-muted">{detail}</div>}
                                    </div>
                                    <span className="whitespace-nowrap text-xs text-text-muted">
                                        {formatDate(event.occurredAt, { seconds: true })}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Card>
        </div>
    );
};
