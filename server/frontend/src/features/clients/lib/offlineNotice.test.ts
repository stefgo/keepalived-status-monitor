import { describe, expect, it } from "vitest";
import { formatDate } from "../../../utils";
import { offlineNotice } from "./offlineNotice";

const LAST_SEEN = "2026-10-04T09:47:41.000Z";
const READING_AT = "2026-10-04T09:40:00.000Z";
const at = (date: string) => formatDate(date, { locale: "en-US" });

describe("offlineNotice", () => {
    it("says since when the client is gone and how old its last reading is", () => {
        const notice = offlineNotice({ lastSeen: LAST_SEEN, readingAt: READING_AT }, "en-US");
        expect(notice.title).toBe(`This client is offline, last seen ${at(LAST_SEEN)}`);
        expect(notice.lines[0]).toContain(`is from ${at(READING_AT)}`);
    });

    it("says so when the client never reported a reading", () => {
        const notice = offlineNotice({ lastSeen: LAST_SEEN, readingAt: null }, "en-US");
        expect(notice.lines).toEqual(["It has not reported a keepalived reading yet."]);
    });

    it("does not invent a date for a client that never connected", () => {
        const notice = offlineNotice({ lastSeen: null }, "en-US");
        expect(notice.title).toBe("This client has not connected yet");
    });
});
