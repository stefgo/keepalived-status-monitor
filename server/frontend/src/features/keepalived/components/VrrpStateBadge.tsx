import { Badge } from "@stefgo/react-ui-components";
import type { VrrpClusterMember, VrrpState } from "@kasm/shared";
import { useKeepalivedStore } from "../../../stores/useKeepalivedStore";
import { silenceLabel, vrrpStateLabel, vrrpStateVariant } from "../lib/vrrp";

export const VrrpStateBadge = ({ state }: { state: VrrpState }) => (
    <Badge variant={vrrpStateVariant(state)}>{vrrpStateLabel(state)}</Badge>
);

/**
 * Next to the state of a member whose keepalived reports nothing: stopped or unreadable. The
 * state beside it is then the last one reported, which this keeps from being read as current.
 */
export const SilentBadge = ({ member }: { member: VrrpClusterMember }) => {
    const reading = useKeepalivedStore((s) => s.states[member.clientId]);
    if (member.reporting) return null;
    const label = silenceLabel(reading);
    return (
        <span title={`keepalived ${label.toLowerCase()} on this host; the state is the last one reported.`}>
            <Badge variant="warning">{label}</Badge>
        </span>
    );
};
