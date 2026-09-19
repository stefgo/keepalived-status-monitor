import type { AlertOptions } from "@stefgo/react-ui-components";

/** What every view shows for a value that is not there. */
export const EMPTY_VALUE = "–";

/** A date from the API as a `Date`, or null when there is none or it cannot be read. */
const toDate = (date: Date | string | number | null | undefined): Date | null => {
    if (!date) return null;

    let d = new Date(date);

    if (typeof date === "string") {
        // Handle SQLite default format "YYYY-MM-DD HH:MM:SS" -> Treat as UTC
        if (date.includes(" ") && !date.includes("T")) {
            d = new Date(date.replace(" ", "T") + "Z");
        }
    }

    return isNaN(d.getTime()) ? null : d;
};

/**
 * The one date format of the interface. Seconds only where they tell events apart -- the
 * activity list, where several steps of one operation land within the same minute.
 */
export const formatDate = (
    date: Date | string | number | null | undefined,
    { seconds = false }: { seconds?: boolean } = {},
): string => {
    const d = toDate(date);
    if (!d) return EMPTY_VALUE;

    return new Intl.DateTimeFormat("de-DE", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        ...(seconds ? { second: "2-digit" as const } : {}),
        hour12: false,
    }).format(d);
};

/** The time of day alone, for entries that sit under a dated one. */
export const formatTime = (date: Date | string | number | null | undefined): string => {
    const d = toDate(date);
    if (!d) return EMPTY_VALUE;

    return new Intl.DateTimeFormat("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).format(d);
};

/** A count with its noun: "1 host", "3 hosts". `many` for nouns without a plain -s plural. */
export const plural = (count: number, one: string, many = `${one}s`): string =>
    `${count} ${count === 1 ? one : many}`;

/**
 * How a client is named everywhere: its display name, or its hostname while it has none.
 * `||` rather than `??` on purpose: an empty display name must fall back as well, or the row
 * shows no name at all.
 */
export const clientName = (client: { displayName?: string | null; hostname: string }): string =>
    client.displayName || client.hostname;

export const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
};

/**
 * A failure as a notice: the title says what did not happen, the server's message why.
 * For an action that was not asked about first -- one that was reports its failure inside
 * its own dialog instead (see `onConfirm` in useConfirm).
 */
export const describeFailure = (title: string, error: unknown): AlertOptions => ({
    title,
    description: getErrorMessage(error),
});
