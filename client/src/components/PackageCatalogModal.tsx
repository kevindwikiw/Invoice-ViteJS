import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, Package, Search, X } from 'lucide-react';
import clsx from 'clsx';

import { CATEGORIES, CATEGORY_LABELS } from '../constants/invoice';
import { packageCategoryTone, packageDisplayName, packageRowId } from '../lib/packageCatalog';
import type { PackageData } from '../types/invoice';

interface PackageCatalogModalProps {
    packages: PackageData[];
    initialSelectedIds: Set<string>;
    onApply: (selectedIds: Set<string>) => void;
    onClose: () => void;
}

interface PackageOptionProps {
    pkg: PackageData;
    checked: boolean;
    onToggle: (id: string) => void;
}

function PackageOption({ pkg, checked, onToggle }: PackageOptionProps) {
    const rowId = packageRowId(pkg);
    const details = pkg.description
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    return (
        <label
            className={clsx(
                'group block cursor-pointer border-b border-[var(--border)]/60 px-4 py-4 transition-colors last:border-b-0',
                checked ? 'bg-[var(--accent)]/[0.07]' : 'hover:bg-[var(--bg-elevated)]/40',
            )}
        >
            <div className="flex items-start gap-3">
                <span
                    className={clsx(
                        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                        checked
                            ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]'
                            : 'border-[var(--border)] bg-[var(--bg-card)] text-transparent group-hover:border-[var(--accent)]/50',
                    )}
                >
                    <Check size={13} strokeWidth={3} />
                </span>
                <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(rowId)}
                    className="sr-only"
                    aria-label={`${checked ? 'Remove' : 'Add'} ${pkg.name}`}
                />

                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                        <h3 className="min-w-0 font-display text-base font-medium leading-snug text-[var(--text-primary)]">
                            {packageDisplayName(pkg.name)}
                        </h3>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--accent)]">
                            Rp {pkg.price.toLocaleString('id-ID')}
                        </span>
                    </div>
                    {details.length > 0 && (
                        <div className="mt-2 space-y-1">
                            {details.slice(0, 3).map((detail, index) => (
                                <p key={`${rowId}-${index}`} className="flex items-start gap-2 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)]/70" />
                                    <span>{detail}</span>
                                </p>
                            ))}
                            {details.length > 3 && (
                                <p className="pl-3 text-[10px] font-semibold text-[var(--text-muted)]">
                                    +{details.length - 3} more details
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </label>
    );
}

export function PackageCatalogModal({
    packages,
    initialSelectedIds,
    onApply,
    onClose,
}: PackageCatalogModalProps) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const columnsRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);

    const availableCategories = useMemo(
        () => CATEGORIES.filter((category) => packages.some((pkg) => pkg.category === category)),
        [packages],
    );
    const availablePackageIds = useMemo(
        () => new Set(packages.map(packageRowId)),
        [packages],
    );
    const initialAvailableSelection = useMemo(
        () => new Set([...initialSelectedIds].filter((id) => availablePackageIds.has(id))),
        [availablePackageIds, initialSelectedIds],
    );

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
        () => new Set(availableCategories),
    );
    const [mobileCategory, setMobileCategory] = useState(availableCategories[0] || '');
    const [draftSelectedIds, setDraftSelectedIds] = useState<Set<string>>(
        () => new Set(initialAvailableSelection),
    );
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    const normalizedSearch = searchQuery.trim().toLowerCase();
    const filteredPackages = useMemo(() => {
        if (!normalizedSearch) return packages;
        return packages.filter((pkg) => (
            pkg.name.toLowerCase().includes(normalizedSearch)
            || pkg.description.toLowerCase().includes(normalizedSearch)
        ));
    }, [normalizedSearch, packages]);

    const packagesByCategory = useMemo(() => {
        const grouped = new Map<string, PackageData[]>();
        availableCategories.forEach((category) => grouped.set(category, []));
        filteredPackages.forEach((pkg) => grouped.get(pkg.category)?.push(pkg));
        grouped.forEach((items) => items.sort((a, b) => b.price - a.price));
        return grouped;
    }, [availableCategories, filteredPackages]);

    const visibleCategories = availableCategories.filter((category) => selectedCategories.has(category));
    const mobilePackages = packagesByCategory.get(mobileCategory) || [];

    const addedCount = [...draftSelectedIds].filter((id) => !initialAvailableSelection.has(id)).length;
    const removedCount = [...initialAvailableSelection].filter((id) => !draftSelectedIds.has(id)).length;
    const changeCount = addedCount + removedCount;
    const selectedTotal = packages.reduce(
        (total, pkg) => total + (draftSelectedIds.has(packageRowId(pkg)) ? pkg.price : 0),
        0,
    );

    const updateScrollCues = () => {
        const node = columnsRef.current;
        if (!node) return;
        setCanScrollLeft(node.scrollLeft > 4);
        setCanScrollRight(node.scrollLeft + node.clientWidth < node.scrollWidth - 4);
    };

    useEffect(() => {
        previousFocusRef.current = document.activeElement as HTMLElement | null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
            }
            if (event.key !== 'Tab' || !dialogRef.current) return;
            const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ));
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            window.clearTimeout(focusTimer);
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKeyDown);
            previousFocusRef.current?.focus();
        };
    }, [onClose]);

    useEffect(() => {
        const frame = window.requestAnimationFrame(updateScrollCues);
        const node = columnsRef.current;
        node?.addEventListener('scroll', updateScrollCues, { passive: true });
        window.addEventListener('resize', updateScrollCues);
        return () => {
            window.cancelAnimationFrame(frame);
            node?.removeEventListener('scroll', updateScrollCues);
            window.removeEventListener('resize', updateScrollCues);
        };
    }, [normalizedSearch, selectedCategories]);

    const togglePackage = (id: string) => {
        setDraftSelectedIds((previous) => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleCategory = (category: string) => {
        const next = new Set(selectedCategories);
        if (next.has(category)) next.delete(category);
        else next.add(category);
        setSelectedCategories(next);

        if (!next.has(mobileCategory)) {
            setMobileCategory(availableCategories.find((item) => next.has(item)) || '');
        }
    };

    const toggleAllCategories = () => {
        const allSelected = availableCategories.every((category) => selectedCategories.has(category));
        const next = allSelected ? new Set<string>() : new Set(availableCategories);
        setSelectedCategories(next);
        setMobileCategory(allSelected ? '' : (availableCategories[0] || ''));
    };

    const scrollColumns = (direction: -1 | 1) => {
        columnsRef.current?.scrollBy({ left: direction * 336, behavior: 'smooth' });
    };

    return createPortal(
        <div
            className="fixed inset-0 z-[120] bg-black/70 sm:p-3"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="package-catalog-title"
                className="flex h-[100svh] w-full flex-col overflow-hidden bg-[var(--bg-card)] text-[var(--text-primary)] shadow-2xl animate-in fade-in duration-150 sm:h-[calc(100svh-1.5rem)] sm:rounded-2xl sm:border sm:border-[var(--border)]"
            >
                <header className="shrink-0 border-b border-[var(--border)] px-4 py-4 sm:px-6 lg:px-8">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 border-l-2 border-[var(--accent)] pl-4">
                            <h2 id="package-catalog-title" className="font-display text-2xl font-medium tracking-tight sm:text-3xl">
                                Package Catalog
                            </h2>
                            <p className="label-xs mt-1 text-[var(--accent)]">
                                Select services for this invoice
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--text-primary)]"
                            aria-label="Close package catalog"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
                        <div className="relative min-w-0 flex-1 lg:max-w-md">
                            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                            <input
                                ref={searchRef}
                                type="search"
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                placeholder="Search package name or details..."
                                className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-deep)] pl-10 pr-10 text-sm outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
                                style={{ paddingLeft: '2.75rem', paddingRight: '2.75rem' }}
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                                    aria-label="Clear package search"
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>

                        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto border-y border-[var(--border)]/60 py-1 no-scrollbar">
                            <button
                                type="button"
                                aria-pressed={availableCategories.every((category) => selectedCategories.has(category))}
                                onClick={toggleAllCategories}
                                className={clsx(
                                    'shrink-0 border-r border-[var(--border)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors',
                                    availableCategories.every((category) => selectedCategories.has(category))
                                        ? 'text-[var(--accent)]'
                                        : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                                )}
                            >
                                All
                            </button>
                            {availableCategories.map((category) => {
                                const active = selectedCategories.has(category);
                                return (
                                    <button
                                        type="button"
                                        key={category}
                                        aria-pressed={active}
                                        onClick={() => toggleCategory(category)}
                                        className={clsx(
                                            'shrink-0 border-r border-[var(--border)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors last:border-r-0',
                                            active ? packageCategoryTone(category) : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
                                        )}
                                    >
                                        {CATEGORY_LABELS[category] || category}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </header>

                <main className="relative min-h-0 flex-1 overflow-hidden bg-[var(--bg-deep)]/40">
                    {/* Mobile catalog */}
                    <div className="flex h-full min-h-0 flex-col md:hidden">
                        <div className="shrink-0 border-b border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
                            <label htmlFor="mobile-package-category" className="label-xs mb-1.5 block text-[var(--text-muted)]">
                                Active category
                            </label>
                            <select
                                id="mobile-package-category"
                                value={mobileCategory}
                                onChange={(event) => setMobileCategory(event.target.value)}
                                className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] px-3 text-sm outline-none focus:border-[var(--accent)]"
                            >
                                {visibleCategories.map((category) => (
                                    <option key={category} value={category}>
                                        {CATEGORY_LABELS[category] || category} ({packagesByCategory.get(category)?.length || 0})
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto">
                            {!mobileCategory ? (
                                <div className="flex h-full flex-col items-center justify-center px-8 text-center text-[var(--text-muted)]">
                                    <Package size={24} className="mb-3 opacity-50" />
                                    <p className="text-sm font-semibold text-[var(--text-primary)]">No category selected</p>
                                    <p className="mt-1 text-xs">Choose at least one category from the filters above.</p>
                                </div>
                            ) : mobilePackages.length === 0 ? (
                                <div className="flex h-full items-center justify-center px-8 text-center text-sm text-[var(--text-muted)]">
                                    No packages match this search in {CATEGORY_LABELS[mobileCategory] || mobileCategory}.
                                </div>
                            ) : mobilePackages.map((pkg) => (
                                <PackageOption
                                    key={pkg.id}
                                    pkg={pkg}
                                    checked={draftSelectedIds.has(packageRowId(pkg))}
                                    onToggle={togglePackage}
                                />
                            ))}
                        </div>
                    </div>

                    {/* Desktop category columns */}
                    <div className="relative hidden h-full md:block">
                        {canScrollLeft && (
                            <>
                                <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-[var(--bg-deep)] to-transparent" />
                                <button
                                    type="button"
                                    onClick={() => scrollColumns(-1)}
                                    className="absolute left-4 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-lg transition-colors hover:border-[var(--accent)]"
                                    aria-label="Scroll categories left"
                                >
                                    <ChevronLeft size={18} />
                                </button>
                            </>
                        )}
                        {canScrollRight && (
                            <>
                                <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-[var(--bg-deep)] to-transparent" />
                                <button
                                    type="button"
                                    onClick={() => scrollColumns(1)}
                                    className="absolute right-4 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-lg transition-colors hover:border-[var(--accent)]"
                                    aria-label="Scroll categories right"
                                >
                                    <ChevronRight size={18} />
                                </button>
                            </>
                        )}

                        <div ref={columnsRef} className="flex h-full snap-x snap-proximity overflow-x-auto">
                            {visibleCategories.length === 0 ? (
                                <div className="flex h-full w-full flex-col items-center justify-center text-center text-[var(--text-muted)]">
                                    <Package size={28} className="mb-3 opacity-50" />
                                    <p className="font-display text-lg text-[var(--text-primary)]">No category selected</p>
                                    <p className="mt-1 text-xs">Choose one or more categories from the filter.</p>
                                </div>
                            ) : visibleCategories.map((category) => {
                                const items = packagesByCategory.get(category) || [];
                                return (
                                    <section key={category} className="flex h-full w-[320px] shrink-0 snap-start flex-col border-r border-[var(--border)] bg-[var(--bg-card)]/35 last:border-r-0">
                                        <div className="shrink-0 border-b border-[var(--border)] bg-[var(--bg-card)] px-4 py-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <span className={clsx('inline-flex border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em]', packageCategoryTone(category))}>
                                                    {CATEGORY_LABELS[category] || category}
                                                </span>
                                                <span className="text-[10px] font-semibold tabular-nums text-[var(--text-muted)]">
                                                    {items.length} items
                                                </span>
                                            </div>
                                        </div>
                                        <div className="min-h-0 flex-1 overflow-y-auto">
                                            {items.length === 0 ? (
                                                <div className="flex h-full items-center justify-center px-6 text-center text-xs text-[var(--text-muted)]">
                                                    No packages match this search.
                                                </div>
                                            ) : items.map((pkg) => (
                                                <PackageOption
                                                    key={pkg.id}
                                                    pkg={pkg}
                                                    checked={draftSelectedIds.has(packageRowId(pkg))}
                                                    onToggle={togglePackage}
                                                />
                                            ))}
                                        </div>
                                    </section>
                                );
                            })}
                        </div>
                    </div>
                </main>

                <footer className="shrink-0 border-t border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 sm:px-6 lg:px-8">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-[var(--text-primary)]">
                                {draftSelectedIds.size} selected
                                <span className="ml-2 font-normal text-[var(--text-muted)]">
                                    {addedCount > 0 && `+${addedCount} add`}
                                    {addedCount > 0 && removedCount > 0 && ' · '}
                                    {removedCount > 0 && `−${removedCount} remove`}
                                </span>
                            </p>
                            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                                Catalog value: <span className="font-semibold tabular-nums text-[var(--accent)]">Rp {selectedTotal.toLocaleString('id-ID')}</span>
                            </p>
                        </div>
                        <div className="flex items-center gap-2 sm:shrink-0">
                            <button
                                type="button"
                                onClick={onClose}
                                className="h-10 flex-1 rounded-lg border border-[var(--border)] px-5 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] sm:flex-none"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={changeCount === 0}
                                onClick={() => onApply(new Set(draftSelectedIds))}
                                className="h-10 flex-[1.4] rounded-lg bg-[var(--accent)] px-6 text-xs font-bold uppercase tracking-[0.1em] text-[var(--bg-deep)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
                            >
                                Apply {changeCount > 0 ? `${changeCount} Change${changeCount === 1 ? '' : 's'}` : 'Changes'}
                            </button>
                        </div>
                    </div>
                </footer>
            </div>
        </div>,
        document.body,
    );
}
