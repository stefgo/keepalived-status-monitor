import { ReactNode, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Network } from "lucide-react";
import {
    Card,
    DataTreeTable,
    EntityHeader,
    FOCUS_RING,
    cn,
    type DataTableDef,
    type EntityDetail,
    LoadingIndicator,
} from "@stefgo/react-ui-components";
import { activityDetail, activityMessage, mismatchedVips, type VrrpCluster } from "@kasm/shared";
import { RelativeTime } from "../../../components/RelativeTime";
import { useBackPath } from "../../../hooks/useBackPath";
import { useEscapeToLeave } from "../../../hooks/useEscapeToLeave";
import { useActivity } from "../../../queries/activity";
import { useClients } from "../../../queries/clients";
import { QueryError } from "../../../components/QueryError";
import { useKeepalivedStates } from "../../../queries/keepalived";
import { HeaderBreadcrumb } from "../../app/HeaderBreadcrumb";
import { ENTITY_HEADER } from "../../../components/entityHeader";
import { NotFoundCard } from "../../../components/NotFoundCard";
import { ActivityLevelIcon } from "../../activity/components/ActivityLevelIcon";
import { ROUTES, activitySearch, clusterPath, paths } from "../../../lib/paths";
import { useVrrpClusters } from "../hooks/useVrrpClusters";
import {
    clusterNetworkKey,
    clusterLabel,
    clusterVipLabel,
    clustersAt,
    defaultCompareSelection,
    groupCounters,
    memberKey,
    memberStale,
    rebaseCounters,
    type CounterBaseline,
    type CounterRow,
} from "../lib/vrrp";
import { ClusterCard } from "./ClusterCard";
import { ClusterHealthBadge } from "./ClusterHealthBadge";
import { VrrpStateBadge } from "./VrrpStateBadge";

/** How many of the cluster's events the page lists; the rest is one link away. */
const HISTORY_LIMIT = 20;

/**
 * One row of the counter table: a group on the first level, drawn as a band across the table,
 * and its counters underneath. The tree is what gives a group its heading row -- the table
 * itself knows one row per item and nothing in between.
 */
type CounterTableRow =
    | { kind: "group"; key: string; title: string; children: CounterTableRow[] }
    | { kind: "counter"; key: string; row: CounterRow };

/** Before a cluster has been seen there is nothing to measure from. */
const NO_BASELINE: CounterBaseline = new Map();

/** The sticky first column needs its own background to cover what scrolls under it. */
const stickyCell = (row: CounterTableRow) =>
    cn("sticky left-0", row.kind === "group" ? "bg-hover" : "bg-card");

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
    // Back is the cluster list, wherever the page was opened from. Without the query: `net`
    // names this cluster and means nothing to the list.
    useEscapeToLeave(useBackPath({ keepSearch: false }));

    const clusters = useVrrpClusters();
    const { isPending: clientsLoading, error: clientsError } = useClients();
    const { states: readings, isPending: readingsLoading, error: readingsError } = useKeepalivedStates();
    const { events } = useActivity();

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

    // What the counters stood at when this page first saw each host, so a counter that
    // moves says by how much: keepalived's own numbers are sums since its start, and a 3
    // that has been there for weeks looks like one that is counting. Kept in memory and per
    // cluster, like the picks; reseeded while rendering, since it follows the readings.
    const [base, setBase] = useState<{ cluster?: string; counters: CounterBaseline }>({ counters: NO_BASELINE });
    const baseline = cluster && base.cluster === cluster.key ? base.counters : NO_BASELINE;
    const rebased = rebaseCounters(baseline, members);
    if (cluster && (base.cluster !== cluster.key || rebased !== baseline)) {
        setBase({ cluster: cluster.key, counters: rebased });
    }

    const label = `${site ? `${site} / ` : ""}VRID ${vrid}`;

    if (!cluster) {
        if (candidates.length > 1) return <ClusterChoice label={label} candidates={candidates} clusters={clusters} />;
        // Without the list or the readings nothing says whether the cluster exists.
        const loadError = clientsError ?? readingsError;
        if (loadError) return <QueryError title="Could not load the cluster" error={loadError} />;
        if (clientsLoading || readingsLoading) return <LoadingIndicator />;
        return (
            <NotFoundCard title="Cluster not found" backTo={ROUTES.clusters} backLabel="Back to clusters">
                No host reports a VRRP instance for {label}.
            </NotFoundCard>
        );
    }

    // For what names a host by its id alone -- an event, a member picked out by a check.
    const hostName = (clientId: string) => members.find((m) => m.clientId === clientId)?.hostName ?? clientId;
    const hostLink = (clientId: string) => (
        <Link to={paths.client(clientId)} className={cn("rounded-sm hover:text-primary", FOCUS_RING)}>
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
    // Online, but keepalived on the host is stopped or cannot be read.
    const silent = members.filter((m) => m.online && !m.reporting);
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
            value: <RelativeTime date={newest(members.map((m) => readings[m.clientId]?.collectedAt))} seconds />,
            visibility: "always",
        },
    ];

    const compared = members.filter((m) => isCompared(memberKey(m)));
    const allCounters = groupCounters(
        compared.map((m) => m.instance.stats),
        compared.map((m) => rebased.get(memberKey(m))),
    );
    const errorGroups = allCounters.filter((group) =>
        group.rows.some((row) => row.problem && row.values.some((value) => (value ?? 0) > 0)),
    );
    const narrowed = errorGroups.length > 0 && !allGroups;
    const counters = narrowed ? errorGroups : allCounters;
    const counterRows: CounterTableRow[] = counters.map((group) => ({
        kind: "group",
        key: group.title,
        title: group.title,
        children: group.rows.map((row) => ({ kind: "counter", key: `${group.title}/${row.label}`, row })),
    }));
    // The table is turned on its side: a row per counter, a column per compared host. The
    // host's state sits in its header, under the name, where it used to be a second header
    // row -- the table has one.
    const counterColumns: DataTableDef<CounterTableRow>[] = [
        {
            tableHeader: "Counter",
            tableHeaderClassName: "sticky left-0 bg-table-header",
            tableCellClassName: (row) =>
                cn(
                    stickyCell(row),
                    "text-sm",
                    row.kind === "group"
                        ? "text-xs font-semibold uppercase tracking-wide"
                        : "text-text-secondary",
                ),
            tableItemRender: (row) => (row.kind === "group" ? row.title : row.row.label),
        },
        ...compared.map(
            (m, i): DataTableDef<CounterTableRow> => ({
                tableHeader: (
                    <div className="flex flex-col items-end gap-1">
                        <Link
                            to={paths.client(m.clientId)}
                            className={cn("rounded-sm text-text-primary hover:text-primary", FOCUS_RING)}
                        >
                            {m.hostName}
                        </Link>
                        <VrrpStateBadge state={m.instance.state} />
                    </div>
                ),
                tableHeaderClassName: cn(
                    "text-right text-sm font-normal normal-case tracking-normal",
                    memberStale(m) && "opacity-60",
                ),
                tableCellClassName: (row) => {
                    const value = row.kind === "counter" ? row.row.values[i] : null;
                    return cn(
                        "text-right text-sm tabular-nums",
                        row.kind === "counter" && row.row.problem && value ? "text-error font-medium" : "text-text-primary",
                        memberStale(m) && "opacity-60",
                    );
                },
                tableItemRender: (row) => {
                    if (row.kind !== "counter") return null;
                    const delta = row.row.deltas?.[i];
                    return (
                        <>
                            {row.row.values[i] ?? "–"}
                            {delta != null && (
                                <span className={cn("ml-2 text-xs", !row.row.problem && "text-text-muted")}>
                                    +{delta}
                                </span>
                            )}
                        </>
                    );
                },
            }),
        ),
    ];
    // "Show all" searches the activity page by instance name, which only works where the
    // hosts agree on one.
    const instanceNames = [...new Set(instances.map((i) => i.name))];

    return (
        <div className="space-y-6">
            <EntityHeader
                leading={<Network size={20} className="text-text-muted" />}
                title={<HeaderBreadcrumb>{clusterLabel(cluster)}</HeaderBreadcrumb>}
                classNames={ENTITY_HEADER}
                meta={<ClusterHealthBadge health={cluster.health} />}
                alert={
                    (offline.length > 0 || silent.length > 0 || mismatched.length > 0) && (
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
                            {silent.length > 0 && (
                                <p className="text-sm text-warning">
                                    keepalived reports nothing on {joined(silent.map((m) => hostLink(m.clientId)))}:
                                    it is stopped or cannot be read. What is shown for{" "}
                                    {silent.length === 1 ? "that host" : "those hosts"} is the last reading, not the
                                    present state.
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
                            className={cn("rounded-sm text-sm text-text-secondary hover:text-primary", FOCUS_RING)}
                            onClick={() => setAllGroupsOf(narrowed ? cluster.key : undefined)}
                        >
                            {narrowed ? "Show all" : "Show errors only"}
                        </button>
                    )
                }
            >
                {compared.length === 0 ? (
                    <p className="p-4 text-sm text-text-secondary">
                        Select hosts in the table above to compare their counters.
                    </p>
                ) : counters.length === 0 ? (
                    <p className="p-4 text-sm text-text-secondary">keepalived reported no counters for this cluster.</p>
                ) : (
                    <DataTreeTable<CounterTableRow>
                        data={counterRows}
                        keyField="key"
                        getChildren={(row) => (row.kind === "group" ? row.children : null)}
                        expanded={{ all: true }}
                        itemDef={counterColumns}
                        // A band across the table, so a group reads as a heading and not as one
                        // more counter.
                        rowClassName={(row) => (row.kind === "group" ? "bg-hover" : "")}
                    />
                )}
                {compared.length > 0 && counters.length > 0 && (
                    <p className="border-t border-border px-4 py-2 text-xs text-text-muted">
                        The counters are sums since keepalived started. A <span className="tabular-nums">+n</span>{" "}
                        beside one is what it counted since this page was opened.
                    </p>
                )}
            </Card>

            <Card
                title="Recent activity"
                titleAs="h3"
                action={
                    instanceNames.length === 1 && (
                        <Link
                            to={activitySearch(instanceNames[0])}
                            className={cn("rounded-sm text-sm text-text-secondary hover:text-primary", FOCUS_RING)}
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
                                    <RelativeTime
                                        date={event.occurredAt}
                                        seconds
                                        className="whitespace-nowrap text-xs text-text-muted"
                                    />
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
    return (
        <Card title={`${label} is used by ${candidates.length} clusters`} padding="md" classNames={{ content: "space-y-4" }}>
            <p className="text-text-secondary">
                These clusters share the VRID but sit on different networks. Pick one.
            </p>
            <ul className="space-y-2">
                {candidates.map((candidate) => (
                    <li key={candidate.key} className="flex flex-wrap items-center gap-2 text-sm">
                        <Link
                            to={clusterPath(candidate, clusters) ?? ROUTES.clusters}
                            className={cn("rounded-sm font-mono text-text-primary hover:text-primary", FOCUS_RING)}
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
