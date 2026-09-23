import { create } from "zustand";
import { ActivityLevel, ActivityRecord } from "@kasm/shared";
import { getErrorMessage } from "../utils";
import { apiFetch } from "../lib/apiFetch";

export type { ActivityLevel, ActivityRecord };

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

interface ActivityState {
    /** As the server reads it for this session's user: `seen` is theirs. */
    events: ActivityRecord[];
    error: string | null;
    setEvents: (events: ActivityRecord[]) => void;
    appendEvents: (events: ActivityRecord[]) => void;
    applySeen: (ids: string[]) => void;
    fetchEvents: () => Promise<void>;
    markManySeen: (ids: string[]) => Promise<void>;
    clearAll: () => Promise<void>;
}

export const useActivityStore = create<ActivityState>()((set, get) => ({
    events: [],
    error: null,

    setEvents: (events) => set({ events }),

    /**
     * Merges `ACTIVITY_APPENDED` into the list: ids already there are skipped, and the list
     * stays newest first by `occurredAt` -- an event handed over after an offline stretch
     * lands where it happened, not on top.
     */
    appendEvents: (incoming) =>
        set((s) => {
            const known = new Set(s.events.map((e) => e.id));
            const fresh = incoming.filter((e) => !known.has(e.id));
            if (fresh.length === 0) return s;
            const events = [...fresh, ...s.events].sort((a, b) =>
                a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0,
            );
            return { events };
        }),

    /**
     * `ACTIVITY_SEEN`: events this user has seen, possibly in another tab. Arrives for this
     * tab's own marking too, where it changes nothing.
     */
    applySeen: (ids) =>
        set((s) => {
            const seen = new Set(ids);
            if (!s.events.some((e) => !e.seen && seen.has(e.id))) return s;
            return {
                events: s.events.map((e) => (!e.seen && seen.has(e.id) ? { ...e, seen: true } : e)),
            };
        }),

    fetchEvents: async () => {
        const res = await apiFetch("/api/v1/activity");
        if (res.ok) {
            set({ events: await res.json() });
        }
    },

    /**
     * One request for many events. The server answers the sessions of this user with
     * `ACTIVITY_SEEN`, and nobody else.
     *
     * Optimistic: the rows turn seen at once. If the request fails, exactly the events this
     * call turned seen go back, and the error is kept -- the server sent nothing, so without
     * the rollback the list would claim a state the server does not have until the next load.
     */
    markManySeen: async (ids) => {
        if (ids.length === 0) return;
        const marked = new Set<string>();
        const requested = new Set(ids);
        set((s) => ({
            events: s.events.map((e) => {
                if (!requested.has(e.id) || e.seen) return e;
                marked.add(e.id);
                return { ...e, seen: true };
            }),
        }));

        try {
            const res = await apiFetch("/api/v1/activity/seen", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || "Failed to mark the events as seen");
            }
        } catch (e: unknown) {
            set((s) => ({
                error: getErrorMessage(e),
                events: s.events.map((event) =>
                    marked.has(event.id) ? { ...event, seen: false } : event,
                ),
            }));
        }
    },

    clearAll: async () => {
        const oldEvents = get().events;
        set({ events: [] });

        try {
            const res = await apiFetch("/api/v1/activity", { method: "DELETE" });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to delete the activity log");
            }
        } catch (e: unknown) {
            set({ events: oldEvents, error: getErrorMessage(e) });
            throw e;
        }
    },
}));
