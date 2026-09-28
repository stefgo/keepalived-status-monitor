import { WS_EVENTS } from "@kasm/shared";
import { logger } from "@kasm/shared/node";
import { ProxyService } from "./ProxyService.js";

/**
 * Asks agents for a reading now, for a pending cluster state that waits for one.
 *
 * A pending split brain, missing master or incident counts once every member it is about has
 * delivered a reading after VRRP's master down interval. Left alone, that reading comes when
 * the agent sends one anyway -- and an agent sends an *unchanged* reading only every 30 s, on
 * top of its poll interval. Asked with `REQUEST_STATE_UPDATE`, it reads at once and sends the
 * reading whether or not it changed (`KeepalivedService.refresh` on the agent), so a
 * confirmation takes the interval and about a second rather than up to half a minute.
 *
 * The request only speeds things up: one that is lost changes nothing but the wait, since the
 * agent's own next reading pays the same.
 */

/** A client asked this recently is not asked again: several clusters may wait for one reading. */
const MIN_GAP_MS = 1000;

/** How long after a pending state is old enough the request goes out, so the reading is surely past it. */
export const READING_REQUEST_MARGIN_MS = 250;

const lastAsked = new Map<string, number>();

/** Asks each connected client for a reading, once per client within `MIN_GAP_MS`. */
export function requestReadings(clientIds: Iterable<string>): void {
    const now = Date.now();
    for (const clientId of new Set(clientIds)) {
        if (now - (lastAsked.get(clientId) ?? 0) < MIN_GAP_MS) continue;
        try {
            ProxyService.sendFireAndForget(clientId, WS_EVENTS.REQUEST_STATE_UPDATE, {});
            lastAsked.set(clientId, now);
            logger.debug({ clientId }, "Asked for a reading to confirm a pending cluster state");
        } catch {
            // Gone offline in the meantime -- and offline, it owes no reading.
        }
    }
}

/**
 * The one follow-up per pending cluster state: asking for its readings once they start to
 * count, or -- for a cluster without any agent, which sends none -- looking again once it has
 * lasted long enough. Keyed by cluster; a state is told apart by the time it was first seen,
 * so planning the same one twice -- every evaluation does, and the first one after a restart
 * must -- changes nothing, and a follow-up that ran is not repeated.
 */
export class PendingFollowUps {
    private planned = new Map<string, { since: string; timer: NodeJS.Timeout | null }>();

    /**
     * Plans `action` for the state of `clusterKey` first seen at `since`, to run `afterMs`
     * after it -- at once if that is past.
     */
    schedule(clusterKey: string, since: string, afterMs: number, action: () => void): void {
        const existing = this.planned.get(clusterKey);
        if (existing?.since === since) return;
        if (existing?.timer) clearTimeout(existing.timer);

        const entry: { since: string; timer: NodeJS.Timeout | null } = { since, timer: null };
        const delay = Math.max(0, Date.parse(since) + afterMs - Date.now());
        entry.timer = setTimeout(() => {
            // Kept, without a timer: the follow-up is done, and planning the state again must
            // not run it a second time.
            entry.timer = null;
            try {
                action();
            } catch (err) {
                logger.warn({ err, clusterKey }, "Could not follow up on a pending cluster state");
            }
        }, delay);
        entry.timer.unref?.();
        this.planned.set(clusterKey, entry);
    }

    /** Forgets the plan of a cluster whose pending state was confirmed or dropped. */
    cancel(clusterKey: string): void {
        const existing = this.planned.get(clusterKey);
        if (existing?.timer) clearTimeout(existing.timer);
        this.planned.delete(clusterKey);
    }

    /** Forgets the plans of clusters that no longer exist. */
    cancelExcept(clusterKeys: Iterable<string>): void {
        const keep = new Set(clusterKeys);
        for (const key of [...this.planned.keys()]) {
            if (!keep.has(key)) this.cancel(key);
        }
    }
}
