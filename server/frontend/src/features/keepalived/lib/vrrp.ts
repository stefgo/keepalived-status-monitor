import type { BadgeProps } from "@stefgo/react-ui-components";
import type { KeepalivedState, VrrpClusterHealth, VrrpState } from "@kasm/shared";

/**
 * One host's reading in a few words: whether keepalived could be read, and how many of its
 * instances serve or have failed. A process the agent found but could not read is running,
 * yet reports nothing -- "Unreadable", so its zero counts are not taken for the truth.
 */
export function summarizeKeepalived(state: KeepalivedState) {
    return {
        status: state.running ? (state.error ? "Unreadable" : "Running") : "Stopped",
        instances: state.instances.length,
        masters: state.instances.filter((instance) => instance.state === "MASTER").length,
        faults: state.instances.filter((instance) => instance.state === "FAULT").length,
    };
}

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
