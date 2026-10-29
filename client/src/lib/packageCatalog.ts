import type { InvoiceItem, PackageData } from '../types/invoice';

export const PRICING_CITIES = ['Bandung', 'Jakarta'] as const;

export function pricingCitiesFromPackages(packages: PackageData[]): string[] {
    const cities = new Map<string, string>(PRICING_CITIES.map((city) => [city.toLocaleLowerCase('id-ID'), city]));
    for (const pkg of packages) {
        for (const entry of pkg.prices ?? []) {
            const city = entry.city.trim();
            if (city) cities.set(city.toLocaleLowerCase('id-ID'), city);
        }
    }
    return [...cities.values()].sort((a, b) => a.localeCompare(b, 'id-ID'));
}

export function canonicalPricingCity(value: string, cities: readonly string[]): string | null {
    const normalized = value.trim().toLocaleLowerCase('id-ID');
    return cities.find((city) => city.toLocaleLowerCase('id-ID') === normalized) ?? null;
}

export function eventPricingYear(eventDate: string): number | null {
    const match = /^(\d{4})-\d{2}-\d{2}$/.exec(eventDate);
    return match ? Number(match[1]) : null;
}

export function resolvePackagePrice(pkg: PackageData, city: string, year: number | null): number | null {
    if (!city.trim() || year === null) return null;
    if (year === 2026) {
        return Number.isSafeInteger(pkg.price) && (pkg.price > 0 || (pkg.price === 0 && pkg.category === 'Free / Complimentary'))
            ? pkg.price : null;
    }
    const canonicalCity = canonicalPricingCity(city, pkg.prices?.map((entry) => entry.city) ?? []);
    if (!canonicalCity) return null;
    return pkg.prices?.find((entry) => entry.city.toLocaleLowerCase('id-ID') === canonicalCity.toLocaleLowerCase('id-ID') && entry.year === year)?.price ?? null;
}

export function packagePriceLabel(pkg: PackageData, city: string, year: number | null): string {
    const price = resolvePackagePrice(pkg, city, year);
    if (price !== null) return `Rp ${price.toLocaleString('id-ID')}`;
    if (!city.trim() || year === null) return '';
    return 'Harga belum diisi';
}

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

const BULLET_PREFIX = String.raw`(?:[-*\u2022\u00b7\u2023\u25aa\u25e6]|\u00e2\u20ac\u00a2)`;
const BUNDLE_HEADING = new RegExp(
    String.raw`^\s*(?:${BULLET_PREFIX}\s*)?\*\*(.+?)\*\*\s*$`,
    'u',
);
const DETAIL_PREFIX = new RegExp(String.raw`^(?:${BULLET_PREFIX})\s*`, 'u');

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
        const detail = rawLine.trim().replace(DETAIL_PREFIX, '');
        if (detail) current.details.push(detail);
    }

    if (current) sections.push({ title: current.title, details: current.details.join('\n') });
    return sections.filter((section) => section.title);
}

function uniqueItemId(packageId: number): string {
    const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return `item_${packageId}_${suffix}`;
}

export function invoiceItemFromPackage(pkg: PackageData, selectedPrice = pkg.price): InvoiceItem {
    const bundleSections = parsePackageBundleDescription(pkg.description);
    const isBundle = bundleSections.length > 0;

    return {
        id: uniqueItemId(pkg.id),
        name: pkg.name,
        desc: pkg.name,
        details: isBundle ? undefined : pkg.description,
        price: selectedPrice,
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
