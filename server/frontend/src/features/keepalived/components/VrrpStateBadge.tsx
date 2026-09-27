import { Badge } from "@stefgo/react-ui-components";
import type { VrrpClusterMember, VrrpState } from "@kasm/shared";
import { useKeepalivedStore } from "../../../stores/useKeepalivedStore";
import { memberStale, silenceLabel, vrrpStateLabel, vrrpStateVariant } from "../lib/vrrp";

export const VrrpStateBadge = ({ state }: { state: VrrpState }) => (
    <Badge variant={vrrpStateVariant(state)}>{vrrpStateLabel(state)}</Badge>
);

/**
 * Next to the state of a member whose state is not current: "Offline" where its agent is not
 * connected, "Not Active" where it is but keepalived on the host is stopped or unreadable.
 * The state beside it is then the last one reported, which this keeps from being read as
 * current; the tooltip names it too, for where this badge stands in for it. Rendered outside
 * the dimming of its row, so it stays legible.
 */
export const MemberStatusBadge = ({ member }: { member: VrrpClusterMember }) => {
    const reading = useKeepalivedStore((s) => s.states[member.clientId]);
    const last = `last reported state: ${vrrpStateLabel(member.instance.state)}`;
    if (!member.online) {
        return (
            <span title={`The host's agent is offline; ${last}.`}>
                <Badge variant="error">Offline</Badge>
            </span>
        );
    }
    if (!member.reporting) {
        return (
            <span
                title={`keepalived is ${silenceLabel(reading).toLowerCase()} on this host; ${last}.`}
            >
                <Badge variant="error">Not Active</Badge>
            </span>
        );
    }
    return null;
};

/**
 * A member's state as one badge: its VRRP state while that is current, otherwise only its
 * `MemberStatusBadge`, which names the last reported state in its tooltip.
 */
export const MemberStateBadge = ({ member }: { member: VrrpClusterMember }) =>
    memberStale(member) ? (
        <MemberStatusBadge member={member} />
    ) : (
        <VrrpStateBadge state={member.instance.state} />
    );
