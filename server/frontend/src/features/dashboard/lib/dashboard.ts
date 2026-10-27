import { needsAttention, type ActivityRecord, type OnlineCount, type VrrpCluster } from "@kasm/shared";
import { groupActivity } from "../../activity/lib/groupActivity";
import { plural } from "../../../utils";

/**
 * The numbers the dashboard's cards and the sidebar's badge both show. Counted in `shared`,
 * once, so the cards, the badge and the server's status report cannot disagree about how
 * many clients are online.
 */
export {
    clientCount,
    instanceCount,
    needsAttention,
    type InstanceCount,
    type OnlineCount,
} from "@kasm/shared";

/** `3 / 5`, as a card and a badge write it. */
export const formatOnlineCount = ({ online, total }: OnlineCount): string => `${online} / ${total}`;

/** The rows the user has not seen that ask for a look, by how loudly. */
export interface UnseenProblems {
    errors: number;
    warnings: number;
}

/**
 * What the activity list opens on from the Errors / Warnings card: unseen rows at warning
 * and above, counted as rows -- grouped the way the list groups them, each at the level its
 * row carries.
 */
export function unseenProblems(events: ActivityRecord[]): UnseenProblems {
    let errors = 0;
    let warnings = 0;
    for (const group of groupActivity(events)) {
        if (!group.unseen) continue;
        if (group.level === "error") errors++;
        else if (group.level === "warning") warnings++;
    }
    return { errors, warnings };
}

/**
 * What the "Errors / Warnings" card says below its number: what the number is made of.
 * A part that is zero is left out, and with nothing unseen the card says that instead.
 */
export function problemSummary({ errors, warnings }: UnseenProblems): string {
    const parts = [
        errors > 0 ? plural(errors, "error") : null,
        warnings > 0 ? plural(warnings, "warning") : null,
    ].filter((part) => part !== null);
    return parts.length > 0 ? parts.join(" · ") : "Nothing unseen";
}

/** What the hosts card says below its number: how many are away, or that none is. */
export function hostSummary({ online, total }: OnlineCount): string {
    if (total === 0) return "No client registered";
    return online === total ? "All connected" : `${total - online} offline`;
}

/**
 * What the clusters card says below its number: how many need a look and how many nobody
 * can vouch for -- every agent of theirs is offline -- or that all are healthy, and the
 * instances behind them.
 */
export function clusterSummary(clusters: readonly VrrpCluster[], instances: number): string {
    const attention = needsAttention(clusters).length;
    const unknown = clusters.filter((cluster) => cluster.health === "unknown").length;
    const state = [
        attention > 0 ? `${attention} ${attention === 1 ? "needs" : "need"} attention` : null,
        unknown > 0 ? `${unknown} unknown` : null,
    ].filter((part) => part !== null);
    return [
        ...(state.length > 0 ? state : clusters.length > 0 ? ["All healthy"] : []),
        plural(instances, "instance"),
    ].join(" · ");
}
