import { ReactNode, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Network } from "lucide-react";
import { Card, EntityHeader, type EntityDetail } from "@stefgo/react-ui-components";
import { mismatchedVips, type VrrpCluster } from "@kasm/shared";
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
    clusterNetworkKey,
    clusterLabel,
    clusterPath,
    clusterVipLabel,
    clustersAt,
    defaultCompareSelection,
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
/** The same for a group heading, on the band's background. */
const GROUP_STICKY = "sticky left-0 bg-hover";

interface ClusterDetailProps {
    site: string | null;
    vrid: number;
    /** `clusterNetworkKey` of the cluster meant, where several share site and VRID. */
    net: string | null;
}

/**
 * One VRRP cluster: what its hosts report about the virtual router, the hosts themselves,
 * their counters side by side, and what happened to it lately.
 *
 * The counters are only worth reading next to each other: what the MASTER sends, a BACKUP
 * receives, and a count that moves on one host alone is the one to look at. Which hosts get a
 * column is picked in the host table.
 */
export const ClusterDetail = ({ site, vrid, net }: ClusterDetailProps) => {
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
        net === null
            ? candidates.length === 1
                ? candidates[0]
                : undefined
            : candidates.find((c) => clusterNetworkKey(c) === net);

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
    // Where errors were counted, the counters open on their groups alone; the cluster whose
    // key is stored here shows all of them. Another cluster starts narrowed again.
    const [allGroupsOf, setAllGroupsOf] = useState<string>();
    const allGroups = allGroupsOf !== undefined && allGroupsOf === cluster?.key;

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

    const offline = members.filter((m) => !m.online);
    // Hosts that do not carry the cluster's full address list. Offline ones count too: what
    // is wrong here is the configuration, not the state.
    const mismatched = mismatchedVips(members);
    const instances = members.map((m) => m.instance);
    const newest = (dates: (string | null | undefined)[]) =>
        dates.filter((date): date is string => !!date).sort().pop();

    const details: EntityDetail[] = [
        { label: "Site", value: cluster.site ?? "–", visibility: "always" },
        { label: "VRID", value: cluster.vrid ?? "–", visibility: "always" },
        {
            // What identifies the cluster, next to site and VRID: the segment its addresses
            // sit on. Two clusters of one site and VRID are told apart by exactly this. The
            // addresses themselves belong to the host that carries them, so they are a
            // column of the table below rather than a line here.
            label: "Network",
            value:
                cluster.networks.length > 0 ? cluster.networks.map((net) => <div key={net}>{net}</div>) : "–",
            mono: true,
            visibility: "always",
        },
        {
            label: "Last reading",
            value: formatDate(newest(members.map((m) => readings[m.clientId]?.collectedAt)), { seconds: true }),
            visibility: "always",
        },
    ];

    const compared = members.filter((m) => isCompared(memberKey(m)));
    const allCounters = groupCounters(compared.map((m) => m.instance.stats));
    const errorGroups = allCounters.filter((group) =>
        group.rows.some((row) => row.problem && row.values.some((value) => (value ?? 0) > 0)),
    );
    const narrowed = errorGroups.length > 0 && !allGroups;
    const counters = narrowed ? errorGroups : allCounters;
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
                    (offline.length > 0 || mismatched.length > 0) && (
                        <div className="space-y-2">
                            {mismatched.length > 0 && (
                                <div className="space-y-1 text-sm text-error">
                                    <p>
                                        The hosts do not agree on the addresses of this virtual router.
                                        keepalived never compares them, so whichever host is MASTER serves
                                        its own list and the rest stays down.
                                    </p>
                                    <ul className="space-y-1">
                                        {mismatched.map(({ member, missing }) => (
                                            <li key={memberKey(member)}>
                                                {hostLink(member.clientId)} does not serve{" "}
                                                <span className="font-mono">{missing.join(", ")}</span>.
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {offline.length > 0 && (
                                <p className="text-sm text-warning">
                                    {joined(offline.map((m) => hostLink(m.clientId)))}{" "}
                                    {offline.length === 1 ? "is" : "are"} offline. What is shown for{" "}
                                    {offline.length === 1 ? "it" : "them"} is the last reading, not the present
                                    state.
                                </p>
                            )}
                        </div>
                    )
                }
                // Every one of them is shown, so there is nothing for a "Show more" to
                // remember and no `persist` key to keep.
                details={details}
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
                action={
                    errorGroups.length > 0 && (
                        <button
                            type="button"
                            className="text-sm text-text-secondary hover:text-primary"
                            onClick={() => setAllGroupsOf(narrowed ? cluster.key : undefined)}
                        >
                            {narrowed ? "Show all" : "Show errors only"}
                        </button>
                    )
                }
            >
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
                                {/* Host and state look like the counter rows below; they are headers only to the markup. */}
                                <tr>
                                    <th className={`${STICKY} px-4 py-1.5 text-left font-normal text-text-secondary`}>
                                        Host
                                    </th>
                                    {compared.map((m) => (
                                        <th
                                            key={memberKey(m)}
                                            className={`px-4 py-1.5 text-right font-normal whitespace-nowrap text-text-primary ${m.online ? "" : "opacity-60"}`}
                                        >
                                            <Link to={`/client/${m.clientId}`} className="hover:text-primary">
                                                {hostName(m.clientId)}
                                            </Link>
                                        </th>
                                    ))}
                                </tr>
                                <tr className="border-t border-border">
                                    <th className={`${STICKY} px-4 py-1.5 text-left font-normal text-text-secondary`}>
                                        State
                                    </th>
                                    {compared.map((m) => (
                                        <th
                                            key={memberKey(m)}
                                            className={`px-4 py-1.5 text-right font-normal ${m.online ? "" : "opacity-60"}`}
                                        >
                                            <VrrpStateBadge state={m.instance.state} />
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            {counters.map((group) => (
                                <tbody key={group.title}>
                                    {/* A band across the table, so a group reads as a heading and not as one more counter. */}
                                    <tr className="border-y border-border bg-hover">
                                        {/* Only the first cell is sticky, so the title stays in view while the rest scrolls. */}
                                        <th
                                            className={`${GROUP_STICKY} whitespace-nowrap px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-primary`}
                                        >
                                            {group.title}
                                        </th>
                                        <td colSpan={compared.length} />
                                    </tr>
                                    {group.rows.map((row) => (
                                        <tr key={row.label} className="border-t border-border">
                                            <td className={`${STICKY} py-1.5 pr-4 pl-8 text-text-secondary`}>{row.label}</td>
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
 * Several clusters behind one site and VRID: separate network segments reusing the VRID,
 * which is allowed -- a VRID is unique per broadcast domain only. The page lets the reader
 * pick one rather than guess. Hosts that merely disagree about their addresses do not end up
 * here; they are one cluster, flagged as a mismatch.
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
                These clusters share the VRID but sit on different networks. Pick one.
            </p>
            <ul className="space-y-2">
                {candidates.map((candidate) => (
                    <li key={candidate.key} className="flex flex-wrap items-center gap-2 text-sm">
                        <Link
                            to={clusterPath(candidate, clusters) ?? "/clusters"}
                            state={state}
                            className="font-mono text-text-primary hover:text-primary"
                        >
                            {candidate.networks.join(", ") || clusterVipLabel(candidate)}
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
