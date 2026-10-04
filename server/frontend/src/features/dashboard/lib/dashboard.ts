import {
    ACTIVITY_LEVELS,
    CLIENT_STATUS,
    type ActivityRecord,
    type KeepalivedState,
    type VrrpCluster,
} from "@kasm/shared";
import { groupActivity } from "../../activity/lib/groupActivity";

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
export const needsAttention = (clusters: readonly VrrpCluster[]): VrrpCluster[] =>
    clusters.filter((cluster) => cluster.health !== "ok" && cluster.health !== "unknown");

/**
 * What the activity list opens on from the Errors / Warnings card: unseen rows at warning
 * and above, counted as rows -- grouped the way the list groups them.
 */
export function unseenProblems(events: ActivityRecord[]): number {
    const warning = ACTIVITY_LEVELS.indexOf("warning");
    return groupActivity(events).filter(
        (group) => group.unseen && ACTIVITY_LEVELS.indexOf(group.level) >= warning,
    ).length;
}
