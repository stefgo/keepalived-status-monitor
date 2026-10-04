import { ReactNode } from "react";
import { Checkbox, StatusDot } from "@stefgo/react-ui-components";
import { paths } from "../../../lib/paths";
import { clusterVipLabel, memberKey, memberStale, type NamedVrrpCluster } from "../lib/vrrp";
import { ClusterHealthBadge } from "./ClusterHealthBadge";
import { VrrpInstanceView } from "./VrrpInstanceView";
import { MemberStateBadge } from "./VrrpStateBadge";

export interface ClusterCompare {
    /** Whether the member with this `memberKey` is compared. */
    selected: (key: string) => boolean;
    onToggle: (key: string, on: boolean) => void;
    onToggleAll: (on: boolean) => void;
}

interface ClusterCardProps {
    cluster: NamedVrrpCluster;
    /**
     * Replaces the cluster's VRID, addresses and health in the card header -- for the
     * cluster's own page, whose header says all of that already.
     */
    title?: ReactNode;
    /** Adds a column to pick the hosts whose counters are compared -- for the cluster's own page. */
    compare?: ClusterCompare;
}

/**
 * One virtual router and every host that takes part in it. The instance view is the card
 * itself: it brings its own, and a second one around it would nest two frames. A row opens
 * that host.
 */
export const ClusterCard = ({ cluster, title, compare }: ClusterCardProps) => {
    const label = `VRID ${cluster.vrid ?? "?"}: ${clusterVipLabel(cluster)}`;

    const compared = compare ? cluster.members.filter((m) => compare.selected(memberKey(m))).length : 0;

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
            leadingHeader={
                compare && (
                    <Checkbox
                        aria-label="Compare all hosts"
                        title="Compare counters"
                        checked={compared > 0 && compared === cluster.members.length}
                        indeterminate={compared > 0 && compared < cluster.members.length}
                        onChange={(e) => compare.onToggleAll(e.target.checked)}
                    />
                )
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
                        leading: compare && (
                            // The row opens the host; ticking the box must not.
                            <span className="flex items-center" onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                    aria-label={`Compare ${name}`}
                                    checked={compare.selected(key)}
                                    onChange={(e) => compare.onToggle(key, e.target.checked)}
                                />
                            </span>
                        ),
                    };
                })}
        />
    );
};
