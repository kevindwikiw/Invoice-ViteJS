export function parseDateValue(value: unknown): Date | null {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
    if (typeof value === 'number') {
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date : null;
    }
    if (typeof value !== 'string') return null;

    const text = value.trim();
    if (!text) return null;

    // SQLite CURRENT_TIMESTAMP uses `YYYY-MM-DD HH:mm:ss` without a zone.
    // Treat it as UTC and normalize it for Safari's stricter parser.
    let normalized = text.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += 'T00:00:00Z';
    else if (/^\d{4}-\d{2}-\d{2}T.*$/.test(normalized) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) normalized += 'Z';

    const timestamp = Date.parse(normalized);
    return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

export function formatDateValue(
    value: unknown,
    formatter: Intl.DateTimeFormat,
    fallback = '-',
): string {
    const date = parseDateValue(value);
    return date ? formatter.format(date) : fallback;
}
