import { create } from "zustand";
import { ActivityLevel, ActivityRecord } from "@kasm/shared";
import { apiFetch } from "../lib/apiFetch";

export type { ActivityLevel, ActivityRecord };

interface ActivityState {
    events: ActivityRecord[];
    /** From /api/v1/me, where `id` is a number -- and so are the entries of `seenBy`. */
    currentUserId: number | null;
    setCurrentUserId: (id: number) => void;
    setEvents: (events: ActivityRecord[]) => void;
    fetchEvents: () => Promise<void>;
    markSeen: (id: string) => Promise<void>;
    markAllSeen: () => Promise<void>;
    removeEvent: (id: string) => Promise<void>;
    clearAll: () => Promise<void>;
}

export const useActivityStore = create<ActivityState>()((set, get) => ({
    events: [],
    currentUserId: null,

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

    markAllSeen: async () => {
        const userId = get().currentUserId;
        if (userId) {
            set((s) => ({
                events: s.events.map((e) =>
                    e.seenBy.includes(userId) ? e : { ...e, seenBy: [...e.seenBy, userId] },
                ),
            }));
        }
        await apiFetch("/api/v1/activity/seen-all", { method: "POST" });
    },

    removeEvent: async (id) => {
        set((s) => ({ events: s.events.filter((e) => e.id !== id) }));
        await apiFetch(`/api/v1/activity/${id}`, { method: "DELETE" });
    },

    clearAll: async () => {
        set({ events: [] });
        await apiFetch("/api/v1/activity", { method: "DELETE" });
    },
}));
