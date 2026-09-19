import { appConfig } from "../config/AppConfig.js";
import { ActivityRepository } from "../repositories/ActivityRepository.js";
import { logger } from "@kasm/shared/node";

export interface NotificationCleanupResult {
    removed: number;
}

let timer: NodeJS.Timeout | null = null;
let lastRun: Date | null = null;

function readConfig() {
    const ttlDays = parseInt(appConfig.settings.notification_retention_days ?? "90", 10);
    const minKeep = parseInt(appConfig.settings.notification_retention_count ?? "500", 10);
    const intervalHours = parseInt(appConfig.settings.notification_cleanup_interval_hours ?? "24", 10);
    return {
        ttlDays: Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 90,
        minKeep: Number.isFinite(minKeep) && minKeep >= 0 ? minKeep : 500,
        intervalHours: Number.isFinite(intervalHours) ? intervalHours : 24,
    };
}

/**
 * Retention for the activity list. Named after the notifications it used to clean, and
 * deliberately left that way: the settings it reads (`notification_retention_*`) are stored
 * values, and the page the user sets them on is still called "Notification History".
 */
export class NotificationCleanupService {
    static run(): NotificationCleanupResult {
        const { ttlDays, minKeep } = readConfig();
        const removed = ActivityRepository.cleanupOld(ttlDays, minKeep);
        lastRun = new Date();
        logger.info({ removed, ttlDays, minKeep }, "Notification cleanup completed");
        return { removed };
    }

    static getLastRun(): string | null {
        return lastRun?.toISOString() ?? null;
    }

    static startScheduler(): void {
        this.stopScheduler();
        const { intervalHours } = readConfig();
        if (intervalHours <= 0) {
            logger.info("Notification cleanup scheduler disabled");
            return;
        }
        const intervalMs = intervalHours * 60 * 60 * 1000;
        timer = setInterval(() => {
            try {
                this.run();
            } catch (err) {
                logger.error({ err }, "Scheduled notification cleanup failed");
            }
        }, intervalMs);
        timer.unref?.();
        logger.info({ intervalHours }, "Notification cleanup scheduler started");
    }

    static stopScheduler(): void {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }

    static restartScheduler(): void {
        this.startScheduler();
    }
}
