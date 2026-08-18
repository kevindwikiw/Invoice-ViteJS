import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Package, Plus, Search, X } from 'lucide-react';
import clsx from 'clsx';

import { CATEGORIES, CATEGORY_LABELS, ITEMS_PER_PAGE } from '../constants/invoice';
import { packageCategoryTone, packageDisplayName, packageRowId } from '../lib/packageCatalog';
import type { PackageData } from '../types/invoice';

interface PackageSidebarProps {
    packages: PackageData[];
    selectedPackageIds: Set<string>;
    onAdd: (pkg: PackageData) => void;
    onRemove: (rowId: string) => void;
    onOpenCatalog: () => void;
}

interface QuickCatalogProps extends PackageSidebarProps {
    compact?: boolean;
}

function QuickCatalog({
    packages,
    selectedPackageIds,
    onAdd,
    onRemove,
    onOpenCatalog,
    compact = false,
}: QuickCatalogProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState('All Categories');
    const [page, setPage] = useState(0);
    const [showCategories, setShowCategories] = useState(true);

    const categories = useMemo(
        () => CATEGORIES.filter((category) => packages.some((pkg) => pkg.category === category)),
        [packages],
    );
    const categoryCounts = useMemo(() => {
        const counts: Record<string, number> = { 'All Categories': packages.length };
        categories.forEach((category) => {
            counts[category] = packages.filter((pkg) => pkg.category === category).length;
        });
        return counts;
    }, [categories, packages]);
    const filteredPackages = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        return packages
            .filter((pkg) => activeCategory === 'All Categories' || pkg.category === activeCategory)
            .filter((pkg) => !query || pkg.name.toLowerCase().includes(query) || pkg.description.toLowerCase().includes(query))
            .sort((a, b) => b.price - a.price);
    }, [activeCategory, packages, searchQuery]);

    const totalPages = Math.max(1, Math.ceil(filteredPackages.length / ITEMS_PER_PAGE));
    const safePage = Math.min(page, totalPages - 1);
    const visiblePackages = filteredPackages.slice(
        safePage * ITEMS_PER_PAGE,
        (safePage + 1) * ITEMS_PER_PAGE,
    );

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className={clsx('shrink-0 border-b border-[var(--border)]/70', compact ? 'px-4 pb-3' : 'px-5 pb-4')}>
                <button
                    type="button"
                    onClick={onOpenCatalog}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-xs font-semibold text-[var(--bg-deep)] transition-colors hover:opacity-90 active:opacity-80"
                >
                    <Package size={14} />
                    Open Full Catalog
                </button>

                <div className="relative mt-3 min-w-0">
                    <label htmlFor={compact ? 'mobile-package-search' : 'package-search'} className="sr-only">Search packages</label>
                    <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                        id={compact ? 'mobile-package-search' : 'package-search'}
                        type="search"
                        value={searchQuery}
                        onChange={(event) => {
                            setSearchQuery(event.target.value);
                            setPage(0);
                        }}
                        placeholder="Search packages..."
                        className="h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-card)] pl-10 pr-3 text-sm outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
                        style={{ paddingLeft: '2.75rem', paddingRight: '1rem' }}
                    />
                </div>

                <button
                    type="button"
                    onClick={() => setShowCategories((current) => !current)}
                    className="ml-auto mt-3 flex items-center gap-1.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)] transition-colors hover:text-[var(--accent)]"
                    aria-expanded={showCategories}
                >
                    {showCategories ? 'Hide Categories' : 'Show Categories'}
                    <ChevronDown size={12} className={clsx('transition-transform duration-200', showCategories && 'rotate-180')} />
                </button>

                {showCategories && (
                    <div className="mt-2 grid grid-cols-2 border-y border-[var(--border)]/70">
                        {['All Categories', ...categories].map((category) => {
                            const active = activeCategory === category;
                            return (
                                <button
                                    type="button"
                                    key={category}
                                    onClick={() => {
                                        setActiveCategory(category);
                                        setPage(0);
                                    }}
                                    className={clsx(
                                        'flex min-w-0 items-center justify-between gap-2 border-b border-r border-[var(--border)]/50 px-3 py-2.5 text-left text-[9px] font-bold uppercase tracking-[0.1em] transition-colors even:border-r-0 [&:nth-last-child(-n+2)]:border-b-0',
                                        active
                                            ? 'bg-[var(--bg-elevated)] text-[var(--accent)]'
                                            : 'text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]/50 hover:text-[var(--text-primary)]',
                                    )}
                                >
                                    <span className="truncate">{category === 'All Categories' ? 'All' : (CATEGORY_LABELS[category] || category)}</span>
                                    <span className="shrink-0 text-[8px] tabular-nums opacity-65">{categoryCounts[category] || 0}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
                    <span className={clsx('inline-flex rounded-md border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em]', activeCategory === 'All Categories' ? 'border-[var(--accent)]/30 bg-[var(--accent)]/5 text-[var(--accent)]' : packageCategoryTone(activeCategory))}>
                        {activeCategory === 'All Categories' ? 'All Packages' : (CATEGORY_LABELS[activeCategory] || activeCategory)}
                    </span>
                    <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
                        {filteredPackages.length} items
                    </span>
                </div>
                {visiblePackages.length === 0 ? (
                    <div className="flex h-full min-h-40 flex-col items-center justify-center px-6 text-center">
                        <Package size={20} className="mb-2 text-[var(--text-muted)] opacity-50" />
                        <p className="text-sm font-semibold text-[var(--text-primary)]">No packages found</p>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">Try another search or category.</p>
                    </div>
                ) : visiblePackages.map((pkg) => {
                    const rowId = packageRowId(pkg);
                    const isAdded = selectedPackageIds.has(rowId);
                    const details = pkg.description.split('\n').map((line) => line.trim()).filter(Boolean);

                    return (
                        <div
                            key={pkg.id}
                            className={clsx(
                                'group/package border-b border-[var(--border)]/60 px-4 py-3 transition-colors last:border-b-0',
                                isAdded ? 'border-l-2 border-l-[var(--accent)] bg-[var(--accent)]/[0.06]' : 'hover:bg-[var(--bg-elevated)]/30',
                            )}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                    <p className="truncate font-display text-sm font-medium text-[var(--text-primary)] transition-colors group-hover/package:text-[var(--accent)]" title={pkg.name}>
                                        {packageDisplayName(pkg.name)}
                                    </p>
                                    {activeCategory === 'All Categories' && (
                                        <span className={clsx('mt-1 inline-flex border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em]', packageCategoryTone(pkg.category))}>
                                            {CATEGORY_LABELS[pkg.category] || pkg.category}
                                        </span>
                                    )}
                                </div>
                                <div className="shrink-0 text-right">
                                    <p className="font-display text-sm font-medium tabular-nums text-[var(--text-primary)]">
                                        Rp {pkg.price.toLocaleString('id-ID')}
                                    </p>
                                    <button
                                        type="button"
                                        aria-pressed={isAdded}
                                        onClick={() => isAdded ? onRemove(rowId) : onAdd(pkg)}
                                        className={clsx(
                                            'group/action mt-2 inline-flex min-w-[64px] items-center justify-center gap-1 rounded-md border px-2 py-1 text-[8px] font-bold uppercase tracking-[0.1em] transition-colors',
                                            isAdded
                                                ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-600 hover:border-rose-500/35 hover:bg-rose-500/10 hover:text-rose-500 dark:text-emerald-400'
                                                : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]/50 hover:text-[var(--accent)]',
                                        )}
                                    >
                                        {isAdded ? (
                                            <>
                                                <Check size={10} className="group-hover/action:hidden" />
                                                <X size={10} className="hidden group-hover/action:block" />
                                                <span className="group-hover/action:hidden">Added</span>
                                                <span className="hidden group-hover/action:inline">Remove</span>
                                            </>
                                        ) : (
                                            <><Plus size={10} /> Add</>
                                        )}
                                    </button>
                                </div>
                            </div>
                            {details.length > 0 && (
                                <div className="mt-2 space-y-1">
                                    {details.slice(0, 2).map((detail, index) => (
                                        <p key={`${rowId}-${index}`} className="flex items-start gap-1.5 text-[10px] leading-relaxed text-[var(--text-secondary)]">
                                            <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]/70" />
                                            <span className="line-clamp-1">{detail}</span>
                                        </p>
                                    ))}
                                    {details.length > 2 && (
                                        <div className="group/details relative inline-block pl-2.5 pt-0.5 text-[9px] font-semibold text-[var(--accent)]">
                                            +{details.length - 2} more details
                                            <div className="pointer-events-none absolute left-0 top-full z-[90] mt-1 hidden w-[250px] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3 text-left text-[10px] font-normal normal-case leading-relaxed text-[var(--text-secondary)] shadow-xl group-hover/details:block">
                                                <ul className="space-y-1.5">
                                                    {details.map((detail, index) => (
                                                        <li key={`${rowId}-detail-${index}`} className="flex items-start gap-2">
                                                            <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                                                            <span>{detail}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {filteredPackages.length > 0 && (
                <div className="flex h-11 shrink-0 items-center justify-between border-t border-[var(--border)] px-4">
                    <button
                        type="button"
                        onClick={() => setPage((current) => Math.max(0, current - 1))}
                        disabled={safePage === 0}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-25"
                        aria-label="Previous package page"
                    >
                        <ChevronLeft size={14} />
                    </button>
                    <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                        Page {safePage + 1} / {totalPages}
                    </span>
                    <button
                        type="button"
                        onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                        disabled={safePage >= totalPages - 1}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-25"
                        aria-label="Next package page"
                    >
                        <ChevronRight size={14} />
                    </button>
                </div>
            )}
        </div>
    );
}

export function PackageSidebar(props: PackageSidebarProps) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [showMobilePackages, setShowMobilePackages] = useState(false);

    return (
        <aside
            className={clsx(
                'fixed inset-x-0 bottom-0 z-40 flex shrink-0 flex-col overflow-hidden border-t border-[var(--border)] bg-[var(--bg-card)] font-sans md:static md:z-auto md:h-full md:border-l md:border-t-0',
                'transition-[width,height] duration-200 ease-out',
                showMobilePackages ? 'h-[72vh]' : 'h-[72px]',
                isCollapsed ? 'md:w-14' : 'md:w-80',
            )}
        >
            <div className="flex h-[72px] shrink-0 items-center gap-3 px-4 md:hidden">
                <button
                    type="button"
                    onClick={() => setShowMobilePackages((current) => !current)}
                    className="min-w-0 flex-1 text-left"
                    aria-expanded={showMobilePackages}
                >
                    <p className="font-display text-lg font-medium text-[var(--text-primary)]">Select Packages</p>
                    <p className="label-xs mt-0.5 text-[var(--accent)]">{props.selectedPackageIds.size} selected</p>
                </button>
                <button
                    type="button"
                    onClick={props.onOpenCatalog}
                    className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--bg-deep)] transition-colors hover:opacity-90"
                >
                    <Package size={13} />
                    Full Catalog
                </button>
                <button
                    type="button"
                    onClick={() => setShowMobilePackages((current) => !current)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)]"
                    aria-label={showMobilePackages ? 'Close quick package catalog' : 'Open quick package catalog'}
                >
                    <ChevronLeft size={16} className={clsx('transition-transform', showMobilePackages ? '-rotate-90' : 'rotate-90')} />
                </button>
            </div>

            {showMobilePackages && (
                <div className="min-h-0 flex-1 pt-3 md:hidden">
                    <QuickCatalog {...props} compact />
                </div>
            )}

            {isCollapsed ? (
                <div className="hidden h-full flex-col items-center gap-3 py-5 md:flex">
                    <button
                        type="button"
                        onClick={() => setIsCollapsed(false)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)]"
                        aria-label="Expand package catalog"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={props.onOpenCatalog}
                        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--accent)] transition-colors hover:border-[var(--accent)]/50"
                        aria-label={`Open full package catalog, ${props.selectedPackageIds.size} selected`}
                    >
                        <Package size={16} />
                        {props.selectedPackageIds.size > 0 && (
                            <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-[var(--accent)] px-1 text-center text-[8px] font-bold leading-4 text-[var(--bg-deep)]">
                                {props.selectedPackageIds.size}
                            </span>
                        )}
                    </button>
                </div>
            ) : (
                <div className="hidden h-full min-h-0 flex-col md:flex">
                    <div className="flex shrink-0 items-start justify-between gap-3 px-5 py-5">
                        <div className="min-w-0 border-l-2 border-[var(--accent)] pl-3">
                            <h2 className="font-display text-xl font-medium tracking-tight text-[var(--text-primary)]">Select Packages</h2>
                            <p className="label-xs mt-1 text-[var(--accent)]">{props.selectedPackageIds.size} selected</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsCollapsed(true)}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)]"
                            aria-label="Collapse package catalog"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                    <div className="min-h-0 flex-1">
                        <QuickCatalog {...props} />
                    </div>
                </div>
            )}
        </aside>
    );
}
