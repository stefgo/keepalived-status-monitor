import { formatDate } from "../../../utils";

/**
 * What the page of a client that is not connected says in place of its instances: since
 * when it is gone, and how old the reading it left behind is.
 *
 * The instances themselves stay away. The last reading would read as current here, where
 * nothing stands next to it -- on the page of a cluster the same reading is dimmed beside
 * the hosts that still report, which is where the notice points. But an empty page below a
 * header reads as a broken one.
 */
export interface OfflineNotice {
    title: string;
    lines: string[];
}

export function offlineNotice(
    { lastSeen, readingAt }: { lastSeen?: string | null; readingAt?: string | null },
    locale?: string,
): OfflineNotice {
    return {
        title: lastSeen
            ? `This client is offline, last seen ${formatDate(lastSeen, { locale })}`
            : "This client has not connected yet",
        lines: [
            readingAt
                ? `Its VRRP instances are not listed: the last reading it reported is from ${formatDate(readingAt, { locale })} and would read as current.`
                : "It has not reported a keepalived reading yet.",
        ],
    };
}
