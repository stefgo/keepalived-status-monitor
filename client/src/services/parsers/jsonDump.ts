import { VrrpState } from "@kasm/shared";
import {
    ParsedDump,
    ParsedInstance,
    emptyInstance,
    epochToIso,
    linkSyncGroups,
    toInt,
    toState,
    vipAddress,
} from "./common.js";

/**
 * keepalived's internal state numbers (vrrp.h). The JSON dump writes these instead of words.
 */
const STATE_NUMBERS: Record<number, VrrpState> = {
    0: "INIT",
    1: "BACKUP",
    2: "MASTER",
    3: "FAULT",
    97: "DELETED",
    98: "STOP",
};

function jsonState(value: unknown): VrrpState {
    if (typeof value === "number") return STATE_NUMBERS[value] ?? "UNKNOWN";
    return toState(typeof value === "string" ? value : null);
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
    typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Parses `/tmp/keepalived.json`, written on keepalived's JSON signal when it was built with
 * `--enable-json`: an array of `{ data, stats }`, one per VRRP instance.
 *
 * As with the text dump, fields are picked by name. `data` carries `auth_data` among many
 * others, and only what is listed here leaves this function.
 */
export function parseJsonDump(text: string): {
    dump: ParsedDump;
    stats: Map<string, Record<string, number>>;
} {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("keepalived.json is not an array");

    const instances: ParsedInstance[] = [];
    const stats = new Map<string, Record<string, number>>();

    for (const entry of parsed) {
        if (!isObject(entry) || !isObject(entry.data)) continue;
        const data = entry.data;
        const name = typeof data.iname === "string" ? data.iname : null;
        if (!name) continue;

        const instance = emptyInstance(name);
        instance.state = jsonState(data.state);
        instance.wantedState = data.wantstate !== undefined ? jsonState(data.wantstate) : null;
        instance.interface = typeof data.ifp_ifname === "string" ? data.ifp_ifname : null;
        instance.vrid = toInt(data.vrid as number);
        instance.priority = toInt(data.base_priority as number);
        instance.effectivePriority = toInt(data.effective_priority as number);
        if (typeof data.adver_int === "number") {
            // Seconds in current releases; older ones wrote the internal microsecond timer.
            instance.advertInterval = data.adver_int >= 1000 ? data.adver_int / 1_000_000 : data.adver_int;
        }
        if (Array.isArray(data.vips)) {
            instance.vips = data.vips
                .map((v) => (typeof v === "string" ? vipAddress(v) : null))
                .filter((v): v is string => v !== null);
        }
        instance.lastTransition = epochToIso(data.last_transition as number);
        instance.syncGroup = typeof data.sync_group === "string" ? data.sync_group : null;
        instances.push(instance);

        if (isObject(entry.stats)) {
            const counters: Record<string, number> = {};
            for (const [key, value] of Object.entries(entry.stats)) {
                if (typeof value === "number" && Number.isFinite(value)) counters[key] = value;
            }
            stats.set(name, counters);
        }
    }

    return { dump: linkSyncGroups({ instances, syncGroups: [] }), stats };
}
