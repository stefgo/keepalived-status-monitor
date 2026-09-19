/**
 * Parses the counters keepalived writes on SIGUSR2 (`/tmp/keepalived.stats` by default):
 *
 *     VRRP Instance: VI_1
 *       Advertisements:
 *         Received: 0
 *         Sent: 1234
 *       Became master: 1
 *       Released master: 0
 *
 * Nested headings become a prefix, so the result is flat and keyed in snake case:
 * `advertisements_received`, `became_master`, `priority_zero_sent` and so on. Every value is
 * a counter, so nothing in this file needs redacting.
 */
export function parseStatsDump(text: string): Map<string, Record<string, number>> {
    const result = new Map<string, Record<string, number>>();
    let current: Record<string, number> | null = null;
    /** Headings still open, as [indent, snake-cased name]. */
    let headings: [number, string][] = [];

    for (const raw of text.split(/\r?\n/)) {
        if (!raw.trim()) continue;
        const indent = raw.length - raw.trimStart().length;
        const content = raw.trim();

        const start = /^VRRP Instance\s*[:=]\s*(\S+)/.exec(content);
        if (start) {
            current = {};
            result.set(start[1], current);
            headings = [];
            continue;
        }
        if (!current) continue;

        headings = headings.filter(([level]) => level < indent);

        const pair = /^([^:]+):\s*(.*)$/.exec(content);
        if (!pair) continue;
        const name = snake(pair[1]);
        if (pair[2] === "") {
            headings.push([indent, name]);
            continue;
        }
        const value = Number(pair[2]);
        if (!Number.isFinite(value)) continue;
        current[[...headings.map(([, h]) => h), name].join("_")] = value;
    }
    return result;
}

function snake(label: string): string {
    return label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
}
