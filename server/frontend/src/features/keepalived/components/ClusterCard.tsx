import { ReactNode } from "react";
import { StatusDot } from "@stefgo/react-ui-components";
import { paths } from "../../../lib/paths";
import { clusterVipLabel, memberKey, memberStale, type NamedVrrpCluster } from "../lib/vrrp";
import { ClusterHealthBadge } from "./ClusterHealthBadge";
import { VrrpInstanceView } from "./VrrpInstanceView";
import { MemberStateBadge } from "./VrrpStateBadge";

export interface ClusterCompare {
    /** The `memberKey` of every member that is compared. */
    value: ReadonlySet<string>;
    onChange: (next: ReadonlySet<string>) => void;
}

interface ClusterCardProps {
    cluster: NamedVrrpCluster;
    /**
     * Replaces the cluster's VRID, addresses and health in the card header -- for the
     * cluster's own page, whose header says all of that already.
     */
    title?: ReactNode;
    /** Lets the hosts whose counters are compared be picked -- for the cluster's own page. */
    compare?: ClusterCompare;
}

/**
 * One virtual router and every host that takes part in it. The instance view is the card
 * itself: it brings its own, and a second one around it would nest two frames. A row opens
 * that host.
 */
export const ClusterCard = ({ cluster, title, compare }: ClusterCardProps) => {
    const label = `VRID ${cluster.vrid ?? "?"}: ${clusterVipLabel(cluster)}`;
    const names = new Map(cluster.members.map((member) => [memberKey(member), member.hostName]));

    return (
        <VrrpInstanceView
            showHost
            // Part of what makes the cluster, so every row would repeat it. The addresses
            // are not: they belong to the host that carries them, and the list view shows
            // them per row, which is where a member serving a short list is read off.
            showVrid={false}
            title={
                title ?? (
                    <span className="flex flex-wrap items-center gap-2">
                        {label}
                        <ClusterHealthBadge health={cluster.health} />
                    </span>
                )
            }
            selection={
                compare && {
                    value: compare.value,
                    // The keys are the rows' own, so they are member keys.
                    onChange: (next) => compare.onChange(new Set([...next].map(String))),
                    rowLabel: (row) => `Compare ${names.get(row.key) ?? row.key}`,
                }
            }
            rows={[...cluster.members]
                .sort((a, b) => (b.instance.effectivePriority ?? 0) - (a.instance.effectivePriority ?? 0))
                .map((member) => {
                    const name = member.hostName;
                    const key = memberKey(member);
                    return {
                        key,
                        href: paths.client(member.clientId),
                        instance: member.instance,
                        stale: memberStale(member),
                        stateBadge: <MemberStateBadge member={member} />,
                        host: (
                            <span className="flex items-center gap-2">
                                <StatusDot tone={member.online ? "success" : "neutral"} />
                                {name}
                            </span>
                        ),
                    };
                })}
        />
    );
};
