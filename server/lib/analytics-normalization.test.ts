import { describe, expect, test } from "bun:test";

import {
    extractEventDate,
    extractVenue,
    isSpecifiedVenue,
    parseAnalyticsDate,
    parseInvoicePayload,
} from "./analytics-normalization";

describe("analytics normalization", () => {
    test("reads September event dates and venues from legacy Python metadata", () => {
        const payload = parseInvoicePayload(JSON.stringify({
            meta: {
                wedding_date: "Saturday, 12 September 2026",
                venue: "The Ritz-Carlton Ballroom",
            },
        }));

        const date = extractEventDate(payload, "2026-08-14");

        expect(date?.getUTCFullYear()).toBe(2026);
        expect(date?.getUTCMonth()).toBe(8);
        expect(date?.getUTCDate()).toBe(12);
        expect(extractVenue(payload)).toBe("The Ritz-Carlton Ballroom");
    });

    test("prefers the event date over the invoice fallback date", () => {
        const date = extractEventDate({ weddingDate: "2026-09-21" }, "2026-08-14");
        expect(date?.toISOString().slice(0, 10)).toBe("2026-09-21");
    });

    test("supports Indonesian named dates and common numeric formats", () => {
        expect(parseAnalyticsDate("21 September 2026")?.toISOString().slice(0, 10)).toBe("2026-09-21");
        expect(parseAnalyticsDate("1 Agustus 2026")?.toISOString().slice(0, 10)).toBe("2026-08-01");
        expect(parseAnalyticsDate("21/09/2026")?.toISOString().slice(0, 10)).toBe("2026-09-21");
    });

    test("does not treat placeholder venues as a real top venue candidate", () => {
        expect(isSpecifiedVenue("Unspecified Venue")).toBe(false);
        expect(isSpecifiedVenue("Unknown Venue")).toBe(false);
        expect(isSpecifiedVenue("Ayana Bali")).toBe(true);
    });
});
