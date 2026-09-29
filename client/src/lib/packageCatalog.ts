import type { InvoiceItem, PackageData } from '../types/invoice';

export const PACKAGE_CATEGORY_TONES: Record<string, string> = {
    Wedding: 'border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-300',
    'Bundling Package': 'border-violet-500/25 bg-violet-500/10 text-violet-600 dark:text-violet-300',
    Prewedding: 'border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-300',
    'Engagement/Sangjit': 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    'Corporate/Event': 'border-indigo-500/25 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300',
    'Add-ons': 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
    'Free / Complimentary': 'border-teal-500/25 bg-teal-500/10 text-teal-600 dark:text-teal-300',
};

export function packageCategoryTone(category: string): string {
    return PACKAGE_CATEGORY_TONES[category]
        || 'border-[var(--accent)]/25 bg-[var(--accent)]/5 text-[var(--accent)]';
}

export function packageRowId(pkg: PackageData): string {
    return String(pkg.id);
}

export function packageDisplayName(name: string): string {
    const trimmedName = name.trim();

    if (trimmedName !== trimmedName.toLocaleUpperCase('id-ID')) {
        return trimmedName;
    }

    return trimmedName
        .toLocaleLowerCase('id-ID')
        .replace(/\p{L}+/gu, (word) => word.charAt(0).toLocaleUpperCase('id-ID') + word.slice(1));
}

export interface PackageBundleSection {
    title: string;
    details: string;
}

const BUNDLE_HEADING = /^\s*(?:[-*•]\s*)?\*\*(.+?)\*\*\s*$/;

export function parsePackageBundleDescription(description: string): PackageBundleSection[] {
    const sections: PackageBundleSection[] = [];
    let current: { title: string; details: string[] } | null = null;

    for (const rawLine of description.replace(/\r\n?/g, '\n').split('\n')) {
        const heading = rawLine.match(BUNDLE_HEADING);
        if (heading) {
            if (current) sections.push({ title: current.title, details: current.details.join('\n') });
            current = { title: heading[1].trim(), details: [] };
            continue;
        }
        if (!current) continue;
        const detail = rawLine.trim().replace(/^(?:[-*]|•)\s*/, '');
        if (detail) current.details.push(detail);
    }

    if (current) sections.push({ title: current.title, details: current.details.join('\n') });
    return sections.filter((section) => section.title && section.details);
}

function uniqueItemId(packageId: number): string {
    const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return `item_${packageId}_${suffix}`;
}

export function invoiceItemFromPackage(pkg: PackageData): InvoiceItem {
    const bundleSections = parsePackageBundleDescription(pkg.description);
    const isBundle = bundleSections.length > 0;

    return {
        id: uniqueItemId(pkg.id),
        name: pkg.name,
        desc: pkg.name,
        details: isBundle ? undefined : pkg.description,
        price: pkg.price,
        qty: 1,
        isBundle,
        _rowId: packageRowId(pkg),
        ...(isBundle ? {
            _bundleSrc: bundleSections.map((section, index) => ({
                id: `bundle_section_${pkg.id}_${index}`,
                desc: section.title,
                details: section.details,
                price: 0,
                qty: 1,
            })),
        } : {}),
    };
}
