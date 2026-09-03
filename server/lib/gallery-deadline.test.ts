import { describe, expect, test } from "bun:test";

import {
    isSelectionDeadlineExpired,
    parseSelectionDurationHours,
    resolveGalleryDeadlineUpdate,
    selectionDeadlineEpochSeconds,
    selectionDeadlineFromNow,
} from "./gallery-deadline";

describe("gallery selection deadlines", () => {
    test("accepts only whole-hour durations from 1 through 8760", () => {
        expect(parseSelectionDurationHours(1)).toBe(1);
        expect(parseSelectionDurationHours("8760")).toBe(8760);
        expect(parseSelectionDurationHours(0)).toBeNull();
        expect(parseSelectionDurationHours(8761)).toBeNull();
        expect(parseSelectionDurationHours(2.5)).toBeNull();
    });

    test("creates a UTC deadline from the save time", () => {
        const now = Date.parse("2026-09-02T03:00:00.000Z");
        expect(selectionDeadlineFromNow(72, now)).toBe("2026-09-05T03:00:00.000Z");
    });

    test("expires at the deadline and caps photo-token expiry", () => {
        const deadline = "2026-09-05T03:00:00.000Z";
        expect(isSelectionDeadlineExpired(deadline, Date.parse("2026-09-05T02:59:59.999Z"))).toBe(false);
        expect(isSelectionDeadlineExpired(deadline, Date.parse(deadline))).toBe(true);
        expect(selectionDeadlineEpochSeconds(deadline)).toBe(1_788_577_200);
    });

    test("does not reset a deadline when unrelated fields are saved", () => {
        const deadline = "2026-09-05T03:00:00.000Z";
        expect(resolveGalleryDeadlineUpdate({
            existingDurationHours: 72,
            existingDeadlineAt: deadline,
            nextStatus: "open",
            durationWasProvided: false,
            now: Date.parse("2026-09-03T03:00:00.000Z"),
        })).toEqual({ selectionDurationHours: 72, selectionDeadlineAt: deadline, status: "open" });
    });

    test("keeps an expired gallery closed after its duration is renewed", () => {
        expect(resolveGalleryDeadlineUpdate({
            existingDurationHours: 72,
            existingDeadlineAt: "2026-09-02T03:00:00.000Z",
            nextStatus: "open",
            durationWasProvided: true,
            requestedDurationHours: 168,
            now: Date.parse("2026-09-03T03:00:00.000Z"),
        })).toEqual({
            selectionDurationHours: 168,
            selectionDeadlineAt: "2026-09-10T03:00:00.000Z",
            status: "closed",
        });
    });

    test("requires a renewed duration before reopening an expired gallery", () => {
        expect(() => resolveGalleryDeadlineUpdate({
            existingDurationHours: 72,
            existingDeadlineAt: "2026-09-02T03:00:00.000Z",
            nextStatus: "open",
            requestedStatus: "open",
            durationWasProvided: false,
            now: Date.parse("2026-09-03T03:00:00.000Z"),
        })).toThrow("Set a new selection duration before reopening this expired gallery.");
    });
});
