export interface InvoiceDensityItem {
    name?: string;
    desc?: string;
    details?: string;
    isBundle?: boolean;
    bundleSrc?: Array<{ desc?: string; details?: string }>;
}

export interface InvoicePdfScaleOptions {
    eventDetailCount: number;
    paymentTermCount: number;
    termsLines: string[];
    notes?: string;
}

const EXTRAS_PATTERN = /\b(?:extras?|add[ -]?ons?)\b/i;
const A4_HEIGHT_PT = 841.89;
const TABLE_TOP_PT = 155;
const FOOTER_RESERVE_PT = 45;
const BOTTOM_BREATHING_ROOM_PT = 12;
const TABLE_HEADER_HEIGHT_PT = 30;
const BASE_DETAIL_LINE_HEIGHT_PT = 8.54;
const BASE_ROW_VERTICAL_PADDING_PT = 16;

const clamp = (value: number, min: number, max: number): number => (
    Math.min(max, Math.max(min, value))
);

function wrappedLineCount(value: string | undefined, charsPerLine: number): number {
    if (!value?.trim()) return 0;

    return value
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .reduce(
            (total, line) => total + Math.max(1, Math.ceil(line.trim().length / charsPerLine)),
            0,
        );
}

function itemVisualLines(item: InvoiceDensityItem): number {
    if (item.isBundle && item.bundleSrc?.length) {
        return 1 + item.bundleSrc.reduce(
            (total, section) => total + 1 + wrappedLineCount(section.details, 54),
            0,
        );
    }

    return 1
        + (item.desc && item.desc !== item.name ? 1 : 0)
        + wrappedLineCount(item.details, 54);
}

function isExtrasItem(item: InvoiceDensityItem): boolean {
    return EXTRAS_PATTERN.test(`${item.name ?? ''} ${item.desc ?? ''}`);
}

export function shouldUseDenseInvoiceLayout(items: InvoiceDensityItem[]): boolean {
    const hasExtras = items.some(isExtrasItem);
    if (!hasExtras) return false;

    const primaryItems = items.filter((item) => !isExtrasItem(item));
    const hasLargeBundle = primaryItems.some(
        (item) => item.isBundle && (item.bundleSrc?.length ?? 0) >= 3,
    );

    return hasLargeBundle || primaryItems.length >= 3;
}

export function calculateInvoicePdfScale(
    items: InvoiceDensityItem[],
    options: InvoicePdfScaleOptions,
): number {
    const leftPostLines = (options.eventDetailCount > 0 ? 1 + options.eventDetailCount : 0)
        + 4
        + (options.termsLines.length > 0
            ? 1 + options.termsLines.reduce((total, line) => total + wrappedLineCount(line, 72), 0)
            : 0);
    const rightPostLines = 3
        + Math.max(2, options.paymentTermCount)
        + (options.notes?.trim() ? 1 + wrappedLineCount(options.notes, 46) : 0);
    const postHeight = Math.max(leftPostLines, rightPostLines) * 8.5 + 32;
    const availableTableHeight = Math.max(
        180,
        A4_HEIGHT_PT
            - TABLE_TOP_PT
            - FOOTER_RESERVE_PT
            - BOTTOM_BREATHING_ROOM_PT
            - postHeight,
    );
    const estimatedTableHeight = TABLE_HEADER_HEIGHT_PT + items.reduce(
        (total, item) => total
            + itemVisualLines(item) * BASE_DETAIL_LINE_HEIGHT_PT
            + BASE_ROW_VERTICAL_PADDING_PT,
        0,
    );
    const rawScale = Math.sqrt(availableTableHeight / Math.max(estimatedTableHeight, 1));
    const minimumScale = shouldUseDenseInvoiceLayout(items) ? 0.88 : 0.96;

    return Number(clamp(rawScale, minimumScale, 1.1).toFixed(3));
}
