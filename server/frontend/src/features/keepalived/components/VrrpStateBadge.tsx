import { Badge } from "@stefgo/react-ui-components";
import type { VrrpState } from "@kasm/shared";
import { vrrpStateVariant } from "../lib/vrrp";

export const VrrpStateBadge = ({ state }: { state: VrrpState }) => (
    <Badge variant={vrrpStateVariant(state)}>{state}</Badge>
);
