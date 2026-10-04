import {
    CLIENT_STATUS,
    type ActivityRecord,
    type KeepalivedState,
    type VrrpCluster,
} from "@kasm/shared";
import { groupActivity } from "../../activity/lib/groupActivity";
import { plural } from "../../../utils";

/**
 * The numbers the dashboard's cards and the sidebar's badge both show. Counted here, once,
 * so the two cannot disagree about how many clients are online.
 */

export interface OnlineCount {
    online: number;
    total: number;
}

export const clientCount = (clients: readonly { status?: string | null }[]): OnlineCount => ({
    online: clients.filter((c) => c.status === CLIENT_STATUS.ONLINE).length,
    total: clients.length,
});

/** `3 / 5`, as a card and a badge write it. */
export const formatOnlineCount = ({ online, total }: OnlineCount): string => `${online} / ${total}`;

export interface InstanceCount {
    instances: number;
    masters: number;
    faults: number;
}

/**
 * The VRRP instances of the hosts that are connected. An instance of an offline host is not
 * counted: its last reading is not its present, and the card on the hosts says that the
 * host is gone.
 */
export function instanceCount(
    clients: readonly { id: string; status?: string | null }[],
    states: Readonly<Record<string, KeepalivedState | undefined>>,
): InstanceCount {
    const instances = clients
        .filter((client) => client.status === CLIENT_STATUS.ONLINE)
        .flatMap((client) => states[client.id]?.instances ?? []);
    return {
        instances: instances.length,
        masters: instances.filter((instance) => instance.state === "MASTER").length,
        faults: instances.filter((instance) => instance.state === "FAULT").length,
    };
}

/** The clusters the dashboard shows a card for: every one whose health is known and not ok. */
export const needsAttention = <C extends VrrpCluster>(clusters: readonly C[]): C[] =>
    clusters.filter((cluster) => cluster.health !== "ok" && cluster.health !== "unknown");

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
