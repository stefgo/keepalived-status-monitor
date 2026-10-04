import type { ActivityRecord, KeepalivedState, SchedulerStatuses, SchedulerStatusUpdate } from "@kasm/shared";

/**
 * What a dashboard message or an answer makes of a cache entry: `(what is cached, what
 * arrived) => what is cached now`. Pure, so every rule here is tested without a socket or a
 * component -- `WebSocketProvider` and the queries only decide which entry it belongs to.
 *
 * The rules also settle the order of a push and a request. For a reading the server's
 * `receivedAt` decides, whichever way it arrived; for a list that is pushed whole, see
 * `readUnlessPushed` in `queryClient.ts`.
 */

// ── Keepalived readings ──────────────────────────────────────────────────────

/** The last reading per client id. */
export type KeepalivedStates = Record<string, KeepalivedState>;

/**
 * `KEEPALIVED_STATE_UPDATE`: one client's reading, written over the one that is cached
 * unless that one is newer. May also be what makes the entry: the server sends every
 * client's reading on connect, so an entry made here is complete once that burst is through.
 */
export function applyKeepalivedState(states: KeepalivedStates | undefined, state: KeepalivedState): KeepalivedStates {
    const cached = states?.[state.clientId];
    if (states && cached && cached.receivedAt > state.receivedAt) return states;
    return { ...states, [state.clientId]: state };
}

/**
 * The answer of `GET /api/v1/keepalived/states` laid over what the socket has delivered:
 * per client, whichever reading the server received later. A request that was under way
 * while the socket delivered a newer reading must not put the older one back, and a client
 * the answer does not know yet keeps the reading the socket brought.
 */
export function mergeKeepalivedStates(cached: KeepalivedStates | undefined, fetched: KeepalivedState[]): KeepalivedStates {
    const states: KeepalivedStates = { ...cached };
    for (const state of fetched) {
        const known = states[state.clientId];
        if (!known || known.receivedAt <= state.receivedAt) states[state.clientId] = state;
    }
    return states;
}

// ── Activity ─────────────────────────────────────────────────────────────────

/** The most severe level among the events the user has not seen, if it is one that asks for a look. */
export type UnseenTone = "error" | "warning" | null;

/**
 * Info and trace events never ask for a look.
 *
 * Returns a string rather than a list, so a component selecting it re-renders only when the
 * tone changes, not on every update of the list.
 */
export function unseenTone(events: ActivityRecord[]): UnseenTone {
    let tone: UnseenTone = null;
    for (const e of events) {
        if (e.seen) continue;
        if (e.level === "error") return "error";
        if (e.level === "warning") tone = "warning";
    }
    return tone;
}

/**
 * Merges `ACTIVITY_APPENDED` into the list: ids already there are skipped, and the list
 * stays newest first by `occurredAt` -- an event handed over after an offline stretch
 * lands where it happened, not on top. Returns the list itself when nothing is new.
 */
export function appendActivity(events: ActivityRecord[], incoming: ActivityRecord[]): ActivityRecord[] {
    const known = new Set(events.map((e) => e.id));
    const fresh = incoming.filter((e) => !known.has(e.id));
    if (fresh.length === 0) return events;
    return [...fresh, ...events].sort((a, b) =>
        a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0,
    );
}

/**
 * Turns the events named seen. Returns the list itself when none of them was unseen --
 * `ACTIVITY_SEEN` arrives for this tab's own marking too, where it changes nothing.
 */
export function markActivitySeen(events: ActivityRecord[], ids: readonly string[]): ActivityRecord[] {
    const seen = new Set(ids);
    if (!events.some((e) => !e.seen && seen.has(e.id))) return events;
    return events.map((e) => (!e.seen && seen.has(e.id) ? { ...e, seen: true } : e));
}

/** The ids among `ids` that are in the list and not seen yet: what a marking will change. */
export function unseenAmong(events: ActivityRecord[], ids: readonly string[]): string[] {
    const asked = new Set(ids);
    return events.filter((e) => !e.seen && asked.has(e.id)).map((e) => e.id);
}

/**
 * Takes a marking back, for exactly the events it had turned seen: the request failed, the
 * server sent nothing, and the list must not claim a state the server does not have.
 */
export function unmarkActivitySeen(events: ActivityRecord[], ids: readonly string[]): ActivityRecord[] {
    const marked = new Set(ids);
    if (!events.some((e) => marked.has(e.id))) return events;
    return events.map((e) => (marked.has(e.id) ? { ...e, seen: false } : e));
}

// ── Schedulers ───────────────────────────────────────────────────────────────

/** `SCHEDULER_STATUS_UPDATE` carries one scheduler at a time; the others stay as they are. */
export function applySchedulerUpdate(schedulers: SchedulerStatuses, update: SchedulerStatusUpdate): SchedulerStatuses {
    return { ...schedulers, [update.scheduler]: update.status };
}
