import { useState, useMemo, useRef, useEffect, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Package, Plus, Search, ChevronLeft, ChevronRight, Edit2, Trash2, X, Filter, Loader2, Archive, RotateCcw, Check, Eye, Lightbulb, Wrench, FileText, Layout, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../context/auth';
import { fetchWithAuth } from '../lib/api';
import { useToast } from '../context/ToastContext';
import {
    PAGE_SHELL_CLASS,
    SEGMENT_GROUP_CLASS,
    SEGMENT_BUTTON_BASE_CLASS,
    SEGMENT_BUTTON_ACTIVE_CLASS,
    SEGMENT_BUTTON_INACTIVE_CLASS,
    SEARCH_INPUT_CLASS,
} from '../constants/uiContract';
import { FORM_LABEL_CLASS, PANEL_CARD_CLASS } from '../constants/invoice';

// ============ TYPES ============
interface PackageData {
    id: number;
    name: string;
    price: number;
    category: string;
    description: string;
    isActive: number;
}

interface BundleItem {
    title: string;
    details: string;
}

interface PackageInput {
    name: string;
    category: string;
    price: number;
    description: string;
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

const CATEGORIES = [
    "Wedding",
    "Bundling Package",
    "Prewedding",
    "Engagement/Sangjit",
    "Corporate/Event",
    "Add-ons",
    "Free / Complimentary"
];
const CATEGORY_TONE: Record<string, string> = {
    Wedding: 'border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-300',
    'Bundling Package': 'border-violet-500/25 bg-violet-500/10 text-violet-600 dark:text-violet-300',
    Prewedding: 'border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-300',
    'Engagement/Sangjit': 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    'Corporate/Event': 'border-indigo-500/25 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300',
    'Add-ons': 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
    'Free / Complimentary': 'border-teal-500/25 bg-teal-500/10 text-teal-600 dark:text-teal-300',
};
type FilterMode = 'active' | 'archived' | 'all';
type SortMode = 'price-desc' | 'price-asc' | 'name-asc';

// ============ BUNDLE PARSER & GENERATOR ============
function parseBundleDescription(desc: string): BundleItem[] {
    if (!desc) {
        return [
            { title: 'Wedding', details: '- 1 Photographer\n- 1 Videographer\n- All Edited Photos' },
            { title: 'Prewedding', details: '- 1 Day Shooting\n- 2 Outfits\n- Cinematic Video' }
        ];
    }

    const regex = /(?:\n|^)\*\*([^*]+)\*\*(?:\n|$)/g;
    const items: BundleItem[] = [];
    let match: RegExpExecArray | null;
    const titles: string[] = [];
    const positions: number[] = [];

    while ((match = regex.exec(desc)) !== null) {
        titles.push(match[1].trim());
        positions.push(match.index + match[0].length);
    }

    if (titles.length === 0) {
        return [{ title: 'Package Details', details: desc.trim() }];
    }

    for (let i = 0; i < titles.length; i++) {
        const start = positions[i];
        const nextTitle = titles[i + 1];
        let end = desc.length;
        if (nextTitle) {
            const nextIdx = desc.indexOf(`**${nextTitle}**`, start);
            if (nextIdx !== -1) end = nextIdx;
        }
        const details = desc.slice(start, end).trim();
        items.push({ title: titles[i], details });
    }

    if (items.length === 0) {
        items.push({ title: '', details: '' });
    }
    return items;
}

function generateBundleDescription(items: BundleItem[]): string {
    return items
        .filter(it => it.title.trim() || it.details.trim())
        .map(it => {
            const t = it.title.trim();
            const d = it.details.trim();
            if (t && d) return `**${t}**\n${d}`;
            if (t) return `**${t}**`;
            return d;
        })
        .join('\n\n');
}

// ============ UTILS ============
const formatPrice = (n: number) => new Intl.NumberFormat('id-ID').format(n);

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetchWithAuth(url, init);
    if (!res.ok) throw new Error(await res.text() || `Request failed: ${res.status}`);
    return res.json();
}

// ============ HOOKS ============
function usePackages(enabled: boolean) {
    const queryClient = useQueryClient();
    const { addToast } = useToast();

    const query = useQuery<PackageData[]>({
        queryKey: ['packages', 'all'],
        queryFn: () => fetchJSON<PackageData[]>('/packages?all=true'),
        staleTime: 60_000,
        enabled,
    });
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['packages'] });

    const create = useMutation({
        mutationFn: (d: PackageInput) => fetchJSON('/packages', { method: 'POST', body: JSON.stringify(d) }),
        onSuccess: () => {
            invalidate();
            addToast('Package created successfully!', 'success');
        },
        onError: (err: unknown) => addToast(`Failed to create: ${errorMessage(err)}`, 'error')
    });

    const update = useMutation({
        mutationFn: ({ id, ...d }: { id: number } & PackageInput) => fetchJSON(`/packages/${id}`, { method: 'PUT', body: JSON.stringify(d) }),
        onSuccess: () => {
            invalidate();
            addToast('Package updated successfully!', 'success');
        },
        onError: (err: unknown) => addToast(`Failed to update: ${errorMessage(err)}`, 'error')
    });

    const remove = useMutation({
        mutationFn: (id: number) => fetchJSON(`/packages/${id}`, { method: 'DELETE' }),
        onSuccess: () => {
            invalidate();
            addToast('Package deleted permanently!', 'success');
        },
        onError: (err: unknown) => addToast(`Failed to delete: ${errorMessage(err)}`, 'error')
    });

    const toggle = useMutation({
        mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) => fetchJSON(`/packages/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
        onSuccess: (_, vars) => {
            invalidate();
            addToast(vars.isActive ? 'Package restored!' : 'Package archived!', 'info');
        },
        onError: (err: unknown) => addToast(`Status update failed: ${errorMessage(err)}`, 'error')
    });

    return { query, create, update, remove, toggle };
}


// ============ MAIN PAGE ============
export default function PackagesPage() {
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<FilterMode>('all');
    const [sort, setSort] = useState<SortMode>('price-desc');
    const categoriesWithAll = useMemo(() => ["All Categories", ...CATEGORIES], []);
    const [activeTab, setActiveTab] = useState("All Categories");
    const [modal, setModal] = useState<{ mode: 'add' | 'edit' | 'delete' | null; pkg?: PackageData; cat?: string }>({ mode: null });
    const [showRefine, setShowRefine] = useState(false);
    const refineRef = useRef<HTMLDivElement>(null);
    const categoryScrollRef = useRef<HTMLDivElement>(null);

    // Pagination State
    const [page, setPage] = useState(1);
    const ITEMS_PER_PAGE = 6;

    // RBAC
    const { hasPermission } = useAuth();
    const canManagePackages = hasPermission('manage_packages');
    const canDeletePackages = hasPermission('delete_packages');

    const { query, create, update, remove, toggle } = usePackages(canManagePackages);
    const packages = useMemo(() => Array.isArray(query.data) ? query.data : [], [query.data]);
    const isLoading = query.isLoading;

    // Filter & Sort Logic
    const processedData = useMemo(() => {
        let data = packages;
        if (filter === 'active') data = data.filter(p => p.isActive === 1);
        if (filter === 'archived') data = data.filter(p => p.isActive === 0);
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            data = data.filter(p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
        }

        return data.sort((a, b) => {
            if (sort === 'price-desc') return b.price - a.price;
            if (sort === 'price-asc') return a.price - b.price;
            return a.name.localeCompare(b.name);
        });
    }, [packages, filter, search, sort]);

    const activeCategoryItems = useMemo(() => {
        if (activeTab === "All Categories") return processedData;
        return processedData.filter(p => p.category === activeTab);
    }, [processedData, activeTab]);

    // Simple Client-side Pagination
    const totalPages = Math.ceil(activeCategoryItems.length / ITEMS_PER_PAGE);
    const paginatedItems = useMemo(() => {
        return activeCategoryItems.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
    }, [activeCategoryItems, page]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (refineRef.current && !refineRef.current.contains(e.target as Node)) {
                setShowRefine(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (!canManagePackages) {
        return (
            <div className={`${PAGE_SHELL_CLASS} flex items-center justify-center text-[var(--text-primary)]`}>
                <div className="w-full max-w-md border border-[var(--border)] bg-[var(--bg-card)] px-6 py-12 text-center">
                    <Package size={30} className="mx-auto mb-4 text-[var(--text-muted)]" />
                    <h1 className="font-display text-2xl text-[var(--text-primary)]">Access denied</h1>
                    <p className="mt-2 text-sm text-[var(--text-muted)]">You do not have permission to manage package bundles.</p>
                </div>
            </div>
        );
    }

    return (
        <div className={`${PAGE_SHELL_CLASS} text-[var(--text-primary)]`}>
            {isLoading ? (
                <div className="h-96 flex items-center justify-center">
                    <Loader2 className="animate-spin text-[var(--accent)]" size={32} />
                </div>
            ) : (
                <div className="mx-auto max-w-7xl space-y-6">

                {/* Header Area - Matches CreateInvoice 100% */}
                <div className="mb-10">
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                        <div className="flex-1 min-w-0">
                            <h1 className="text-2xl sm:text-3xl md:text-4xl text-[var(--text-primary)] mb-2 font-medium tracking-tight font-display">
                                Packages Collection
                            </h1>
                            <div className="label-xs text-[var(--text-muted)] font-sans">
                                STANDARD OPERATING PROCEDURE: SERVICE & CATALOG MANAGEMENT
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
                            {canManagePackages && (
                                <button onClick={() => setModal({ mode: 'add', cat: 'Wedding' })} className="bg-[var(--accent)] text-[var(--bg-deep)] px-6 py-2.5 rounded-lg label-xs font-bold hover:opacity-90 active:scale-[0.98] transition-colors flex items-center justify-center gap-2">
                                    <Plus size={16} /> Create Packages
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Unified Dashboard Panel */}
                <section className={`${PANEL_CARD_CLASS} space-y-6`}>

                    {/* Integrated Control Toolbar */}
                    <div className="flex flex-col gap-3 pb-4 border-b border-[var(--border)] relative z-40 xl:flex-row xl:items-center xl:gap-4">
                        <div className="relative min-w-0 flex-1">
                            <div className="pointer-events-none absolute right-0 top-0 z-10 flex h-full w-16 items-center justify-end bg-gradient-to-l from-[var(--bg-card)] via-[var(--bg-card)]/90 to-transparent pr-1 text-[var(--text-muted)]">
                                <ChevronRight size={16} aria-hidden="true" />
                            </div>
                            <div className="pointer-events-none absolute left-0 top-0 z-10 flex h-full w-16 items-center justify-start bg-gradient-to-r from-[var(--bg-card)] via-[var(--bg-card)]/90 to-transparent pl-1 text-[var(--text-muted)]">
                                <ChevronLeft size={16} aria-hidden="true" />
                            </div>
                            <div ref={categoryScrollRef} className="overflow-x-auto no-scrollbar px-14">
                            <div className={`${SEGMENT_GROUP_CLASS} w-max max-w-none`}>
                                {categoriesWithAll.map(cat => (
                                    <button
                                        key={cat}
                                        onClick={() => { setActiveTab(cat); setPage(1); }}
                                        className={clsx(
                                            SEGMENT_BUTTON_BASE_CLASS,
                                            activeTab === cat
                                                ? SEGMENT_BUTTON_ACTIVE_CLASS
                                                : SEGMENT_BUTTON_INACTIVE_CLASS
                                        )}
                                    >
                                        {cat}
                                    </button>
                            ))}
                            </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => categoryScrollRef.current?.scrollBy({ left: -220, behavior: 'smooth' })}
                                className="absolute left-0 top-1/2 z-20 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)] shadow-sm transition-colors hover:border-[var(--accent)]/50 hover:text-[var(--accent)]"
                                aria-label="Show previous package categories"
                                title="Scroll categories left"
                            >
                                <ChevronLeft size={16} />
                            </button>
                            <button
                                type="button"
                                onClick={() => categoryScrollRef.current?.scrollBy({ left: 220, behavior: 'smooth' })}
                                className="absolute right-0 top-1/2 z-20 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)] shadow-sm transition-colors hover:border-[var(--accent)]/50 hover:text-[var(--accent)]"
                                aria-label="Show more package categories"
                                title="Scroll categories right"
                            >
                                <ChevronRight size={16} />
                            </button>
                        </div>

                        <div className="flex w-full min-w-0 items-center gap-3 xl:w-[360px] xl:flex-none">
                            <div className="relative shrink-0" ref={refineRef}>
                                <button
                                    onClick={() => setShowRefine((prev) => !prev)}
                                    className="flex h-10 items-center gap-2 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-4 label-xs text-[var(--text-secondary)] hover:border-[var(--accent)]/40 transition-colors"
                                >
                                    <Filter size={14} className="text-[var(--text-muted)]" />
                                    Refine
                                </button>
                                <div
                                    className={clsx(
                                        'absolute left-0 top-full mt-2 z-[999] w-[min(calc(100vw-3rem),17rem)] rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3 origin-top-left transition-all duration-150',
                                        showRefine ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'
                                    )}
                                >
                                    <div className="space-y-3">
                                        <div>
                                            <label htmlFor="package-filter-status" className={FORM_LABEL_CLASS}>Status</label>
                                            <select
                                                id="package-filter-status"
                                                name="packageFilterStatus"
                                                value={filter}
                                                onChange={(e) => setFilter(e.target.value as FilterMode)}
                                                className="w-full bg-[var(--bg-deep)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
                                            >
                                                <option value="all">All</option>
                                                <option value="active">Active</option>
                                                <option value="archived">Archive</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label htmlFor="package-filter-sort" className={FORM_LABEL_CLASS}>Sort</label>
                                            <select
                                                id="package-filter-sort"
                                                name="packageFilterSort"
                                                value={sort}
                                                onChange={(e) => setSort(e.target.value as SortMode)}
                                                className="w-full bg-[var(--bg-deep)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
                                            >
                                                <option value="price-desc">Highest Price</option>
                                                <option value="price-asc">Lowest Price</option>
                                                <option value="name-asc">Name A-Z</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="relative min-w-0 flex-1 text-xs">
                                <label htmlFor="catalog-search" className="sr-only">Search catalog</label>
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                                <input
                                    id="catalog-search"
                                    name="catalogSearch"
                                    aria-label="Search catalog packages"
                                    type="text"
                                    placeholder="Search catalog..."
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    className={SEARCH_INPUT_CLASS + (search ? " pr-9" : "")}
                                    style={{ height: '40px', paddingLeft: '2.5rem' }}
                                />
                                {search && (
                                    <button
                                        onClick={() => setSearch('')}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                                        title="Clear search"
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Filter Active Badges */}
                    {(filter !== 'all' || sort !== 'price-desc' || search) && (
                        <div className="flex flex-wrap items-center gap-2 pt-1 pb-2">
                            {filter !== 'all' && (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-lg label-2xs border border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-elevated)]">
                                    Status: {filter === 'active' ? 'Active' : 'Archive'}
                                </span>
                            )}
                            {sort !== 'price-desc' && (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-lg label-2xs border border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-elevated)]">
                                    Sort: {sort === 'price-asc' ? 'Lowest Price' : 'Name A-Z'}
                                </span>
                            )}
                            {search && (
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg label-2xs border border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-elevated)]">
                                    Query: "{search}"
                                </span>
                            )}
                            <button
                                onClick={() => { setFilter('all'); setSort('price-desc'); setSearch(''); }}
                                className="label-2xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline underline-offset-2"
                            >
                                Reset Filters
                            </button>
                        </div>
                    )}

                    {/* Editorial Section Header */}
                    <div className="pl-4 border-l-2 border-[var(--accent)] text-left pt-2">
                        <h2 className="text-xl font-medium tracking-tight text-[var(--text-primary)] font-display">{activeTab}</h2>
                        <div className="label-xs text-[var(--accent)] mt-1 tracking-[0.2em]">
                            CATALOG & SERVICE PRICING ({activeCategoryItems.length} TOTAL)
                        </div>
                    </div>

                    {/* Catalog Package Grid */}
                    {activeCategoryItems.length === 0 ? (
                        <EmptyState
                            filter={filter}
                            search={search}
                            onClearSearch={() => setSearch('')}
                            onAdd={() => setModal({ mode: 'add', cat: activeTab })}
                            canAdd={canManagePackages}
                        />
                    ) : (
                        <>
                            <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {paginatedItems.map((pkg) => (
                                    <PricingCard key={pkg.id} pkg={pkg}
                                        canManage={canManagePackages}
                                        canDelete={canDeletePackages}
                                        onEdit={() => setModal({ mode: 'edit', pkg })}
                                        onDelete={() => setModal({ mode: 'delete', pkg })}
                                        onToggle={() => toggle.mutate({ id: pkg.id, isActive: pkg.isActive === 0 })}
                                    />
                                ))}
                            </div>

                            {totalPages > 1 && (
                                <div className="flex items-center justify-center gap-6 pt-4">
                                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-2 hover:text-[#c4a35a] disabled:opacity-30 disabled:hover:text-inherit transition-colors"><ChevronLeft size={20} /></button>
                                    <span className="label-xs text-[var(--accent)] tracking-widest">PAGE {page} / {totalPages}</span>
                                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 hover:text-[#c4a35a] disabled:opacity-30 disabled:hover:text-inherit transition-colors"><ChevronRight size={20} /></button>
                                </div>
                            )}
                        </>
                    )}

                </section>
            </div>
            )}

            {/* MODALS */}
            {modal.mode === 'add' && <FormModal pkg={undefined} cat={modal.cat} onClose={() => setModal({ mode: null })} onSubmit={d => create.mutateAsync(d).then(() => setModal({ mode: null }))} loading={create.isPending} />}
            {modal.mode === 'edit' && modal.pkg && <FormModal pkg={modal.pkg} onClose={() => setModal({ mode: null })} onSubmit={d => update.mutateAsync({ id: modal.pkg!.id, ...d }).then(() => setModal({ mode: null }))} loading={update.isPending} />}
            {modal.mode === 'delete' && modal.pkg && <DeleteModal pkg={modal.pkg} onClose={() => setModal({ mode: null })} onConfirm={() => remove.mutateAsync(modal.pkg!.id).then(() => setModal({ mode: null }))} loading={remove.isPending} />}
        </div>
    );
}

const PricingCard = memo(function PricingCard({ pkg, canManage, canDelete, onEdit, onDelete, onToggle }: { pkg: PackageData; canManage?: boolean; canDelete?: boolean; onEdit?: () => void; onDelete?: () => void; onToggle?: () => void }) {
    const isActive = pkg.isActive === 1;
    const lines = useMemo(() => pkg.description.split('\n').filter(Boolean), [pkg.description]);
    const formattedTitle = useMemo(() => pkg.name.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' '), [pkg.name]);
    const priceText = useMemo(() => formatPrice(pkg.price), [pkg.price]);

    const isBundle = pkg.category === "Bundling Package" || pkg.description.includes('**');
    const bundleSections = useMemo(() => isBundle ? parseBundleDescription(pkg.description) : [], [isBundle, pkg.description]);

    return (
        <div className={clsx(
            "group relative flex flex-col bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl overflow-hidden h-[360px] transition-all duration-200 hover:border-[var(--accent)]/50 hover:bg-[var(--bg-elevated)] hover:shadow-lg",
            !isActive && "opacity-70"
        )}>
            <div className="p-6 pb-4 border-b border-[var(--border)]/50 bg-transparent z-10 space-y-2">
                <div className="flex justify-between items-start gap-3">
                    <h4 className="text-xl font-bold text-[var(--text-primary)] leading-tight flex-1 font-display truncate" title={formattedTitle}>
                        {formattedTitle || 'Untitled Package'}
                    </h4>
                    {!isActive && <span className="label-2xs text-[var(--text-muted)] border border-[var(--border)] px-2 py-0.5 rounded-full shrink-0">Archived</span>}
                </div>

                <div className="flex items-center gap-2">
                    <span className={clsx(
                        'label-2xs font-extrabold border px-2.5 py-0.5 rounded-md uppercase tracking-wider',
                        CATEGORY_TONE[pkg.category] || 'border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]'
                    )}>
                        {pkg.category}
                    </span>
                </div>

                <div className="flex items-baseline gap-1.5 pt-1">
                    <span className="label-xs text-[var(--accent)] opacity-60 tracking-[0.2em]">IDR</span>
                    <span className="text-3xl text-[var(--accent)] font-semibold tracking-tight font-display">{priceText}</span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 pb-8 custom-scrollbar scrollbar-thin scrollbar-thumb-[var(--border)] scrollbar-track-transparent">
                <div className="space-y-4">
                    {isBundle ? (
                        bundleSections.map((sec, i) => (
                            <div key={i} className="space-y-2">
                                {sec.title && sec.title !== 'Package Details' && (
                                    <div className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--accent)] border-b border-[var(--accent)]/20 pb-1.5 flex items-center gap-1.5 font-display">
                                        <Sparkles size={12} className="text-[var(--accent)] shrink-0" />
                                        <span>{sec.title}</span>
                                    </div>
                                )}
                                <div className="space-y-1.5">
                                    {sec.details.split('\n').filter(Boolean).map((l, idx) => (
                                        <div key={idx} className="flex items-start gap-2.5 pl-0.5">
                                            <Check size={13} className="mt-1 text-[var(--accent)] shrink-0" />
                                            <span className="text-[12.5px] text-[var(--text-primary)] font-normal leading-relaxed">{l.replace(/^-\s*/, '')}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    ) : lines.length > 0 ? (
                        lines.map((l, i) => (
                            <div key={i} className="flex items-start gap-3">
                                <Check size={14} className="mt-1 text-[var(--accent)] shrink-0" />
                                <span className="text-[13px] text-[var(--text-primary)] font-normal leading-relaxed">{l.replace(/^-\s*/, '')}</span>
                            </div>
                        ))
                    ) : (
                        <div className="text-sm text-[var(--text-muted)] italic opacity-50 text-center py-8">No specifications added.</div>
                    )}
                </div>
            </div>

            <div className="p-4 bg-[var(--bg-elevated)]/30 border-t border-[var(--border)] mt-auto">
                {canManage ? (
                    <div className="flex items-center gap-2">
                        <button onClick={onEdit} className="flex-1 px-3 py-2.5 bg-[var(--bg-elevated)] border border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] hover:border-[var(--accent)]/50 label-xs rounded-lg transition-colors flex items-center justify-center gap-2">
                            <Edit2 size={12} /> Edit Package
                        </button>
                        <div className="flex items-center gap-1.5 shrink-0">
                            <button onClick={onToggle} className="p-2.5 bg-[var(--bg-elevated)] border border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg transition-colors" title={isActive ? 'Archive' : 'Restore'}>
                                {isActive ? <Archive size={14} /> : <RotateCcw size={14} />}
                            </button>
                            {!isActive && canDelete && (
                                <button onClick={onDelete} className="p-2.5 bg-red-500/5 border border-red-500/20 text-red-500 hover:bg-red-500 hover:text-white rounded-lg transition-colors" title="Delete Permanent">
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-center gap-2 text-[var(--text-muted)] label-xs py-2 opacity-40">
                        <Eye size={12} /> View Only
                    </div>
                )}
            </div>
        </div>
    );
});

function EmptyState({ onAdd, filter, search, onClearSearch, canAdd = true }: { onAdd: () => void, filter?: FilterMode, search?: string, onClearSearch?: () => void, canAdd?: boolean }) {
    let message = "No packages found";
    let subMessage = "Create a new package to get started";
    let Icon = Package;

    if (search) {
        message = `No results matching "${search}"`;
        subMessage = "Try adjusting your search terms or clear the search query.";
    } else if (filter === 'active') {
        message = "No active packages";
        subMessage = canAdd ? "All packages might be archived or not created yet." : "No active packages available.";
    } else if (filter === 'archived') {
        message = "No archived packages";
        subMessage = "You haven't archived any packages yet.";
        Icon = Archive;
    } else if (filter === 'all') {
        message = "Collection is empty";
        subMessage = canAdd ? "Start by adding your first service package." : "No packages available.";
    }

    return (
        <div className={clsx("border border-dashed border-[var(--border)] rounded-xl flex flex-col items-center justify-center text-center p-8 h-72")}>
            <div className="w-12 h-12 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center mb-4 text-[var(--accent)] shadow-inner">
                <Icon size={24} />
            </div>
            <h3 className="text-[var(--text-primary)] font-medium mb-1 font-display text-lg">{message}</h3>
            <p className="text-[var(--text-muted)] text-sm mb-6 max-w-xs mx-auto opacity-70">{subMessage}</p>
            {search ? (
                <button onClick={onClearSearch} className="px-4 py-2 bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-primary)] label-xs font-bold rounded hover:border-[var(--accent)]/50 transition-colors flex items-center gap-2">
                    <X size={14} /> Clear Search
                </button>
            ) : canAdd && (
                <button onClick={onAdd} className="px-4 py-2 bg-[var(--accent)] text-[var(--bg-deep)] label-xs font-bold rounded hover:opacity-90 transition-opacity flex items-center gap-2">
                    <Plus size={14} /> Create Package
                </button>
            )}
        </div>
    );
}

// ============ FORM & DELETE MODALS ============

function CustomSelect({ value, options, onChange, label, placeholder }: { value: string; options: string[]; onChange: (v: string) => void; label: string; placeholder?: string }) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="group/field relative" ref={containerRef}>
            <label className={FORM_LABEL_CLASS + " mb-2"}>
                {label}
            </label>
            <div
                onClick={() => setIsOpen(!isOpen)}
                className={clsx(
                    "w-full bg-[var(--bg-elevated)]/50 border rounded-2xl px-5 py-4 text-xs font-normal text-[var(--text-primary)] cursor-pointer flex items-center justify-between transition-colors",
                    isOpen ? "border-[var(--accent)] bg-[var(--bg-elevated)] shadow-lg" : "border-[var(--border)] hover:border-[var(--text-muted)]/50"
                )}
            >
                <span className={clsx(!value && "text-[var(--text-muted)] opacity-30")}>
                    {value || placeholder}
                </span>
                <ChevronLeft size={14} className={clsx("text-[var(--text-muted)] transition-transform duration-200", isOpen ? "rotate-90" : "-rotate-90")} />
            </div>

            {isOpen && (
                <div className="absolute top-full left-0 w-full mt-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-xl overflow-hidden z-[70] animate-in fade-in slide-in-from-top-2 duration-150">
                    <div className="max-h-[240px] overflow-y-auto custom-scrollbar py-2">
                        {options.map((opt) => (
                            <div
                                key={opt}
                                onClick={() => { onChange(opt); setIsOpen(false); }}
                                className={clsx(
                                    "px-5 py-3 text-xs font-normal transition-colors cursor-pointer",
                                    value === opt ? "bg-[var(--accent-muted)] text-[var(--accent)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                                )}
                            >
                                {opt}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

const FormModal = memo(function FormModal({ pkg, cat, onClose, onSubmit, loading }: { pkg?: PackageData; cat?: string; onClose: () => void; onSubmit: (d: PackageInput) => void; loading: boolean }) {
    const initialCategory = pkg?.category || cat || CATEGORIES[0];
    const initialDesc = pkg?.description || '';
    const nameInputRef = useRef<HTMLInputElement>(null);

    const [formData, setFormData] = useState({
        name: pkg?.name || '',
        category: initialCategory,
        price: pkg?.price || 0,
        description: initialDesc
    });

    const [modalTab, setModalTab] = useState<'editor' | 'preview'>('editor');

    const isAdd = !pkg;
    const modalTitle = isAdd ? (cat === 'Wedding' ? 'Add New Package' : `New ${cat} Package`) : 'Edit Package';

    // BUNDLE MODE STATE
    const isBundleCat = formData.category === "Bundling Package";
    const [editorMode, setEditorMode] = useState<'builder' | 'raw'>(isBundleCat ? 'builder' : 'raw');
    const [bundleItems, setBundleItems] = useState<BundleItem[]>(() => parseBundleDescription(initialDesc));

    // DEFERRED INPUT FOCUS (Prevents synchronous reflow during click processing)
    useEffect(() => {
        const timer = setTimeout(() => nameInputRef.current?.focus(), 50);
        return () => clearTimeout(timer);
    }, []);

    // KEYBOARD ESC LISTENER
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    // When Category changes, auto-switch mode if selecting Bundling Package
    const handleCategoryChange = (newCat: string) => {
        setFormData(prev => ({ ...prev, category: newCat }));
        if (newCat === "Bundling Package") {
            setEditorMode('builder');
        }
    };

    const updateBundleItem = (idx: number, field: keyof BundleItem, val: string) => {
        setBundleItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: val } : item));
    };

    const addBundleItem = () => {
        setBundleItems(prev => [...prev, { title: '', details: '' }]);
    };

    const removeBundleItem = (idx: number) => {
        if (bundleItems.length <= 1) return;
        setBundleItems(prev => prev.filter((_, i) => i !== idx));
    };

    const toggleEditorMode = () => {
        if (editorMode === 'builder') {
            const compiled = generateBundleDescription(bundleItems);
            setFormData(prev => ({ ...prev, description: compiled }));
            setEditorMode('raw');
        } else {
            setBundleItems(parseBundleDescription(formData.description));
            setEditorMode('builder');
        }
    };

    // Live compiled description for preview
    const previewDescription = useMemo(() => {
        if (isBundleCat && editorMode === 'builder') {
            return generateBundleDescription(bundleItems);
        }
        return formData.description;
    }, [isBundleCat, editorMode, bundleItems, formData.description]);

    const previewMockPackage: PackageData = useMemo(() => ({
        id: 0,
        name: formData.name || 'Package Preview Name',
        price: formData.price || 0,
        category: formData.category,
        description: previewDescription,
        isActive: 1
    }), [formData.name, formData.price, formData.category, previewDescription]);

    const handleSubmit = () => {
        const finalDescription = (isBundleCat && editorMode === 'builder')
            ? generateBundleDescription(bundleItems)
            : formData.description;

        onSubmit({
            ...formData,
            description: finalDescription
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80" onClick={onClose}>
            <div className={`w-full max-w-2xl bg-[var(--bg-card)] border-r sm:border border-[var(--border)] rounded-t-[32px] sm:rounded-[32px] shadow-2xl animate-in fade-in slide-in-from-bottom sm:zoom-in-95 duration-150 relative overflow-hidden flex flex-col max-h-[92vh] mb-0 sm:mb-4`} onClick={e => e.stopPropagation()}>

                {/* Modal Header */}
                <div className="px-6 sm:px-8 pt-8 pb-6 flex items-center justify-between relative border-b border-[var(--border)]/50">
                    <div className="border-l-2 border-[var(--accent)] pl-4">
                        <h2 className="text-xl sm:text-2xl text-[var(--text-primary)] font-medium tracking-tight font-display">{modalTitle}</h2>
                        <div className="label-xs text-[var(--accent)] mt-1 tracking-[0.2em]">PACKAGE SPECIFICATIONS</div>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Tab Switch: Form vs Preview */}
                        <div className="flex bg-[var(--bg-elevated)] p-1 rounded-xl border border-[var(--border)]">
                            <button
                                type="button"
                                onClick={() => setModalTab('editor')}
                                className={clsx("px-3 py-1 rounded-lg label-2xs transition-colors flex items-center gap-1.5", modalTab === 'editor' ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-bold shadow-sm" : "text-[var(--text-muted)]")}
                            >
                                <Edit2 size={12} /> Form
                            </button>
                            <button
                                type="button"
                                onClick={() => setModalTab('preview')}
                                className={clsx("px-3 py-1 rounded-lg label-2xs transition-colors flex items-center gap-1.5", modalTab === 'preview' ? "bg-[var(--accent)] text-[var(--bg-deep)] font-bold shadow-sm" : "text-[var(--text-muted)]")}
                            >
                                <Layout size={12} /> Live Card Preview
                            </button>
                        </div>

                        <button onClick={onClose} className="p-2.5 hover:bg-[var(--bg-hover)] rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                            <X size={18} />
                        </button>
                    </div>
                </div>

                <div className="px-6 sm:px-8 py-8 space-y-6 relative overflow-y-auto custom-scrollbar flex-1">

                    {modalTab === 'preview' ? (
                        /* LIVE CARD PREVIEW TAB */
                        <div className="space-y-4">
                            <div className="p-3 bg-[var(--accent-muted)]/15 border border-[var(--accent)]/30 rounded-xl text-center label-xs text-[var(--accent)]">
                                👁️ LIVE PREVIEW: How this package card will appear on the catalog
                            </div>
                            <div className="max-w-md mx-auto pt-2">
                                <PricingCard pkg={previewMockPackage} canManage={false} />
                            </div>
                        </div>
                    ) : (
                        /* FORM EDITOR TAB */
                        <>
                            <div className="group/field">
                                <label htmlFor="package-name" className={FORM_LABEL_CLASS + " mb-2"}>Package Name</label>
                                <input
                                    ref={nameInputRef}
                                    id="package-name"
                                    name="packageName"
                                    aria-label="Package Name"
                                    className="w-full bg-[var(--bg-elevated)]/50 border border-[var(--border)] rounded-2xl px-5 py-4 text-sm font-normal text-[var(--text-primary)] font-display focus:border-[var(--accent)] focus:bg-[var(--bg-elevated)] outline-none transition-colors placeholder:text-[var(--text-muted)] placeholder:text-xs placeholder:opacity-50 tracking-wide"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g. Platinum Wedding Bundle"
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <CustomSelect
                                    label="Category"
                                    value={formData.category}
                                    options={CATEGORIES}
                                    onChange={handleCategoryChange}
                                />
                                <div className="group/field">
                                    <label htmlFor="package-price" className={FORM_LABEL_CLASS + " mb-2"}>Price (IDR)</label>
                                    <div className="relative">
                                        <span className="absolute left-5 top-1/2 -translate-y-1/2 label-xs font-bold text-[var(--accent)] opacity-60 pointer-events-none">IDR</span>
                                        <input
                                            id="package-price"
                                            name="packagePrice"
                                            aria-label="Package Price in IDR"
                                            className="w-full bg-[var(--bg-elevated)]/50 border border-[var(--border)] rounded-2xl pl-14 pr-5 py-4 text-base font-semibold text-[var(--text-primary)] font-display text-right outline-none focus:border-[var(--accent)] focus:bg-[var(--bg-elevated)] transition-colors tracking-tight placeholder:text-[var(--text-muted)] placeholder:text-xs placeholder:opacity-50"
                                            value={formData.price > 0 ? formData.price.toLocaleString('id-ID') : ''}
                                            onChange={e => setFormData({ ...formData, price: Number(e.target.value.replace(/\D/g, '')) })}
                                            placeholder="0"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* BUNDLE / DETAILS SECTION HEADER */}
                            <div className="space-y-4 pt-2">
                                <div className="flex items-center justify-between">
                                    {isBundleCat && editorMode === 'builder' ? (
                                        <span className={FORM_LABEL_CLASS}>Package Details / Items</span>
                                    ) : (
                                        <label htmlFor="package-description" className={FORM_LABEL_CLASS}>Package Details / Items</label>
                                    )}
                                    {isBundleCat && (
                                        <button
                                            type="button"
                                            onClick={toggleEditorMode}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg label-2xs text-[var(--accent)] hover:border-[var(--accent)]/50 transition-colors"
                                        >
                                            {editorMode === 'builder' ? (
                                                <>
                                                    <FileText size={12} /> Switch to Raw Text
                                                </>
                                            ) : (
                                                <>
                                                    <Wrench size={12} /> Switch to Builder
                                                </>
                                            )}
                                        </button>
                                    )}
                                </div>

                                {/* BUNDLE ACTIVE BANNER */}
                                {isBundleCat && (
                                    <div className="p-3.5 bg-[var(--accent-muted)]/15 border border-[var(--accent)]/30 rounded-xl flex items-center justify-between gap-3 shadow-sm">
                                        <div className="flex items-center gap-2.5">
                                            <Lightbulb size={16} className="text-[var(--accent)] shrink-0" />
                                            <span className="text-xs font-semibold text-[var(--text-primary)]">
                                                Bundle Mode Active: <span className="font-normal text-[var(--text-secondary)]">Add multiple sub-packages below.</span>
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {/* BUILDER MODE */}
                                {isBundleCat && editorMode === 'builder' ? (
                                    <div className="space-y-4">
                                        {bundleItems.map((item, idx) => (
                                            <div key={idx} className="p-4 bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-2xl space-y-3 relative group">
                                                <div className="flex items-center justify-between">
                                                    <span className="label-xs text-[var(--accent)] font-bold">Sub-Package {idx + 1}</span>
                                                    {bundleItems.length > 1 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => removeBundleItem(idx)}
                                                            className="text-red-400 hover:text-red-300 p-1 rounded-md transition-colors"
                                                            title="Remove item"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    )}
                                                </div>

                                                <div className="space-y-2">
                                                    <input
                                                        id={`subpackage-title-${idx}`}
                                                        name={`subpackageTitle-${idx}`}
                                                        aria-label={`Sub-Package ${idx + 1} Title`}
                                                        type="text"
                                                        value={item.title}
                                                        onChange={e => updateBundleItem(idx, 'title', e.target.value)}
                                                        placeholder="Sub-Package Title (e.g. Wedding, Prewedding)"
                                                        className="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-xs font-medium text-[var(--text-primary)] focus:border-[var(--accent)] outline-none transition-colors placeholder:text-[var(--text-muted)] placeholder:text-[11px]"
                                                    />
                                                    <textarea
                                                        id={`subpackage-details-${idx}`}
                                                        name={`subpackageDetails-${idx}`}
                                                        aria-label={`Sub-Package ${idx + 1} Details`}
                                                        value={item.details}
                                                        onChange={e => updateBundleItem(idx, 'details', e.target.value)}
                                                        placeholder="- Item 1&#10;- Item 2"
                                                        className="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-xs text-[var(--text-secondary)] h-24 outline-none resize-none focus:border-[var(--accent)] transition-colors custom-scrollbar leading-relaxed placeholder:text-[var(--text-muted)] placeholder:text-[11px]"
                                                    />
                                                </div>
                                            </div>
                                        ))}

                                        <button
                                            type="button"
                                            onClick={addBundleItem}
                                            className="w-full py-3 bg-[var(--bg-elevated)] border border-dashed border-[var(--border)] hover:border-[var(--accent)]/50 rounded-xl label-xs text-[var(--accent)] font-bold transition-colors flex items-center justify-center gap-2"
                                        >
                                            <Plus size={14} /> Add Sub-Package Item
                                        </button>
                                    </div>
                                ) : (
                                    /* RAW TEXT MODE */
                                    <div className="space-y-1.5">
                                        {isBundleCat ? (
                                            <p className="text-[11px] text-[var(--text-muted)] italic">
                                                Mode Manual: Gunakan format <strong className="text-[var(--text-primary)]">**Title**</strong> untuk memisahkan paket.
                                            </p>
                                        ) : (
                                            <p className="text-[11px] text-[var(--text-muted)] italic">
                                                Tulis satu item per baris. Tekan ENTER untuk baris baru.
                                            </p>
                                        )}
                                        <textarea
                                            id="package-description"
                                            name="packageDescription"
                                            aria-label="Package Description Details"
                                            className="w-full bg-[var(--bg-elevated)]/50 border border-[var(--border)] rounded-2xl px-5 py-4 text-xs font-normal text-[var(--text-secondary)] h-36 outline-none resize-none focus:border-[var(--accent)] focus:bg-[var(--bg-elevated)] transition-colors custom-scrollbar leading-relaxed placeholder:text-[var(--text-muted)] placeholder:text-xs placeholder:opacity-40"
                                            value={formData.description}
                                            onChange={e => setFormData({ ...formData, description: e.target.value })}
                                            placeholder={
                                                isBundleCat
                                                    ? "**Wedding**\n- Item 1\n- Item 2\n\n**Prewedding**\n- Item A\n- Item B"
                                                    : "1 Photographer\n1 Videographer\nAlbum 20 Pages"
                                            }
                                        />
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                </div>

                <div className="px-6 sm:px-8 py-6 bg-[var(--bg-elevated)]/30 border-t border-[var(--border)]/50 flex flex-col sm:flex-row justify-end gap-3">
                    <button onClick={onClose} className="order-2 sm:order-1 px-6 py-3 label-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!formData.name || loading}
                        className="order-1 sm:order-2 min-w-[160px] px-6 py-3.5 bg-[var(--accent)] text-[var(--bg-deep)] rounded-xl label-xs font-bold shadow-lg shadow-[var(--accent)]/20 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:scale-100 transition-all flex items-center justify-center gap-3"
                    >
                        {loading && <Loader2 size={16} className="animate-spin" />}
                        <span>{isAdd ? 'Create Package' : 'Update Changes'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
});

function DeleteModal({ pkg, onClose, onConfirm, loading }: { pkg: PackageData; onClose: () => void; onConfirm: () => void; loading: boolean }) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
            <div className={`w-full max-w-sm bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-8 text-center animate-in fade-in zoom-in-95 duration-150`} onClick={e => e.stopPropagation()}>
                <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4 text-red-500">
                    <Trash2 size={24} />
                </div>
                <h2 className="text-xl text-[var(--text-primary)] mb-2 font-display">Delete Package?</h2>
                <p className="text-sm text-[var(--text-muted)] mb-8 leading-relaxed">Are you sure you want to permanently delete <span className="font-bold text-[var(--text-primary)]">"{pkg.name}"</span>?</p>
                <div className="flex gap-3">
                    <button onClick={onClose} className="flex-1 px-4 py-3 bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-secondary)] rounded-xl label-xs hover:bg-[var(--bg-hover)] transition-colors">Cancel</button>
                    <button onClick={onConfirm} disabled={loading} className="flex-1 px-4 py-3 bg-red-600 text-white rounded-xl label-xs hover:bg-red-700 transition-colors flex justify-center items-center gap-2 shadow-lg shadow-red-900/20">
                        {loading && <Loader2 size={14} className="animate-spin" />} Delete
                    </button>
                </div>
            </div>
        </div>
    );
}
