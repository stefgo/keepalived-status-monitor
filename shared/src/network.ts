/**
 * Network arithmetic, in shared because several sides ask the same questions of it: the
 * server decides whether an agent may connect, the agent decides whether the server may dial
 * it, the client editor shows whether a value would still admit the agent, and the VRRP
 * clusters are grouped by the network their addresses sit on. A copy in any of them would be
 * a second answer to one question.
 *
 * The admission checks below (`isIpInCidr` and everything built on it) are IPv4 only and say
 * so. `ipNetwork` and `networkContains` are not: a virtual address may well be IPv6, and a
 * cluster grouped by a network it could not parse would be a cluster per host.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * Strips the IPv4-mapped IPv6 prefix. A dual-stack listener reports `::ffff:10.0.0.5` for
 * what is an IPv4 peer; read as it is, that address would have been converted to 0 and
 * matched against networks as 0.0.0.0 -- a wrong decision rather than a failed one.
 */
export function normaliseIp(ip: string): string {
    return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

/** The address as a 32-bit integer, or null for anything that is not dotted IPv4. */
function ipToLong(ip: string): number | null {
    const octets = ipv4ToBytes(ip);
    if (!octets) return null;
    return (
        ((octets[0] << 24) >>> 0) +
        ((octets[1] << 16) >>> 0) +
        ((octets[2] << 8) >>> 0) +
        octets[3]
    );
}

/**
 * Whether an address lies within a network. A value without a prefix length is a /32.
 *
 * An address that is not IPv4 -- a real IPv6 peer -- matches only /0. It used to be
 * converted to 0 and so matched every network that contains 0.0.0.0.
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
    const [range, bitsStr] = cidr.split("/");
    const bits = bitsStr === undefined ? 32 : Number(bitsStr);
    if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
    if (bits === 0) return true;

    const ipLong = ipToLong(normaliseIp(ip));
    const rangeLong = ipToLong(range);
    if (ipLong === null || rangeLong === null) return false;

    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return ((ipLong & mask) >>> 0) === ((rangeLong & mask) >>> 0);
}

/**
 * Whether an address is in any of the networks. An empty list means no restriction was
 * configured, and `defaultAllow` says what that means to the caller.
 */
export function isIpInNetworks(
    ip: string,
    networks: string[],
    defaultAllow = false,
): boolean {
    if (!networks || networks.length === 0) return defaultAllow;
    return networks.some((cidr) => isIpInCidr(ip, cidr));
}

// ── Networks of an address ───────────────────────────────────────────────────

/** An address split into its bytes, with the prefix length that came with it. */
interface ParsedNetwork {
    bytes: number[];
    bits: number;
}

/** The four octets, or null for anything that is not dotted IPv4. */
function ipv4ToBytes(ip: string): number[] | null {
    const match = IPV4.exec(ip);
    if (!match) return null;
    const octets = match.slice(1).map(Number);
    return octets.some((octet) => octet > 255) ? null : octets;
}

/**
 * The sixteen bytes of an IPv6 address, or null. Handles the `::` run and a trailing dotted
 * quad (`64:ff9b::192.0.2.1`), which is how keepalived writes a translated address.
 */
function ipv6ToBytes(ip: string): number[] | null {
    const runs = ip.split("::");
    if (runs.length > 2) return null;

    const toGroups = (part: string): number[][] | null => {
        if (part === "") return [];
        const groups: number[][] = [];
        const tokens = part.split(":");
        for (const [index, token] of tokens.entries()) {
            // A dotted quad is only allowed as the last token, where it stands for two groups.
            if (token.includes(".")) {
                const quad = index === tokens.length - 1 ? ipv4ToBytes(token) : null;
                if (!quad) return null;
                groups.push([quad[0], quad[1]], [quad[2], quad[3]]);
                continue;
            }
            if (!/^[0-9a-fA-F]{1,4}$/.test(token)) return null;
            const value = parseInt(token, 16);
            groups.push([value >> 8, value & 0xff]);
        }
        return groups;
    };

    const head = toGroups(runs[0]);
    const tail = runs.length === 2 ? toGroups(runs[1]) : [];
    if (!head || !tail) return null;

    const missing = 8 - head.length - tail.length;
    if (runs.length === 2 ? missing < 1 : missing !== 0) return null;
    const zeros = Array.from({ length: missing }, () => [0, 0]);
    return [...head, ...zeros, ...tail].flat();
}

/** An address with an optional prefix; without one it stands for itself, so /32 or /128. */
function parseNetwork(value: string): ParsedNetwork | null {
    const [address, bitsText, ...rest] = value.trim().split("/");
    if (rest.length > 0 || address === undefined) return null;

    const ip = normaliseIp(address);
    const bytes = ip.includes(":") ? ipv6ToBytes(ip) : ipv4ToBytes(ip);
    if (!bytes) return null;

    const width = bytes.length * 8;
    const bits = bitsText === undefined ? width : Number(bitsText);
    if (bitsText === "" || !Number.isInteger(bits) || bits < 0 || bits > width) return null;
    return { bytes, bits };
}

/** Everything past the prefix set to zero. */
function maskBytes(bytes: number[], bits: number): number[] {
    return bytes.map((byte, index) => {
        const taken = Math.min(Math.max(bits - index * 8, 0), 8);
        return byte & ((0xff << (8 - taken)) & 0xff);
    });
}

/** `[192, 0, 2, 1]` → `192.0.2.1`. */
const formatIpv4 = (bytes: number[]) => bytes.join(".");

/** The sixteen bytes as an address, with the longest run of zero groups compressed to `::`. */
function formatIpv6(bytes: number[]): string {
    const groups: number[] = [];
    for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1]);

    let best = { at: -1, length: 0 };
    let run = { at: -1, length: 0 };
    for (const [index, group] of groups.entries()) {
        run = group === 0 ? { at: run.length === 0 ? index : run.at, length: run.length + 1 } : { at: -1, length: 0 };
        // A single zero group is written out; `::` is only worth it from two on.
        if (run.length > best.length && run.length > 1) best = run;
    }

    const text = groups.map((group) => group.toString(16));
    if (best.at < 0) return text.join(":");
    return `${text.slice(0, best.at).join(":")}::${text.slice(best.at + best.length).join(":")}`;
}

/**
 * The network an address sits on, canonically written: `172.28.0.100/24` → `172.28.0.0/24`.
 * An address without a prefix is the host route keepalived makes of it, so `/32` or `/128`,
 * and then only ever matches itself. `null` for anything unparsable.
 */
export function ipNetwork(value: string): string | null {
    const parsed = parseNetwork(value);
    if (!parsed) return null;
    const masked = maskBytes(parsed.bytes, parsed.bits);
    const address = masked.length === 4 ? formatIpv4(masked) : formatIpv6(masked);
    return `${address}/${parsed.bits}`;
}

/**
 * Whether one network holds another -- a `/32` inside its `/24`, or a network inside itself.
 * Two networks of different families never do. Used to decide whether two VRRP instances sit
 * on the same segment, where the hosts may write their addresses with or without a prefix.
 */
export function networkContains(outer: string, inner: string): boolean {
    const a = parseNetwork(outer);
    const b = parseNetwork(inner);
    if (!a || !b || a.bytes.length !== b.bytes.length || a.bits > b.bits) return false;
    const left = maskBytes(a.bytes, a.bits);
    const right = maskBytes(b.bytes, a.bits);
    return left.every((byte, index) => byte === right[index]);
}

/**
 * Whether two networks describe the same segment: either holds the other. `10.0.0.5/32` and
 * `10.0.0.9/24` do, `10.0.0.5/32` and `10.0.0.9/32` do not -- two host routes are only ever
 * the same segment if they are the same address.
 */
export function networksOverlap(a: string, b: string): boolean {
    return networkContains(a, b) || networkContains(b, a);
}

/**
 * Whether an address is admitted by one client's stored value.
 *
 * `null` means the check is switched off for that client -- a decision made in the client
 * editor, for a host whose address its environment hands out. A value with a `/` is a
 * network; without, it is compared exactly, which keeps the check meaningful for a client
 * registered from an IPv6 address.
 */
export function isIpAllowed(ip: string, allowed: string | null): boolean {
    if (!allowed) return true;
    return allowed.includes("/")
        ? isIpInCidr(ip, allowed)
        : normaliseIp(allowed) === normaliseIp(ip);
}
