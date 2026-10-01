export interface InvoiceDensityItem {
    name?: string;
    desc?: string;
    isBundle?: boolean;
    bundleSrc?: Array<{ desc?: string }>;
}

const EXTRAS_PATTERN = /\b(?:extras?|add[ -]?ons?)\b/i;

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
