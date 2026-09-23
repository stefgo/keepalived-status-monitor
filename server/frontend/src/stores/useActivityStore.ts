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
    markSeen: (id: string) => Promise<void>;
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

    markSeen: async (id) => {
        const userId = get().currentUserId;
        if (userId) {
            set((s) => ({
                events: s.events.map((e) =>
                    e.id === id && !e.seenBy.includes(userId)
                        ? { ...e, seenBy: [...e.seenBy, userId] }
                        : e,
                ),
            }));
        }
        await apiFetch(`/api/v1/activity/${id}/seen`, { method: "POST" });
    },

    /** One request for many events, so the server broadcasts the list once, not per event. */
    markManySeen: async (ids) => {
        if (ids.length === 0) return;
        const userId = get().currentUserId;
        if (userId) {
            const marked = new Set(ids);
            set((s) => ({
                events: s.events.map((e) =>
                    marked.has(e.id) && !e.seenBy.includes(userId)
                        ? { ...e, seenBy: [...e.seenBy, userId] }
                        : e,
                ),
            }));
        }
        await apiFetch("/api/v1/activity/seen", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids }),
        });
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
