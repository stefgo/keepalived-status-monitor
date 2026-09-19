import { useMemo, useState } from "react";
import {
    AlertCircle,
    AlertTriangle,
    Info,
    ChevronRight,
    ChevronDown,
    Trash2,
    Bell,
    Eye,
    EyeOff,
    Server,
    Network,
    Activity,
} from "lucide-react";
import {
    ActionButton,
    Button,
    DataAction,
    DataMultiView,
    DataTableDef,
    Select,
    useConfirm,
} from "@stefgo/react-ui-components";
import { ACTIVITY_LEVELS, ActivityLevel, ActivityRecord } from "@kasm/shared";
import { useActivityStore } from "../../../stores/useActivityStore";
import { useClientStore } from "../../../stores/useClientStore";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { ActivityGroupSteps } from "./ActivityGroupSteps";
import { activityDetail, activityMessage } from "../lib/activityText";
import { ActivityGroup, groupActivity } from "../lib/groupActivity";
import { describeDeleteAllActivity } from "../confirmations";
import { clientName, formatDate } from "../../../utils";
import { PAGE_SIZE, pagination } from "../../../components/listDefaults";

const levelIcon: Record<ActivityLevel, React.ReactNode> = {
    error: <AlertCircle size={16} className="text-error shrink-0" />,
    warning: <AlertTriangle size={16} className="text-warning shrink-0" />,
    info: <Info size={16} className="text-info shrink-0" />,
    trace: <Activity size={16} className="text-text-muted shrink-0" />,
};

function SubjectBadges({ event }: { event: ActivityRecord }) {
    const subject = event.subject;
    const clientName = typeof event.data?.clientName === "string" ? event.data.clientName : null;
    if (!subject && !clientName) return null;
    return (
        <div className="flex flex-wrap gap-1 mt-1">
            {clientName && (
                <span className="inline-flex items-center gap-1 text-[11px] bg-hover px-1.5 py-0.5 rounded text-text-muted">
                    <Server size={10} /> {clientName}
                </span>
            )}
            {subject?.instanceName && (
                <span className="inline-flex items-center gap-1 text-[11px] bg-hover px-1.5 py-0.5 rounded text-text-muted">
                    <Network size={10} /> {subject.instanceName}
                </span>
            )}
            {subject?.vrid !== undefined && (
                <span className="inline-flex items-center gap-1 text-[11px] bg-hover px-1.5 py-0.5 rounded text-text-muted">
                    VRID {subject.vrid}
                </span>
            )}
            {subject?.interface && (
                <span className="inline-flex items-center gap-1 text-[11px] bg-hover px-1.5 py-0.5 rounded text-text-muted font-mono">
                    {subject.interface}
                </span>
            )}
        </div>
    );
}

/**
 * What the search box matches an event against: the sentence a reader sees, the kind it was
 * phrased from, and the host, instance and interface it is about. A group matches when
 * any of its events does, so a step is found under the operation it belongs to.
 */
function searchText(event: ActivityRecord): string {
    const subject = event.subject;
    return [
        activityMessage(event),
        activityDetail(event),
        event.kind,
        typeof event.data?.clientName === "string" ? event.data.clientName : null,
        subject?.instanceName,
        subject?.vrid !== undefined ? `vrid ${subject.vrid}` : null,
        subject?.interface,
    ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
}

/**
 * The activity list. Still reached under "Notifications" -- the page has kept the name it
 * had, while what it shows has become structured events.
 *
 * Two things follow from that and are visible here: the text of a row is written in
 * `activityText` out of `kind` and `data`, not taken from the event, and a multi-step
 * operation is a group of full events rather than one entry with a list of sentences
 * attached. The level filter works on the field itself, so "warning and above" means exactly
 * that; the search box covers everything a reader would look for by name.
 */
export function ActivityView() {
    const { events, currentUserId, markSeen, markAllSeen, removeEvent, clearAll } =
        useActivityStore();
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const { confirm } = useConfirm();
    const clients = useClientStore((s) => s.clients);
    // A minimum, not an exact match: "info" shows everything but the trace level.
    const [levelFilter, setLevelFilter] = useState<ActivityLevel>("info");
    const [searchQuery, setSearchQuery] = useSearchQueryParam();

    // Events recorded before the server stored `clientName` with them name no host. The
    // client list still knows it as long as the host exists, so the name is filled in here.
    const named = useMemo(() => {
        const names = new Map(clients.map((c) => [c.id, clientName(c)]));
        return events.map((event) => {
            if (!event.clientId || typeof event.data?.clientName === "string") return event;
            const clientName = names.get(event.clientId);
            return clientName ? { ...event, data: { ...event.data, clientName } } : event;
        });
    }, [events, clients]);

    const groups = useMemo(
        () => groupActivity(named, currentUserId),
        [named, currentUserId],
    );

    const filtered = useMemo(
        () =>
            groups.filter((group) => {
                if (ACTIVITY_LEVELS.indexOf(group.level) < ACTIVITY_LEVELS.indexOf(levelFilter)) {
                    return false;
                }
                if (!searchQuery) return true;
                const q = searchQuery.toLowerCase();
                return [group.head, ...group.members].some((event) =>
                    searchText(event).includes(q),
                );
            }),
        [groups, levelFilter, searchQuery],
    );

    const toggleExpand = (id: string) => {
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    /** A row is one group, so seeing it means seeing everything under it. */
    const handleMarkSeen = (group: ActivityGroup) => {
        markSeen(group.head.id);
        for (const member of group.members) markSeen(member.id);
    };

    const handleDelete = (group: ActivityGroup) => {
        removeEvent(group.head.id);
        for (const member of group.members) removeEvent(member.id);
    };

    const tableDef: DataTableDef<ActivityGroup>[] = [
        {
            tableHeader: "",
            tableHeaderClassName: "px-0 pl-6 w-px",
            // The row grows when a group is expanded, so the icon is pinned to the top line
            // of the message instead of floating in the middle of the row.
            tableCellClassName: "px-0 pl-6 w-px align-top pt-2.5",
            tableItemRender: (g) => levelIcon[g.level],
        },
        {
            tableHeader: "Message",
            tableItemRender: (g) => {
                const isExpanded = expandedIds.has(g.head.id);
                const detail = activityDetail(g.head);
                const expandable = !!detail || g.members.length > 0;
                return (
                    <div className={`flex items-start gap-2 w-full ${g.unseen ? "" : "opacity-60"}`}>
                        <div className="mt-0.5 shrink-0 w-[14px]">
                            {expandable && (
                                <ActionButton
                                    icon={isExpanded ? ChevronDown : ChevronRight}
                                    size="sm"
                                    tooltip={isExpanded ? "Collapse" : "Expand"}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleExpand(g.head.id);
                                    }}
                                />
                            )}
                        </div>
                        <div className="w-full min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                                <p className={`text-sm text-text-primary truncate ${g.unseen ? "font-medium" : ""}`}>
                                    {activityMessage(g.head)}
                                </p>
                                {g.members.length > 0 && (
                                    <span className="shrink-0 text-[11px] bg-hover px-1.5 py-0.5 rounded text-text-muted">
                                        {g.members.length} step{g.members.length === 1 ? "" : "s"}
                                    </span>
                                )}
                            </div>
                            {isExpanded && detail && (
                                <p className="mt-1 text-xs text-text-muted whitespace-pre-wrap break-words">
                                    {detail}
                                </p>
                            )}
                            {isExpanded && g.members.length > 0 && (
                                <ActivityGroupSteps members={g.members} />
                            )}
                            <SubjectBadges event={g.head} />
                        </div>
                    </div>
                );
            },
        },
        {
            tableHeader: "Time",
            tableHeaderClassName: "w-px whitespace-nowrap",
            tableCellClassName: "w-px whitespace-nowrap text-sm text-text-muted",
            sortable: true,
            sortValue: (g) => new Date(g.head.occurredAt).getTime(),
            tableItemRender: (g) => formatDate(g.head.occurredAt, { seconds: true }),
        },
        {
            tableHeader: "Actions",
            tableHeaderClassName: "w-px text-center",
            tableCellClassName: "w-px content-center",
            tableItemRender: (g) => (
                <DataAction
                    rowId={g.head.id}
                    actions={[
                        ...(g.unseen
                            ? [{
                                    icon: Eye,
                                    onClick: () => handleMarkSeen(g),
                                    tooltip: "Mark as seen",
                                    color: "blue" as const,
                                }]
                            : [{
                                    icon: EyeOff,
                                    onClick: () => {},
                                    tooltip: "Already seen",
                                    color: "gray" as const,
                                }]),
                        {
                            icon: Trash2,
                            onClick: () => handleDelete(g),
                            tooltip: "Delete",
                            color: "red" as const,
                        },
                    ]}
                />
            ),
        },
    ];

    const unseenCount = groups.filter((g) => g.unseen).length;

    // Styled like the search pill it sits next to rather than like a form field: same height,
    // radius, border and background, so the bar reads as one row of controls.
    const levelSelect = (
        <Select
            aria-label="Filter by level"
            fullWidth={false}
            classNames={{
                select: "py-1 pl-3 pr-9 rounded-full border-border bg-app-bg text-sm",
            }}
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as ActivityLevel)}
            options={ACTIVITY_LEVELS.map((level) => ({ value: level, label: level }))}
        />
    );

    const extraActions = (
        <div className="flex flex-wrap items-center gap-2">
            {unseenCount > 0 && (
                <Button variant="secondary" size="sm" onClick={markAllSeen}>
                    Mark all as seen
                </Button>
            )}
            {groups.length > 0 && (
                <Button
                    variant="danger"
                    size="sm"
                    onClick={() => confirm({ ...describeDeleteAllActivity(events.length), onConfirm: clearAll })}
                >
                    Delete all
                </Button>
            )}
        </div>
    );

    return (
        <DataMultiView<ActivityGroup>
            title={
                <>
                    <Bell size={18} className="text-text-muted" /> Notifications
                </>
            }
            viewMode={{ persist: { key: "activityView", scope: "local" } }}
            data={filtered}
            tableDef={tableDef}
            keyField={(g) => g.head.id}
            // Column 2 is the time. Column 3 is the action column, which has no sort value.
            sort={{ defaultValue: [{ colIndex: 2, direction: "desc" }] }}
            emptyMessage="Nothing has happened yet."
            noResultsMessage="No events match these filters."
            pagination={pagination(PAGE_SIZE.page)}
            searchable
            searchPlaceholder="Search notifications…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            searchActions={levelSelect}
            extraActions={extraActions}
            classNames={{ table: { table: "w-full" } }}
        />
    );
}
