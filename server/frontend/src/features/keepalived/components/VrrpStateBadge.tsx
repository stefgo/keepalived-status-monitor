import { Badge } from "@stefgo/react-ui-components";
import type { VrrpClusterMember, VrrpState } from "@kasm/shared";
import { useKeepalivedState } from "../../../queries/keepalived";
import { memberStale, silenceLabel, vrrpStateLabel, vrrpStateVariant } from "../lib/vrrp";

export const VrrpStateBadge = ({ state }: { state: VrrpState }) => (
    <Badge variant={vrrpStateVariant(state)}>{vrrpStateLabel(state)}</Badge>
);

/**
 * In place of the state of a member whose state is not current: "Offline" where its agent is
 * not connected, "Not Active" where it is but keepalived on the host is stopped or unreadable.
 * The last reported state goes into the tooltip, so it is not read as current. Rendered
 * outside the dimming of its row, so it stays legible.
 */
const MemberStatusBadge = ({ member }: { member: VrrpClusterMember }) => {
    const reading = useKeepalivedState(member.clientId);
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
