import { create } from "zustand";
import type { SchedulerStatuses, SchedulerStatusUpdate } from "@kasm/shared";

/**
 * The schedulers the server itself runs: the maintenance jobs on the settings page.
 *
 * Filled by `GET /api/v1/settings/scheduler-status` and kept current by
 * `SCHEDULER_STATUS_UPDATE`, which carries one scheduler at a time.
 */
interface SchedulerStoreState {
    schedulers: Partial<SchedulerStatuses>;
    setSchedulers: (schedulers: Partial<SchedulerStatuses>) => void;
    applyUpdate: (update: SchedulerStatusUpdate) => void;
}

export const useSchedulerStore = create<SchedulerStoreState>((set) => ({
    schedulers: {},
    setSchedulers: (schedulers) => set({ schedulers }),
    applyUpdate: (update) =>
        set((state) => ({ schedulers: { ...state.schedulers, [update.scheduler]: update.status } })),
}));
