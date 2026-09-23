import { useMemo, useState } from "react";
import {
    ChevronRight,
    ChevronDown,
    Activity,
    MoreVertical,
    Trash2,
    Eye,
    EyeOff,
    Server,
    Network,
} from "lucide-react";
import {
    ActionButton,
    ActionMenu,
    Button,
    cn,
    DataAction,
    DataMultiView,
    DataTableDef,
    Select,
    useActionMenu,
    useConfirm,
} from "@stefgo/react-ui-components";
import { ACTIVITY_LEVELS, ActivityLevel, ActivityRecord } from "@kasm/shared";
import { unseenTone, useActivityStore } from "../../../stores/useActivityStore";
import { useClientStore } from "../../../stores/useClientStore";
import { useSearchQueryParam } from "../../../hooks/useSearchQueryParam";
import { ActivityGroupSteps } from "./ActivityGroupSteps";
import { ActivityLevelIcon } from "./ActivityLevelIcon";
import { activityDetail, activityMessage } from "../lib/activityText";
import { ActivityGroup, groupActivity } from "../lib/groupActivity";
import { describeDeleteAllActivity } from "../confirmations";
import { clientName, formatDate } from "../../../utils";
import { MENU_ENTRY } from "../../../components/menuEntry";
import { PAGE_SIZE, pagination } from "../../../components/listDefaults";

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
 * The activity list: structured events, not messages written for the reader.
 *
 * Two things follow from that and are visible here: the text of a row is written in
 * `activityText` out of `kind` and `data`, not taken from the event, and a multi-step
 * operation is a group of full events rather than one entry with a list of sentences
 * attached. The level filter works on the field itself, so "warning and above" means exactly
 * that; the search box covers everything a reader would look for by name.
 */
export function ActivityView() {
    const { events, markManySeen, clearAll } = useActivityStore();
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const { confirm } = useConfirm();
    const { menuState, triggerRef, openMenu, closeMenu } = useActionMenu<string>();
    const clients = useClientStore((s) => s.clients);
    // A minimum, not an exact match: "info" shows everything but the trace level. The page
    // opens on what needs a look: "error" while an error is unseen, else "warning" while a
    // warning is, else "info". That start is fixed once the list is known, so marking a row
    // seen does not pull the filter out from under the reader; until then it follows the list.
    const [chosenLevel, setChosenLevel] = useState<ActivityLevel | null>(null);
    const startLevel: ActivityLevel = unseenTone(events) ?? "info";
    if (chosenLevel === null && events.length > 0) {
        setChosenLevel(startLevel);
    }
    const levelFilter = chosenLevel ?? startLevel;
    // Whether seen entries are listed at all. Under "unseen" a row leaves the list as soon as
    // it is marked seen, which is the point: what is left is what has not been looked at.
    const [seenFilter, setSeenFilter] = useState<"all" | "unseen">("unseen");
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

    const groups = useMemo(() => groupActivity(named), [named]);

    const filtered = useMemo(
        () =>
            groups.filter((group) => {
                if (ACTIVITY_LEVELS.indexOf(group.level) < ACTIVITY_LEVELS.indexOf(levelFilter)) {
                    return false;
                }
                if (seenFilter === "unseen" && !group.unseen) return false;
                if (!searchQuery) return true;
                const q = searchQuery.toLowerCase();
                return [group.head, ...group.members].some((event) =>
                    searchText(event).includes(q),
                );
            }),
        [groups, levelFilter, seenFilter, searchQuery],
    );

    const toggleExpand = (id: string) => {
        setExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    /**
     * A row is one group, so seeing it means seeing everything under it -- in one request,
     * and only for the events that are not seen yet.
     */
    const handleMarkSeen = (group: ActivityGroup) => {
        markManySeen(
            [group.head, ...group.members].filter((e) => !e.seen).map((e) => e.id),
        );
    };

    const tableDef: DataTableDef<ActivityGroup>[] = [
        {
            tableHeader: "",
            tableHeaderClassName: "px-0 pl-6 w-px",
            // The row grows when a group is expanded, so the icon is pinned to the top line
            // of the message instead of floating in the middle of the row.
            tableCellClassName: "px-0 pl-6 w-px align-top pt-2.5",
            tableItemRender: (g) => <ActivityLevelIcon level={g.level} />,
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
                    ]}
                />
            ),
        },
    ];

    // "Mark as seen" acts on what the level filter and the search leave on screen, every page
    // of it -- not on events the reader has not been shown.
    const unseenShown = filtered
        .flatMap((g) => [g.head, ...g.members])
        .filter((e) => !e.seen)
        .map((e) => e.id);

    // Styled like the search pill they sit next to rather than like form fields: same height,
    // radius, border and background, so the bar reads as one row of controls.
    const pillSelect = {
        select: "py-1 pl-3 pr-9 rounded-full border-border bg-app-bg text-sm",
    };
    const filterSelects = (
        <div className="flex flex-wrap items-center gap-2">
            <Select
                aria-label="Filter by seen state"
                fullWidth={false}
                classNames={pillSelect}
                value={seenFilter}
                onChange={(e) => setSeenFilter(e.target.value as "all" | "unseen")}
                options={[
                    { value: "all", label: "all" },
                    { value: "unseen", label: "unseen" },
                ]}
            />
            <Select
                aria-label="Filter by level"
                fullWidth={false}
                classNames={pillSelect}
                value={levelFilter}
                onChange={(e) => setChosenLevel(e.target.value as ActivityLevel)}
                options={ACTIVITY_LEVELS.map((level) => ({ value: level, label: level }))}
            />
        </div>
    );

    const extraActions = (
        <div className="flex flex-wrap items-center gap-2">
            {unseenShown.length > 0 && (
                <Button variant="secondary" size="sm" onClick={() => markManySeen(unseenShown)}>
                    Mark as seen
                </Button>
            )}
            {groups.length > 0 && (
                <div className="relative">
                    <ActionButton
                        icon={MoreVertical}
                        aria-label="Activity actions"
                        onClick={(e) => openMenu(e, "activity")}
                    />
                    <ActionMenu
                        isOpen={menuState?.id === "activity"}
                        onClose={closeMenu}
                        anchor={menuState?.anchor ?? null}
                        triggerRef={triggerRef}
                    >
                        {/* Closes the menu first: the dialog would otherwise sit under it. */}
                        <button
                            onClick={() => {
                                closeMenu();
                                confirm({ ...describeDeleteAllActivity(events.length), onConfirm: clearAll });
                            }}
                            className={cn(MENU_ENTRY, "text-error")}
                        >
                            <Trash2 size={16} /> Delete all
                        </button>
                    </ActionMenu>
                </div>
            )}
        </div>
    );

    return (
        <DataMultiView<ActivityGroup>
            title={
                <>
                    <Activity size={18} className="text-text-muted" /> Activity
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
            searchPlaceholder="Search activity…"
            search={{ value: searchQuery, onChange: setSearchQuery }}
            searchActions={filterSelects}
            extraActions={extraActions}
            classNames={{ table: { table: "w-full" } }}
        />
    );
}
