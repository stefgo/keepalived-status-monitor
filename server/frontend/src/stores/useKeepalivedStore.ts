import { create } from "zustand";
import { KeepalivedState } from "@kasm/shared";
import { apiFetch } from "../lib/apiFetch";

interface KeepalivedStoreState {
    /** The last reading per client id, as the server pushed or returned it. */
    states: Record<string, KeepalivedState>;
    setState: (state: KeepalivedState) => void;
    fetchStates: () => Promise<void>;
    /** Asks the agent to read keepalived now; the result arrives over the WebSocket. */
    refresh: (clientId: string) => Promise<void>;
}

export const useKeepalivedStore = create<KeepalivedStoreState>()((set) => ({
    states: {},

    setState: (state) =>
        set((s) => ({ states: { ...s.states, [state.clientId]: state } })),

    fetchStates: async () => {
        const res = await apiFetch("/api/v1/keepalived/states");
        if (!res.ok) return;
        const list = (await res.json()) as KeepalivedState[];
        set({ states: Object.fromEntries(list.map((state) => [state.clientId, state])) });
    },

    refresh: async (clientId) => {
        const res = await apiFetch(`/api/v1/clients/${clientId}/keepalived/refresh`, {
            method: "POST",
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || "Failed to ask the agent for a reading");
        }
    },
}));
