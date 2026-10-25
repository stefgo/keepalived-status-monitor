import { stripPrefix } from "@kasm/shared";
import type { NamedClusterMember, NamedVrrpCluster } from "./vrrp";

/**
 * Whether an address is up where it should be. `served`: one MASTER carries it. `split`: more
 * than one does. `unserved`: no MASTER carries it. `partial`: served, but not every member
 * carries it, so a failover would take it down. `unknown`: no member of its cluster reports.
 */
export type VipState = "served" | "split" | "unserved" | "partial" | "unknown";

/** How the VRRP card counts a state, and how bad it is: null for one that is not known to be wrong. */
export const VIP_STATE: Record<VipState, { label: string; tone: "error" | "warning" | null }> = {
    split: { label: "Split", tone: "error" },
    unserved: { label: "Unserved", tone: "error" },
    partial: { label: "Not on every member", tone: "warning" },
    unknown: { label: "Unknown", tone: null },
    served: { label: "Served", tone: null },
};

/** Sort ranks: what needs a look first. The order of `VIP_STATE`. */
const RANK = Object.fromEntries(Object.keys(VIP_STATE).map((state, i) => [state, i])) as Record<VipState, number>;

/** One virtual address: the cluster it belongs to, the hosts that carry it as MASTER, its state. */
export interface VirtualIpRow {
    address: string;
    cluster: NamedVrrpCluster;
    holders: NamedClusterMember[];
    state: VipState;
}

const carries = (member: NamedClusterMember, bare: string) =>
    (member.instance.vips ?? []).some((vip) => stripPrefix(vip) === bare);

/**
 * Every virtual address of every cluster, the ones that need a look first. Who carries an
 * address is read off the members that are live -- online, with keepalived reporting -- as
 * the cluster's health is; whether every member carries it is read off all of them, offline
 * ones included, as `mismatchedVips` does.
 */
export function virtualIpRows(clusters: readonly NamedVrrpCluster[]): VirtualIpRow[] {
    const rows = clusters.flatMap((cluster) => {
        const live = cluster.members.filter((member) => member.online && member.reporting);
        return cluster.vips.map((address): VirtualIpRow => {
            const bare = stripPrefix(address);
            const holders = live.filter((member) => member.instance.state === "MASTER" && carries(member, bare));
            const state: VipState =
                live.length === 0
                    ? "unknown"
                    : holders.length > 1
                      ? "split"
                      : holders.length === 0
                        ? "unserved"
                        : cluster.members.every((member) => carries(member, bare))
                          ? "served"
                          : "partial";
            return { address, cluster, holders, state };
        });
    });
    // `sort` is stable: within a state the addresses keep the order of their clusters.
    return rows.sort((a, b) => RANK[a.state] - RANK[b.state]);
}
