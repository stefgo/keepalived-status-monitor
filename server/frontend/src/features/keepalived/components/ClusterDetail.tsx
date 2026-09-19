import { ReactNode, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Network } from "lucide-react";
import { Card, EntityHeader, type EntityDetail } from "@stefgo/react-ui-components";
import type { VrrpCluster } from "@kasm/shared";
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
import {
    clusterAddressKey,
    clusterLabel,
    clusterPath,
    clusterVipLabel,
    clustersAt,
    defaultCompareSelection,
    formatInterval,
    groupCounters,
    hasProblemCounts,
    memberKey,
} from "../lib/vrrp";
import { ClusterCard } from "./ClusterCard";
import { ClusterHealthBadge } from "./ClusterHealthBadge";
import { VrrpStateBadge } from "./VrrpStateBadge";

/** How many of the cluster's events the page lists; the rest is one link away. */
const HISTORY_LIMIT = 20;

/** The sticky first column of the counter table needs its own background to cover what scrolls under it. */
const STICKY = "sticky left-0 bg-card";

interface ClusterDetailProps {
    site: string | null;
    vrid: number;
    /** `clusterAddressKey` of the cluster meant, where several share site and VRID. */
    vips: string | null;
}

/** The distinct values the members report, or a dash where none reports one. */
const distinct = (values: (string | null | undefined)[]): string =>
    [...new Set(values.filter((value): value is string => !!value))].join(", ") || "–";

/**
 * One VRRP cluster: what its hosts report about the virtual router, the hosts themselves,
 * their counters side by side, and what happened to it lately.
 *
 * The counters are only worth reading next to each other: what the MASTER sends, a BACKUP
 * receives, and a count that moves on one host alone is the one to look at. Which hosts get a
 * column is picked in the host table; a host left out that counted errors is named above the
 * counters, so the pick cannot hide it.
 */
export const ClusterDetail = ({ site, vrid, vips }: ClusterDetailProps) => {
    const { state } = useLocation();
    // The surface that opened this page says where it was; a directly opened URL goes back
    // to the cluster list.
    const back = (state as { from?: string } | null)?.from ?? "/clusters";
    useEscapeToLeave(back);

    const clusters = useVrrpClusters();
    const clients = useClientStore((s) => s.clients);
    const clientsLoading = useClientStore((s) => s.isLoading);
    const readings = useKeepalivedStore((s) => s.states);
    const events = useActivityStore((s) => s.events);

    const candidates = clustersAt(clusters, site, vrid);
    const cluster =
        vips === null
            ? candidates.length === 1
                ? candidates[0]
                : undefined
            : candidates.find((c) => clusterAddressKey(c) === vips);

    // The node that should be MASTER first, as in the member list.
    const members = useMemo(
        () =>
            [...(cluster?.members ?? [])].sort(
                (a, b) => (b.instance.effectivePriority ?? 0) - (a.instance.effectivePriority ?? 0),
            ),
        [cluster],
    );

    const history = useMemo(() => {
        const instances = new Set(members.map((m) => `${m.clientId}\n${m.instance.name}`));
        return events
            .filter(
                (e) =>
                    instances.has(`${e.clientId}\n${e.subject?.instanceName}`) &&
                    // The activity page hides trace by default; so does this excerpt.
                    e.level !== "trace",
            )
            .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
            .slice(0, HISTORY_LIMIT);
    }, [events, members]);

    // Only what the reader changed is kept, so a host that joins later still gets the default.
    // The picks belong to one cluster: moving to another page starts from its defaults.
    const [picks, setPicks] = useState<{ cluster?: string; overrides: Map<string, boolean> }>({
        overrides: new Map(),
    });
    const overrides = picks.cluster === cluster?.key ? picks.overrides : undefined;
    const defaults = useMemo(() => defaultCompareSelection(members), [members]);
    const isCompared = (key: string) => overrides?.get(key) ?? defaults.has(key);
    const pick = (keys: string[], on: boolean) =>
        setPicks({
            cluster: cluster?.key,
            overrides: new Map([...(overrides ?? []), ...keys.map((key): [string, boolean] => [key, on])]),
        });

    const label = `${site ? `${site} / ` : ""}VRID ${vrid}`;

    if (!cluster) {
        if (candidates.length > 1) return <ClusterChoice label={label} candidates={candidates} clusters={clusters} />;
        if (clientsLoading) return <LoadingIndicator />;
        return (
            <NotFoundCard title="Cluster not found" backTo="/clusters" backLabel="Back to clusters">
                No host reports a VRRP instance for {label}.
            </NotFoundCard>
        );
    }

    const hostName = (clientId: string) => {
        const c = clients.find((c) => c.id === clientId);
        return c ? clientName(c) : clientId;
    };
    const hostLink = (clientId: string) => (
        <Link to={`/client/${clientId}`} className="hover:text-primary">
            {hostName(clientId)}
        </Link>
    );
    const joined = (nodes: ReactNode[]) =>
        nodes.length === 0
            ? "–"
            : nodes.map((node, i) => (
                  <span key={i}>
                      {i > 0 && ", "}
                      {node}
                  </span>
              ));

    const online = members.filter((m) => m.online);
    const offline = members.filter((m) => !m.online);
    const masters = online.filter((m) => m.instance.state === "MASTER");
    const instances = members.map((m) => m.instance);
    const newest = (dates: (string | null | undefined)[]) =>
        dates.filter((date): date is string => !!date).sort().pop();

    const details: EntityDetail[] = [
        { label: "Site", value: cluster.site ?? "–", visibility: "always" },
        { label: "VRID", value: cluster.vrid ?? "–", visibility: "always" },
        {
            label: "Virtual IPs",
            value: cluster.vips.length > 0 ? cluster.vips.map((vip) => <div key={vip}>{vip}</div>) : "–",
            mono: true,
            visibility: "always",
        },
        { label: "MASTER", value: joined(masters.map((m) => hostLink(m.clientId))), visibility: "always" },
        { label: "Hosts", value: `${online.length} / ${members.length} online`, visibility: "always" },
        { label: "Instance", value: distinct(instances.map((i) => i.name)) },
        { label: "Interface", value: distinct(instances.map((i) => i.interface)), mono: true },
        {
            label: "Advertisement interval",
            value: distinct(instances.map((i) => (i.advertInterval == null ? null : formatInterval(i.advertInterval)))),
        },
        { label: "Sync group", value: distinct(instances.map((i) => i.syncGroup)) },
        {
            label: "Last transition",
            value: formatDate(newest(instances.map((i) => i.lastTransition)), { seconds: true }),
        },
        {
            label: "Last reading",
            value: formatDate(newest(members.map((m) => readings[m.clientId]?.collectedAt)), { seconds: true }),
        },
    ];

    const compared = members.filter((m) => isCompared(memberKey(m)));
    const hiddenErrors = members.filter((m) => !isCompared(memberKey(m)) && hasProblemCounts(m.instance.stats));
    const counters = groupCounters(compared.map((m) => m.instance.stats));
    // "Show all" searches the activity page by instance name, which only works where the
    // hosts agree on one.
    const instanceNames = [...new Set(instances.map((i) => i.name))];

    return (
        <div className="space-y-6">
            <EntityHeader
                leading={<Network size={20} className="text-text-muted" />}
                title={clusterLabel(cluster)}
                meta={<ClusterHealthBadge health={cluster.health} />}
                alert={
                    offline.length > 0 && (
                        <p className="text-sm text-warning">
                            {joined(offline.map((m) => hostLink(m.clientId)))}{" "}
                            {offline.length === 1 ? "is" : "are"} offline. What is shown for{" "}
                            {offline.length === 1 ? "it" : "them"} is the last reading, not the present state.
                        </p>
                    )
                }
                details={details}
                // Names the view, not the cluster: one entry for every cluster page.
                persist={{ key: "kasm.cluster.details", scope: "local" }}
            />

            <ClusterCard
                cluster={cluster}
                title="Hosts"
                compare={{
                    selected: isCompared,
                    onToggle: (key, on) => pick([key], on),
                    onToggleAll: (on) => pick(members.map(memberKey), on),
                }}
            />

            <Card
                title={
                    compared.length < members.length
                        ? `Counters · ${compared.length} of ${members.length} hosts`
                        : "Counters"
                }
                titleAs="h3"
            >
                {hiddenErrors.length > 0 && (
                    <p className="px-4 pt-4 text-sm text-warning">
                        {joined(hiddenErrors.map((m) => hostLink(m.clientId)))}{" "}
                        {hiddenErrors.length === 1 ? "counted errors but is" : "counted errors but are"} not
                        compared.{" "}
                        <button
                            type="button"
                            className="font-medium underline hover:text-primary"
                            onClick={() => pick(hiddenErrors.map(memberKey), true)}
                        >
                            Compare {hiddenErrors.length === 1 ? "it" : "them"}
                        </button>
                    </p>
                )}
                {compared.length === 0 ? (
                    <p className="p-4 text-sm text-text-secondary">
                        {members.some((m) => hasProblemCounts(m.instance.stats))
                            ? "Select hosts in the table above to compare their counters."
                            : "No host counted errors. Select hosts in the table above to compare their counters."}
                    </p>
                ) : counters.length === 0 ? (
                    <p className="p-4 text-sm text-text-secondary">keepalived reported no counters for this cluster.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className={`${STICKY} px-4 py-2 text-left font-medium text-text-secondary`}>
                                        Counter
                                    </th>
                                    {compared.map((m) => (
                                        <th
                                            key={`${m.clientId}:${m.instance.name}`}
                                            className={`px-4 py-2 text-right font-medium whitespace-nowrap ${m.online ? "" : "opacity-60"}`}
                                        >
                                            <div className="flex items-center justify-end gap-2">
                                                <Link
                                                    to={`/client/${m.clientId}`}
                                                    className="text-text-secondary hover:text-primary"
                                                >
                                                    {hostName(m.clientId)}
                                                </Link>
                                                <VrrpStateBadge state={m.instance.state} />
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            {counters.map((group) => (
                                <tbody key={group.title}>
                                    <tr>
                                        {/* Only the first cell is sticky, so the title stays in view while the rest scrolls. */}
                                        <th
                                            className={`${STICKY} whitespace-nowrap px-4 pt-4 pb-1 text-left text-xs font-semibold uppercase tracking-wide text-text-muted`}
                                        >
                                            {group.title}
                                        </th>
                                        <td colSpan={compared.length} />
                                    </tr>
                                    {group.rows.map((row) => (
                                        <tr key={row.label} className="border-t border-border first:border-t-0">
                                            <td className={`${STICKY} px-4 py-1.5 text-text-secondary`}>{row.label}</td>
                                            {row.values.map((value, i) => (
                                                <td
                                                    key={i}
                                                    className={`px-4 py-1.5 text-right tabular-nums ${
                                                        row.problem && value ? "text-error font-medium" : "text-text-primary"
                                                    } ${compared[i].online ? "" : "opacity-60"}`}
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
                    instanceNames.length === 1 && (
                        <Link
                            to={`/notifications?search=${encodeURIComponent(instanceNames[0])}`}
                            className="text-sm text-text-secondary hover:text-primary"
                        >
                            Show all
                        </Link>
                    )
                }
            >
                {history.length === 0 ? (
                    <p className="p-4 text-sm text-text-secondary">Nothing has happened to this cluster yet.</p>
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
                                        <div className="text-text-primary">
                                            {/* Always set: the filter above matched it against a member. */}
                                            {event.clientId && (
                                                <span className="text-text-secondary">{hostName(event.clientId)} · </span>
                                            )}
                                            {activityMessage(event)}
                                        </div>
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

/**
 * Several clusters behind one site and VRID -- separate segments of one site, told apart by
 * their addresses. The page lets the reader pick one rather than guess.
 */
const ClusterChoice = ({
    label,
    candidates,
    clusters,
}: {
    label: string;
    candidates: VrrpCluster[];
    clusters: VrrpCluster[];
}) => {
    const { state } = useLocation();

    return (
        <Card title={`${label} is used by ${candidates.length} clusters`} padding="md" classNames={{ content: "space-y-4" }}>
            <p className="text-text-secondary">
                These clusters share the VRID but answer for different virtual addresses. Pick one.
            </p>
            <ul className="space-y-2">
                {candidates.map((candidate) => (
                    <li key={candidate.key} className="flex flex-wrap items-center gap-2 text-sm">
                        <Link
                            to={clusterPath(candidate, clusters) ?? "/clusters"}
                            state={state}
                            className="font-mono text-text-primary hover:text-primary"
                        >
                            {clusterVipLabel(candidate)}
                        </Link>
                        <ClusterHealthBadge health={candidate.health} />
                        <span className="text-text-muted">
                            {candidate.members.length} {candidate.members.length === 1 ? "host" : "hosts"}
                        </span>
                    </li>
                ))}
            </ul>
        </Card>
    );
};
