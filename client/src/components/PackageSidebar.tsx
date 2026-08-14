import { useState, useMemo, useEffect } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Package, Plus, Search } from 'lucide-react';
import clsx from 'clsx';
import type { PackageData } from '../types/invoice';
import { CATEGORIES, PACKAGE_FILTER_TABS, CATEGORY_LABELS, ITEMS_PER_PAGE } from '../constants/invoice';

interface PackageSidebarProps {
    packages: PackageData[];
    cartRowIds: Set<string>;
    addToCart: (pkg: PackageData) => void;
    removeFromCart: (rowId: string) => void;
    toTitleCase: (text: string) => string;
}

const CATEGORY_TONE: Record<string, string> = {
    Wedding: 'border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-300',
    'Bundling Package': 'border-violet-500/25 bg-violet-500/10 text-violet-600 dark:text-violet-300',
    Prewedding: 'border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-300',
    'Engagement/Sangjit': 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    'Corporate/Event': 'border-indigo-500/25 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300',
    'Add-ons': 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
    'Free / Complimentary': 'border-teal-500/25 bg-teal-500/10 text-teal-600 dark:text-teal-300',
};

const categoryTone = (category: string) => CATEGORY_TONE[category] || 'border-[var(--accent)]/25 bg-[var(--accent)]/5 text-[var(--accent)]';

export function PackageSidebar({
    packages,
    cartRowIds,
    addToCart,
    removeFromCart,
    toTitleCase
}: PackageSidebarProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState<string>('All Categories');
    const [categoryPages, setCategoryPages] = useState<Record<string, number>>({});
    const [showMobilePackages, setShowMobilePackages] = useState(() => {
        if (typeof window !== 'undefined') {
            return window.innerWidth < 768;
        }
        return false;
    });
    const [showDesktopPackages, setShowDesktopPackages] = useState(true);
    const [showCategoryFilter, setShowCategoryFilter] = useState(false);

    // Sync mobile sheet on window resize only
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth >= 768) {
                setShowMobilePackages(false);
            }
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Grouping
    const groupedPackages = useMemo(() => {
        const filtered = packages.filter((p) =>
            p.name.toLowerCase().includes(searchQuery.toLowerCase())
        );

        const grouped: Record<string, PackageData[]> = {};
        CATEGORIES.forEach(cat => { grouped[cat] = []; });

        filtered.forEach(pkg => {
            const cat = pkg.category || CATEGORIES[0];
            if (grouped[cat]) grouped[cat].push(pkg);
        });

        Object.keys(grouped).forEach(cat => {
            grouped[cat].sort((a, b) => b.price - a.price);
        });

        return grouped;
    }, [packages, searchQuery]);

    const categoryItemCounts = useMemo(() => {
        const counts: Record<string, number> = { "All Categories": 0 };
        CATEGORIES.forEach((category) => {
            const count = (groupedPackages[category] || []).length;
            counts[category] = count;
            counts["All Categories"] += count;
        });
        return counts;
    }, [groupedPackages]);

    const allPackages = useMemo(
        () => CATEGORIES.flatMap((category) => groupedPackages[category] || []),
        [groupedPackages]
    );

    const visiblePackageCategories = activeCategory === 'All Categories'
        ? ['All Categories']
        : CATEGORIES.filter((category) => category === activeCategory);

    const hasVisiblePackages = activeCategory === 'All Categories'
        ? allPackages.length > 0
        : visiblePackageCategories.some((category) => (groupedPackages[category] || []).length > 0);

    const emptyPackageTitle = searchQuery.trim()
        ? `Tidak ada paket untuk "${searchQuery.trim()}"`
        : activeCategory === 'All Categories'
            ? 'Belum ada paket tersedia'
            : `Belum ada paket di ${CATEGORY_LABELS[activeCategory] || activeCategory}`;

    const emptyPackageHint = searchQuery.trim()
        ? 'Coba kata kunci lain atau pindah kategori.'
        : 'Tambahkan paket dulu di halaman Package, lalu kembali ke sini.';

    return (
        <aside className={clsx(
            "fixed inset-x-0 bottom-0 z-40 md:static md:z-auto flex-shrink-0 bg-[var(--bg-card)] border-t border-[var(--border)] md:border-0 md:border-l md:border-[var(--border)]/30 flex flex-col transition-[width,height] duration-200 ease-in-out font-sans",
            "w-full",
            showDesktopPackages ? "md:w-80" : "md:w-14",
            showMobilePackages ? "h-[72vh]" : "h-[72px] overflow-hidden",
            "md:h-full md:max-h-full md:overflow-hidden"
        )}>
            <div
                className={clsx(
                    "flex items-center justify-between gap-2 border-b border-[var(--border)]/70 px-4 py-4 md:mb-0 md:p-6 cursor-pointer md:cursor-default",
                    !showDesktopPackages && "md:justify-center md:px-0"
                )}
                onClick={() => {
                    if (window.innerWidth < 768) {
                        setShowMobilePackages(!showMobilePackages);
                    }
                }}
            >
                <div className={clsx("min-w-0 border-l-2 border-[var(--accent)] pl-3 text-left", !showDesktopPackages && "md:hidden")}>
                    <h2 className="truncate text-xl font-medium tracking-tight text-[var(--text-primary)] font-display">Select Packages</h2>
                    <div className="label-xs text-[var(--accent)] mt-1">Package catalog & services</div>
                </div>
                {!showDesktopPackages && (
                    <span className="hidden h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--accent)] md:flex" title="Package catalog">
                        <Package size={15} />
                    </span>
                )}
                {cartRowIds.size > 0 && (
                    <span className={clsx("shrink-0 rounded-full border border-[var(--accent)]/30 px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-[var(--accent)]", !showDesktopPackages && "md:hidden")}>
                        {cartRowIds.size} selected
                    </span>
                )}
                <button
                    type="button"
                    aria-expanded={showDesktopPackages}
                    aria-controls="package-catalog"
                    onClick={(event) => {
                        event.stopPropagation();
                        setShowDesktopPackages((isOpen) => !isOpen);
                    }}
                    className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)] md:flex"
                    title={showDesktopPackages ? 'Hide package catalog' : 'Show package catalog'}
                >
                    {showDesktopPackages ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                </button>
                <div className="md:hidden text-[var(--text-muted)]">
                    {showMobilePackages ? <ChevronLeft className="-rotate-90" size={20} /> : <ChevronLeft className="rotate-90" size={20} />}
                </div>
            </div>

            <div id="package-catalog" className={clsx("px-4 md:px-6 pb-6 overflow-y-auto flex-1", !showDesktopPackages && "md:hidden")}>
                <div className="sticky top-0 z-10 -mx-4 border-b border-[var(--border)]/60 bg-[var(--bg-card)] px-4 pb-4 pt-4 md:-mx-6 md:px-6">
                    {/* Search */}
                    <div className="relative mb-4">
                        <label htmlFor="package-search" className="sr-only">Search packages</label>
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                        <input
                            id="package-search"
                            name="packageSearch"
                            type="text"
                            placeholder="Search packages..."
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setCategoryPages((previous) => ({ ...previous, [activeCategory]: 0 }));
                            }}
                            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2 text-xs focus:border-[var(--accent)] outline-none transition-colors text-[var(--text-primary)]"
                            style={{ paddingLeft: '2.25rem' }}
                        />
                    </div>

                    {/* Categories - Mobile */}
                    <div className="md:hidden">
                        <label htmlFor="package-category" className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--accent)]">
                            Category Filter
                        </label>
                        <div className="relative">
                            <select
                                id="package-category"
                                name="packageCategory"
                                value={activeCategory}
                                onChange={(e) => {
                                    setActiveCategory(e.target.value);
                                    setCategoryPages((previous) => ({ ...previous, [e.target.value]: 0 }));
                                }}
                                className="w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2.5 pr-9 text-xs text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent)]"
                            >
                                {PACKAGE_FILTER_TABS.map((category) => (
                                    <option key={category} value={category}>
                                        {category === 'Catalog' ? 'Catalog' : (CATEGORY_LABELS[category] || category)} ({categoryItemCounts[category] ?? 0})
                                    </option>
                                ))}
                            </select>
                            <ChevronRight size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-[var(--text-muted)]" />
                        </div>
                    </div>

                    {/* Categories - Desktop */}
                    <div className="hidden md:block">
                        <button
                            type="button"
                            aria-expanded={showCategoryFilter}
                            aria-controls="package-category-filter"
                            onClick={() => setShowCategoryFilter((isOpen) => !isOpen)}
                            className="ml-auto flex items-center gap-1.5 rounded-md px-1 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-[var(--text-muted)] transition-colors hover:text-[var(--accent)]"
                        >
                            {showCategoryFilter ? 'Hide categories' : 'Filter categories'}
                            <ChevronDown size={13} className={clsx("transition-transform duration-200", showCategoryFilter && "rotate-180 text-[var(--accent)]")} />
                        </button>

                        {showCategoryFilter && (
                            <div id="package-category-filter" className="mt-2 grid grid-cols-2 border-y border-[var(--border)]/60 animate-in fade-in slide-in-from-top-1 duration-200">
                                {PACKAGE_FILTER_TABS.map(category => {
                                    const isActive = activeCategory === category;
                                    const count = categoryItemCounts[category] ?? 0;
                                    if (count === 0 && category !== 'All Categories') return null;

                                    return (
                                        <button
                                            type="button"
                                            key={category}
                                            onClick={() => {
                                                setActiveCategory(category);
                                                setCategoryPages((previous) => ({ ...previous, [category]: 0 }));
                                            }}
                                            className={clsx(
                                                "flex min-w-0 items-center justify-between gap-2 border-b border-r border-[var(--border)]/40 px-2.5 py-2 text-left text-[9px] font-bold uppercase tracking-[0.1em] transition-colors even:border-r-0 last:border-b-0",
                                                isActive
                                                    ? categoryTone(category)
                                                    : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)]/40 hover:text-[var(--text-primary)]"
                                            )}
                                        >
                                            <span>{category === 'All Categories' ? 'All' : (CATEGORY_LABELS[category] || category)}</span>
                                            <span className={clsx(
                                                "text-[8px] font-bold tracking-tight",
                                                isActive ? "text-[var(--accent)] opacity-70" : "text-[var(--text-muted)] opacity-60"
                                            )}>{count}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex-1 space-y-6 pt-4">
                    {!hasVisiblePackages && (
                        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-8 text-center">
                            <div className="mx-auto mb-2 w-fit rounded-full border border-[var(--border)] bg-[var(--bg-card)] p-2 text-[var(--text-muted)]">
                                <Package size={14} />
                            </div>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">{emptyPackageTitle}</p>
                            <p className="mt-1 text-xs text-[var(--text-muted)]">{emptyPackageHint}</p>
                        </div>
                    )}
                    {hasVisiblePackages && visiblePackageCategories.map(category => {
                        const items = category === 'All Categories' ? allPackages : groupedPackages[category] || [];
                        if (items.length === 0) return null;

                        const page = categoryPages[category] || 0;
                        const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
                        const displayItems = items.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

                        return (
                            <div key={category}>
                                <div className="mb-3 flex items-center justify-between border-b border-[var(--border)] pb-2">
                                    <span className={clsx("inline-flex w-fit rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.2em]", categoryTone(category))}>
                                        {category === 'All Categories' ? 'All Packages' : (CATEGORY_LABELS[category] || category)}
                                    </span>
                                    <span className="text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--text-secondary)] opacity-60">{items.length} items</span>
                                </div>

                                <div>
                                    {displayItems.map(pkg => {
                                        const isInCart = cartRowIds.has(String(pkg.id));
                                        const detailLines = pkg.description.split('\n').map((line) => line.trim()).filter(Boolean);
                                        return (
                                            <div
                                                key={pkg.id}
                                                className={clsx(
                                                    "border-b border-[var(--border)]/60 py-3 transition-colors last:border-b-0",
                                                    isInCart
                                                        ? "border-l-2 border-l-[var(--accent)] bg-[var(--accent)]/5 pl-3 pr-0"
                                                        : "hover:bg-[var(--bg-elevated)]/25"
                                                )}
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate text-sm font-medium leading-snug text-[var(--text-primary)] font-display">
                                                            {toTitleCase(pkg.name)}
                                                        </div>
                                                        {activeCategory === 'All Categories' && (
                                                            <span className={clsx("mt-1 inline-block rounded border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest", categoryTone(pkg.category))}>
                                                                {CATEGORY_LABELS[pkg.category] || pkg.category}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="shrink-0 text-right">
                                                        <div className="text-sm font-medium tabular-nums text-[var(--text-primary)] font-display">
                                                            Rp {pkg.price.toLocaleString('id-ID')}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            aria-pressed={isInCart}
                                                            onClick={() => isInCart ? removeFromCart(String(pkg.id)) : addToCart(pkg)}
                                                            title={isInCart ? 'Remove package from invoice' : 'Add package to invoice'}
                                                            className={clsx(
                                                                "mt-2 inline-flex min-w-[62px] items-center justify-center gap-1 rounded-md border px-2 py-1 text-[8px] font-black uppercase tracking-widest transition-all active:scale-[0.97]",
                                                                isInCart
                                                                    ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-700 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.04)] hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-500 dark:text-emerald-400"
                                                                    : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]/50 hover:text-[var(--accent)]"
                                                            )}
                                                        >
                                                            {isInCart ? <Check size={10} /> : <Plus size={10} />}
                                                            {isInCart ? 'Added' : 'Add'}
                                                        </button>
                                                    </div>
                                                </div>
                                                {detailLines.length > 0 ? (
                                                    <div className="mt-1.5 space-y-1">
                                                        {detailLines.slice(0, 2).map((line, i) => (
                                                            <div key={i} className="flex items-start gap-1.5">
                                                                <span className="mt-[5px] h-1 w-1 rounded-full bg-[var(--accent)] shrink-0" />
                                                                <span className="text-[11px] text-[var(--text-secondary)] leading-tight">{line}</span>
                                                            </div>
                                                        ))}
                                                        {detailLines.length > 2 && (
                                                            <div className="group/tooltip relative cursor-help text-[var(--accent)] font-bold text-[9px] pt-1 pl-2.5 opacity-80 hover:opacity-100 transition-opacity inline-block">
                                                                +{detailLines.length - 2} more details
                                                                <div className="hidden group-hover/tooltip:block absolute left-[-10px] top-full mt-1.5 bg-[var(--bg-card)] border border-[var(--border)] p-3 rounded-lg shadow-xl z-[9999] w-[240px] text-[11px] text-[var(--text-secondary)] font-normal normal-case leading-relaxed ring-1 ring-[var(--border)] cursor-default">
                                                                    <div className="text-[9px] font-bold text-[var(--accent)] uppercase tracking-wider mb-2 border-b border-[var(--border)] pb-1">Full Package Details</div>
                                                                    <ul className="space-y-1.5 text-left">
                                                                        {detailLines.map((d, i) => (
                                                                            <li key={i} className="flex gap-2 items-start text-[11px]">
                                                                                <span className="text-[var(--accent)] mt-[2px]">•</span>
                                                                                <span className="flex-1 whitespace-normal break-words">{d}</span>
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>

                                {totalPages > 1 && (
                                    <div className="mt-4 flex items-center justify-between px-1">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setCategoryPages(prev => ({ ...prev, [category]: Math.max(0, page - 1) })); }}
                                            disabled={page === 0}
                                            className="p-1 px-2 rounded hover:bg-[var(--bg-elevated)] disabled:opacity-20 text-[var(--text-muted)] transition-colors"
                                        >
                                            <ChevronLeft size={14} />
                                        </button>
                                        <span className="text-[9px] font-bold uppercase tracking-widest text-[var(--text-muted)]">Page {page + 1}/{totalPages}</span>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setCategoryPages(prev => ({ ...prev, [category]: Math.min(totalPages - 1, page + 1) })); }}
                                            disabled={page === totalPages - 1}
                                            className="p-1 px-2 rounded hover:bg-[var(--bg-elevated)] disabled:opacity-20 text-[var(--text-muted)] transition-colors"
                                        >
                                            <ChevronRight size={14} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </aside>
    );
}
