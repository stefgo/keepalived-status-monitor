import { create } from "zustand";
import { ActivityLevel, ActivityRecord } from "@kasm/shared";
import { getErrorMessage } from "../utils";
import { apiFetch } from "../lib/apiFetch";

export type { ActivityLevel, ActivityRecord };

interface ActivityState {
    events: ActivityRecord[];
    /** From /api/v1/me, where `id` is a number -- and so are the entries of `seenBy`. */
    currentUserId: number | null;
    error: string | null;
    setCurrentUserId: (id: number) => void;
    setEvents: (events: ActivityRecord[]) => void;
    fetchEvents: () => Promise<void>;
    markManySeen: (ids: string[]) => Promise<void>;
    clearAll: () => Promise<void>;
}

export const useActivityStore = create<ActivityState>()((set, get) => ({
    events: [],
    currentUserId: null,
    error: null,

    setCurrentUserId: (id) => set({ currentUserId: id }),

    setEvents: (events) => set({ events }),

    fetchEvents: async () => {
        const res = await apiFetch("/api/v1/activity");
        if (res.ok) {
            set({ events: await res.json() });
        }
    },

    /**
     * One request for many events, so the server broadcasts the list once, not per event.
     *
     * Optimistic: the rows turn seen at once. If the request fails, exactly the events this
     * call turned seen go back, and the error is kept -- the server sent nothing, so without
     * the rollback the list would claim a state the server does not have until the next load.
     */
    markManySeen: async (ids) => {
        if (ids.length === 0) return;
        const userId = get().currentUserId;
        const marked = new Set<string>();
        if (userId) {
            const requested = new Set(ids);
            set((s) => ({
                events: s.events.map((e) => {
                    if (!requested.has(e.id) || e.seenBy.includes(userId)) return e;
                    marked.add(e.id);
                    return { ...e, seenBy: [...e.seenBy, userId] };
                }),
            }));
        }

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
                    marked.has(event.id)
                        ? { ...event, seenBy: event.seenBy.filter((id) => id !== userId) }
                        : event,
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
