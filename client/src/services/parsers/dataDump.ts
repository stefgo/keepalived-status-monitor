import {
    ParsedDump,
    ParsedInstance,
    ParsedSyncGroup,
    emptyInstance,
    epochToIso,
    linkSyncGroups,
    toInt,
    toState,
    vipAddress,
} from "./common.js";

/**
 * Parses the text dump keepalived writes on SIGUSR1 (`/tmp/keepalived.data` by default).
 *
 * The format is meant for people, not programs, and has changed between releases. The
 * parser therefore reads it line by line as `key = value` pairs inside a block, and a key it
 * does not know is skipped rather than an error. Only the keys below are taken over.
 *
 *     ------< VRRP Topology >------
 *      VRRP Instance = VI_1
 *        State = MASTER
 *        Wantstate = MASTER
 *        Last transition = 1726740745.123456 (Thu Sep 19 10:12:25.123456 2024)
 *        Interface = eth0
 *        Virtual Router ID = 51
 *        Priority = 150
 *        Effective priority = 150
 *        Advert interval = 1 sec
 *        Virtual IP (1):
 *          192.168.1.100/24 dev eth0 scope global
 *     ------< VRRP Sync groups >------
 *      VRRP Sync Group = VG_1, MASTER
 *        VRRP member instances = 1
 *          VI_1
 */
export function parseDataDump(text: string): ParsedDump {
    const instances: ParsedInstance[] = [];
    const syncGroups: ParsedSyncGroup[] = [];

    let instance: ParsedInstance | null = null;
    let group: ParsedSyncGroup | null = null;
    /** Indentation of the `Virtual IP` header while its address lines are being read. */
    let vipIndent: number | null = null;

    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/\s+$/, "");
        if (!line.trim()) continue;
        const indent = line.length - line.trimStart().length;
        const content = line.trim();

        // A section header ends whatever block was open.
        if (/^-+<.*>-+$/.test(content)) {
            instance = null;
            group = null;
            vipIndent = null;
            continue;
        }

        const instanceStart = /^VRRP Instance\s*=\s*(\S+)/.exec(content);
        if (instanceStart) {
            instance = emptyInstance(instanceStart[1]);
            instances.push(instance);
            group = null;
            vipIndent = null;
            continue;
        }

        const groupStart = /^VRRP Sync Group\s*=\s*([^,\s]+)(?:\s*,\s*(\S+))?/.exec(content);
        if (groupStart) {
            group = { name: groupStart[1], state: toState(groupStart[2]), instances: [] };
            syncGroups.push(group);
            instance = null;
            vipIndent = null;
            continue;
        }

        if (instance && vipIndent !== null) {
            const address = indent > vipIndent ? vipAddress(content) : null;
            if (address) {
                instance.vips.push(address);
                continue;
            }
            vipIndent = null;
        }

        if (instance) {
            if (/^Virtual IP\b(?! Excluded)/i.test(content) && !/=\s*\S*[a-z]/i.test(content)) {
                vipIndent = indent;
                continue;
            }
            const pair = /^([^=]+?)\s*=\s*(.*)$/.exec(content);
            if (pair) applyInstanceKey(instance, pair[1].toLowerCase(), pair[2]);
            continue;
        }

        if (group) {
            // Member names stand on a line of their own, or after `monitor =` in some builds.
            const monitor = /^(?:monitor|instance)\s*=\s*(\S+)$/i.exec(content);
            if (monitor) group.instances.push(monitor[1]);
            else if (/^[\w.-]+$/.test(content) && !/^\d+$/.test(content)) group.instances.push(content);
        }
    }

    return linkSyncGroups({ instances, syncGroups });
}

function applyInstanceKey(instance: ParsedInstance, key: string, value: string): void {
    switch (key) {
        case "state":
            instance.state = toState(value);
            break;
        case "wantstate":
        case "wanted state":
            instance.wantedState = toState(value);
            break;
        case "interface":
            // Track sections repeat the key further down; the first one is the instance's own.
            instance.interface ??= value.trim() || null;
            break;
        case "virtual router id":
            instance.vrid = toInt(value);
            break;
        case "priority":
        case "base priority":
            instance.priority ??= toInt(value);
            break;
        case "effective priority":
            instance.effectivePriority = toInt(value);
            break;
        case "advert interval":
            instance.advertInterval = parseInterval(value);
            break;
        case "last transition":
            instance.lastTransition = epochToIso(value.split(/\s/)[0]);
            break;
        case "sync group":
            instance.syncGroup = value.split(/[,\s]/)[0] || null;
            break;
        case "virtual ip":
            // `Virtual IP = 1` is the count in older releases; the addresses follow as lines.
            break;
    }
}

/** `1 sec`, `1000 milli-sec`, `100000 usec` -- always returned in seconds. */
function parseInterval(value: string): number | null {
    const match = /^([\d.]+)\s*(\S*)/.exec(value.trim());
    if (!match) return null;
    const n = parseFloat(match[1]);
    if (!Number.isFinite(n)) return null;
    const unit = match[2].toLowerCase();
    if (unit.startsWith("milli") || unit === "ms" || unit === "msec") return n / 1000;
    if (unit.startsWith("micro") || unit === "us" || unit === "usec") return n / 1_000_000;
    return n;
}
