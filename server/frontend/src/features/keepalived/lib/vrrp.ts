import type { BadgeProps } from "@stefgo/react-ui-components";
import type { VrrpClusterHealth, VrrpState } from "@kasm/shared";

/**
 * One colour per state, used everywhere a state is shown. MASTER is green because it is the
 * node that serves; BACKUP is the healthy standby, not a warning.
 */
export function vrrpStateVariant(state: VrrpState): NonNullable<BadgeProps["variant"]> {
    switch (state) {
        case "MASTER":
            return "success";
        case "BACKUP":
            return "info";
        case "FAULT":
            return "error";
        case "INIT":
        case "STOP":
            return "warning";
        default:
            return "neutral";
    }
}

export const CLUSTER_HEALTH: Record<
    VrrpClusterHealth,
    { label: string; variant: NonNullable<BadgeProps["variant"]>; description: string }
> = {
    ok: { label: "Healthy", variant: "success", description: "One MASTER, every member reporting." },
    degraded: {
        label: "Degraded",
        variant: "warning",
        description: "One MASTER holds, but a member is in FAULT, offline, or the only one left.",
    },
    "no-master": {
        label: "No MASTER",
        variant: "error",
        description: "No online member is MASTER: the virtual addresses are not served.",
    },
    "split-brain": {
        label: "Split brain",
        variant: "error",
        description: "More than one member claims MASTER for the same virtual router.",
    },
    unknown: { label: "Unknown", variant: "neutral", description: "No member of this cluster is online." },
};

/** keepalived reports fractions of a second; whole seconds read better. */
export function formatInterval(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined) return "–";
    return Number.isInteger(seconds) ? `${seconds} s` : `${seconds.toFixed(2)} s`;
}

/** `advertisements_received` → `Advertisements received`. */
export function statLabel(key: string): string {
    const text = key.replace(/_/g, " ");
    return text.charAt(0).toUpperCase() + text.slice(1);
}
