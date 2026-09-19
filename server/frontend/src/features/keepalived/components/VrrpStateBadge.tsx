import { Badge } from "@stefgo/react-ui-components";
import type { VrrpState } from "@kasm/shared";
import { vrrpStateLabel, vrrpStateVariant } from "../lib/vrrp";

export const VrrpStateBadge = ({ state }: { state: VrrpState }) => (
    <Badge variant={vrrpStateVariant(state)}>{vrrpStateLabel(state)}</Badge>
);
