import { Badge } from "@stefgo/react-ui-components";
import type { VrrpClusterMember, VrrpState } from "@kasm/shared";
import { useKeepalivedStore } from "../../../stores/useKeepalivedStore";
import { silenceLabel, vrrpStateLabel, vrrpStateVariant } from "../lib/vrrp";

export const VrrpStateBadge = ({ state }: { state: VrrpState }) => (
    <Badge variant={vrrpStateVariant(state)}>{vrrpStateLabel(state)}</Badge>
);

/**
 * Next to the state of a member whose state is not current: "Offline" where its agent is not
 * connected, "Not Active" where it is but keepalived on the host is stopped or unreadable.
 * The state beside it is then the last one reported, which this keeps from being read as
 * current. Rendered outside the dimming of its row, so it stays legible.
 */
export const MemberStatusBadge = ({ member }: { member: VrrpClusterMember }) => {
    const reading = useKeepalivedStore((s) => s.states[member.clientId]);
    if (!member.online) {
        return (
            <span title="The host's agent is offline; the state is the last one reported.">
                <Badge variant="error">Offline</Badge>
            </span>
        );
    }
    if (!member.reporting) {
        return (
            <span
                title={`keepalived is ${silenceLabel(reading).toLowerCase()} on this host; the state is the last one reported.`}
            >
                <Badge variant="error">Not Active</Badge>
            </span>
        );
    }
    return null;
};
