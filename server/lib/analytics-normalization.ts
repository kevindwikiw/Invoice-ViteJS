type UnknownRecord = Record<string, unknown>;

const MONTH_INDEX: Record<string, number> = {
    january: 0,
    januari: 0,
    february: 1,
    februari: 1,
    march: 2,
    maret: 2,
    april: 3,
    may: 4,
    mei: 4,
    june: 5,
    juni: 5,
    july: 6,
    juli: 6,
    august: 7,
    agustus: 7,
    september: 8,
    october: 9,
    oktober: 9,
    november: 10,
    december: 11,
    desember: 11,
};

function asRecord(value: unknown): UnknownRecord {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as UnknownRecord
        : {};
}

function firstText(...values: unknown[]): string {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
}

function utcDate(year: number, monthIndex: number, day: number): Date | null {
    if (year < 1900 || monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(year, monthIndex, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === monthIndex
        && date.getUTCDate() === day
        ? date
        : null;
}

export function parseInvoicePayload(value: unknown): UnknownRecord {
    if (typeof value !== "string") return asRecord(value);
    try {
        return asRecord(JSON.parse(value));
    } catch {
        return {};
    }
}

export function parseAnalyticsDate(value: unknown): Date | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value !== "string") return null;

    const input = value.trim();
    if (!input) return null;

    const yearFirst = input.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?/);
    if (yearFirst) {
        return utcDate(Number(yearFirst[1]), Number(yearFirst[2]) - 1, Number(yearFirst[3] || 1));
    }

    const dayFirst = input.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (dayFirst) {
        return utcDate(Number(dayFirst[3]), Number(dayFirst[2]) - 1, Number(dayFirst[1]));
    }

    const withoutWeekday = input.includes(",") ? input.slice(input.lastIndexOf(",") + 1).trim() : input;
    const namedDate = withoutWeekday.match(/^(\d{1,2})\s+([\p{L}.]+)\s+(\d{4})$/u);
    if (namedDate) {
        const month = MONTH_INDEX[(namedDate[2] || "").replace(/\./g, "").toLocaleLowerCase("id-ID")];
        if (month !== undefined) return utcDate(Number(namedDate[3]), month, Number(namedDate[1]));
    }

    const namedMonth = withoutWeekday.match(/^([\p{L}.]+)\s+(\d{4})$/u);
    if (namedMonth) {
        const month = MONTH_INDEX[(namedMonth[1] || "").replace(/\./g, "").toLocaleLowerCase("id-ID")];
        if (month !== undefined) return utcDate(Number(namedMonth[2]), month, 1);
    }

    const timestamp = Date.parse(input);
    return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

export function extractEventDate(payload: UnknownRecord, fallbackDate: unknown): Date | null {
    const meta = asRecord(payload.meta);
    const candidates = [
        payload.weddingDate,
        payload.wedding_date,
        payload.eventDate,
        payload.event_date,
        meta.weddingDate,
        meta.wedding_date,
        meta.eventDate,
        meta.event_date,
        fallbackDate,
        payload.date,
    ];

    for (const candidate of candidates) {
        const parsed = parseAnalyticsDate(candidate);
        if (parsed) return parsed;
    }
    return null;
}

export function extractVenue(payload: UnknownRecord): string {
    const meta = asRecord(payload.meta);
    return firstText(
        payload.venue,
        payload.eventVenue,
        payload.event_venue,
        payload.location,
        meta.venue,
        meta.eventVenue,
        meta.event_venue,
        meta.location,
    ) || "Unspecified Venue";
}

export function isSpecifiedVenue(value: string): boolean {
    const normalized = value.trim().toLocaleLowerCase("id-ID");
    return Boolean(normalized)
        && ![
            "unknown",
            "unknown venue",
            "unspecified venue",
            "no venue specified",
            "-",
        ].includes(normalized);
}
