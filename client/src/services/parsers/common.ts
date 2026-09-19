import { VRRP_STATES, VrrpState } from "@kasm/shared";

/**
 * What a parser hands back. Instances and sync groups are built field by field from a fixed
 * list of keys -- never by copying what the dump contains. That is the redaction: a dump
 * carries `auth_pass` and whatever else keepalived chooses to print, and nothing that is not
 * named here can reach the wire.
 */
export interface ParsedInstance {
    name: string;
    state: VrrpState;
    wantedState: VrrpState | null;
    interface: string | null;
    vrid: number | null;
    priority: number | null;
    effectivePriority: number | null;
    advertInterval: number | null;
    vips: string[];
    syncGroup: string | null;
    lastTransition: string | null;
}

export interface ParsedSyncGroup {
    name: string;
    state: VrrpState;
    instances: string[];
}

export interface ParsedDump {
    instances: ParsedInstance[];
    syncGroups: ParsedSyncGroup[];
}

export function emptyInstance(name: string): ParsedInstance {
    return {
        name,
        state: "UNKNOWN",
        wantedState: null,
        interface: null,
        vrid: null,
        priority: null,
        effectivePriority: null,
        advertInterval: null,
        vips: [],
        syncGroup: null,
        lastTransition: null,
    };
}

/** keepalived's own spelling, upper-cased; anything else is UNKNOWN rather than an error. */
export function toState(value: string | null | undefined): VrrpState {
    const word = value?.trim().toUpperCase() ?? "";
    return (VRRP_STATES as readonly string[]).includes(word) ? (word as VrrpState) : "UNKNOWN";
}

export function toInt(value: string | number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    const n = typeof value === "number" ? value : parseInt(value, 10);
    return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Seconds since the epoch, with fractions, as keepalived writes them. */
export function epochToIso(value: string | number | null | undefined): string | null {
    const seconds = typeof value === "number" ? value : parseFloat(value ?? "");
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return new Date(seconds * 1000).toISOString();
}

/** The address itself, without the `dev eth0 scope global` keepalived appends. */
export function vipAddress(entry: string): string | null {
    const token = entry.trim().split(/\s+/)[0];
    return token && /^[0-9a-fA-F.:]+(\/\d+)?$/.test(token) ? token : null;
}

/** Links sync groups and instances both ways, whichever side the dump named it on. */
export function linkSyncGroups(dump: ParsedDump): ParsedDump {
    const byName = new Map(dump.instances.map((instance) => [instance.name, instance]));
    for (const group of dump.syncGroups) {
        for (const member of group.instances) {
            const instance = byName.get(member);
            if (instance && !instance.syncGroup) instance.syncGroup = group.name;
        }
    }
    for (const instance of dump.instances) {
        if (!instance.syncGroup) continue;
        const group = dump.syncGroups.find((g) => g.name === instance.syncGroup);
        if (group && !group.instances.includes(instance.name)) group.instances.push(instance.name);
    }
    return dump;
}
