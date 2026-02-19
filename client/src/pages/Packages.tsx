import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Edit2, Trash2, Archive, RotateCcw, X, Loader2, Check, ChevronLeft, ChevronRight, Info, Filter, Package, Eye } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../context/auth';

// ============ TYPES ============
interface PackageData {
    id: number;
    name: string;
    price: number;
    category: 'Utama' | 'Bonus';
    description: string;
    isActive: number;
}
type FilterMode = 'active' | 'archived' | 'all';
type SortMode = 'price-desc' | 'price-asc' | 'name-asc';

// ============ UTILS ============
const formatPrice = (n: number) => new Intl.NumberFormat('id-ID').format(n);

// Use fetchWithAuth from context for auto-refresh support
import { fetchWithAuth } from '../context/auth';

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetchWithAuth(url, init);
    if (!res.ok) throw new Error(await res.text() || `Request failed: ${res.status}`);
    return res.json();
}

// ============ HOOKS ============
function usePackages() {
    const queryClient = useQueryClient();
    const query = useQuery<PackageData[]>({ queryKey: ['packages', 'all'], queryFn: () => fetchJSON<PackageData[]>('/packages?all=true') });
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['packages'] });

    const create = useMutation({ mutationFn: (d: any) => fetchJSON('/packages', { method: 'POST', body: JSON.stringify(d) }), onSuccess: invalidate });
    const update = useMutation({ mutationFn: ({ id, ...d }: any) => fetchJSON(`/packages/${id}`, { method: 'PUT', body: JSON.stringify(d) }), onSuccess: invalidate });
    const remove = useMutation({ mutationFn: (id: number) => fetchJSON(`/packages/${id}`, { method: 'DELETE' }), onSuccess: invalidate });
    const toggle = useMutation({ mutationFn: ({ id, isActive }: any) => fetchJSON(`/packages/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }), onSuccess: invalidate });

    return { query, create, update, remove, toggle };
}


// ============ MAIN PAGE ============
export default function PackagesPage() {
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<FilterMode>('active');
    const [sort, setSort] = useState<SortMode>('price-desc');
    const [modal, setModal] = useState<{ mode: 'add' | 'edit' | 'delete' | null; pkg?: PackageData; cat?: 'Utama' | 'Bonus' }>({ mode: null });

    // Pagination State
    const [page, setPage] = useState(1);
    const ITEMS_PER_PAGE = 6;

    // RBAC
    const { hasPermission } = useAuth();
    const canManagePackages = hasPermission('manage_packages');

    const { query, create, update, remove, toggle } = usePackages();
    const packages = Array.isArray(query.data) ? query.data : [];
    const isLoading = query.isLoading;


    // Filter & Sort Logic
    const processedData = useMemo(() => {
        let data = packages;
        if (filter === 'active') data = data.filter(p => p.isActive === 1);
        if (filter === 'archived') data = data.filter(p => p.isActive === 0);
        if (search) data = data.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase()));

        return data.sort((a, b) => {
            if (sort === 'price-desc') return b.price - a.price;
            if (sort === 'price-asc') return a.price - b.price;
            return a.name.localeCompare(b.name);
        });
    }, [packages, filter, search, sort]);

    const utama = processedData.filter(p => p.category === 'Utama');
    const bonus = processedData.filter(p => p.category === 'Bonus');

    const stats = useMemo(() => ({
        active: packages.filter(p => p.isActive === 1).length,
        archived: packages.filter(p => p.isActive === 0).length
    }), [packages]);

    // Simple Client-side Pagination for Utama
    const totalPages = Math.ceil(utama.length / ITEMS_PER_PAGE);
    const paginatedUtama = utama.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

    if (isLoading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-[#c9a96e]" /></div>;

    return (
        <div className="min-h-screen bg-[var(--bg-deep)] text-[var(--text-primary)] p-6 md:p-10 font-sans">

            {/* Header Area */}
            <div className="max-w-7xl mx-auto mb-10 space-y-6">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                    <div>
                        <h1 className="text-4xl text-[var(--text-primary)] mb-2" style={{ fontFamily: 'var(--font-display)' }}>Packages Collection</h1>
                        <div className="flex items-center gap-4 text-xs tracking-wider uppercase text-neutral-500">
                            <span>{stats.active} Active</span>
                            <span className="w-1 h-1 bg-neutral-700 rounded-full" />
                            <span>{stats.archived} Archived</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-2 py-1">
                            <Filter size={14} className="text-[var(--text-muted)] ml-2" />
                            <select
                                value={sort}
                                onChange={(e) => setSort(e.target.value as SortMode)}
                                className="bg-transparent text-xs text-[var(--text-primary)] p-2 border-none outline-none cursor-pointer"
                            >
                                <option value="price-desc" className="bg-[var(--bg-card)]">Highest Price</option>
                                <option value="price-asc" className="bg-[var(--bg-card)]">Lowest Price</option>
                                <option value="name-asc" className="bg-[var(--bg-card)]">Name A-Z</option>
                            </select>
                        </div>
                        {canManagePackages && (
                            <button onClick={() => setModal({ mode: 'add', cat: 'Utama' })} className="bg-[var(--accent)] text-[var(--bg-deep)] px-6 py-2.5 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity flex items-center gap-2 shadow-lg">
                                <Plus size={16} /> NEW PACKAGE
                            </button>
                        )}
                    </div>
                </div>

                <div className="flex flex-col md:flex-row gap-4 border-b border-neutral-800 pb-6">
                    <div className="flex bg-neutral-900 rounded-lg p-1 border border-neutral-800">
                        {(['active', 'all', 'archived'] as const).map(f => (
                            <button key={f} onClick={() => setFilter(f)} className={clsx("px-4 py-1.5 text-xs uppercase tracking-wider rounded-md transition-all", filter === f ? "bg-[var(--bg-hover)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]")}>
                                {f}
                            </button>
                        ))}
                    </div>
                    <div className="relative flex-1 max-w-md">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                        <input type="text" placeholder="Search collection..." value={search} onChange={e => setSearch(e.target.value)}
                            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg pl-10 pr-4 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none transition-colors" />
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto space-y-20">

                {/* UTAMA GRID */}
                <section>
                    <div className="flex items-end gap-4 mb-8">
                        <h2 className="text-2xl text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>Main Packages</h2>
                        <span className="text-xs text-[var(--text-muted)] mb-1.5 font-mono">({paginatedUtama.length} of {utama.length})</span>
                    </div>

                    {utama.length === 0 ? <EmptyState filter={filter} onAdd={() => setModal({ mode: 'add', cat: 'Utama' })} /> : (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                                {paginatedUtama.map((pkg) => (
                                    <PricingCard key={pkg.id} pkg={pkg}
                                        canManage={canManagePackages}
                                        onEdit={() => setModal({ mode: 'edit', pkg })}
                                        onDelete={() => setModal({ mode: 'delete', pkg })}
                                        onToggle={() => toggle.mutate({ id: pkg.id, isActive: pkg.isActive === 0 })}
                                    />
                                ))}
                            </div>

                            {/* Pagination */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-center gap-6 mt-12 pb-8 border-b border-neutral-800">
                                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-2 hover:text-[#c4a35a] disabled:opacity-30 disabled:hover:text-inherit transition-colors"><ChevronLeft size={20} /></button>
                                    <span className="text-xs tracking-widest text-[#c4a35a]">SLIDE {page} / {totalPages}</span>
                                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 hover:text-[#c4a35a] disabled:opacity-30 disabled:hover:text-inherit transition-colors"><ChevronRight size={20} /></button>
                                </div>
                            )}
                        </>
                    )}
                </section>

                {/* BONUS GRID */}
                <section>
                    <div className="flex items-center justify-between gap-4 mb-8">
                        <h2 className="text-2xl text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>Bonus Packages</h2>
                        {canManagePackages && (
                            <button onClick={() => setModal({ mode: 'add', cat: 'Bonus' })} className="text-xs text-[var(--accent)] hover:underline uppercase tracking-wider flex items-center gap-2 transition-colors">
                                <Plus size={12} /> Add Bonus Item
                            </button>
                        )}
                    </div>

                    {bonus.length === 0 ? <EmptyState compact filter={filter} onAdd={() => setModal({ mode: 'add', cat: 'Bonus' })} canAdd={canManagePackages} /> : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            {bonus.map((pkg) => (
                                <PricingCard key={pkg.id} pkg={pkg}
                                    canManage={canManagePackages}
                                    onEdit={() => setModal({ mode: 'edit', pkg })}
                                    onDelete={() => setModal({ mode: 'delete', pkg })}
                                    onToggle={() => toggle.mutate({ id: pkg.id, isActive: pkg.isActive === 0 })}
                                />
                            ))}
                        </div>
                    )}
                </section>

            </div>

            {/* MODALS */}
            {modal.mode === 'add' && <FormModal title={`New ${modal.cat === 'Utama' ? 'Main' : modal.cat} Package`} cat={modal.cat} onClose={() => setModal({ mode: null })} onSubmit={d => create.mutateAsync(d).then(() => setModal({ mode: null }))} loading={create.isPending} />}
            {modal.mode === 'edit' && modal.pkg && <FormModal title="Edit Package" pkg={modal.pkg} onClose={() => setModal({ mode: null })} onSubmit={d => update.mutateAsync({ id: modal.pkg!.id, ...d }).then(() => setModal({ mode: null }))} loading={update.isPending} />}
            {modal.mode === 'delete' && modal.pkg && <DeleteModal pkg={modal.pkg} onClose={() => setModal({ mode: null })} onConfirm={() => remove.mutateAsync(modal.pkg!.id).then(() => setModal({ mode: null }))} loading={remove.isPending} />}
        </div>
    );
}

// ============ CARD COMPONENTS ============

function PricingCard({ pkg, canManage, onEdit, onDelete, onToggle }: { pkg: PackageData; canManage: boolean; onEdit: () => void; onDelete: () => void; onToggle: () => void }) {
    const isActive = pkg.isActive === 1;
    const lines = pkg.description.split('\n').filter(Boolean);

    return (
        <div className={clsx(
            "group relative flex flex-col bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden h-[320px] transition-colors duration-200 hover:border-[var(--accent)]/30",
            !isActive && "opacity-60 grayscale"
        )}>
            {/* Header Fixed */}
            <div className="p-6 pb-4 border-b border-[var(--border-light)]/50 bg-[var(--bg-card)] z-10">
                <div className="flex justify-between items-start mb-2">
                    <h3 className="text-xl text-[var(--text-primary)] font-medium line-clamp-1 pr-2" style={{ fontFamily: 'var(--font-display)' }}>{pkg.name}</h3>
                    {!isActive && <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] border border-[var(--border)] px-1.5 py-0.5 rounded">Archived</span>}
                </div>
                <div className="flex items-baseline gap-1.5">
                    <span className="text-xs text-[var(--accent)]/80">IDR</span>
                    <span className="text-2xl text-[var(--accent)] font-light tracking-wide">{formatPrice(pkg.price)}</span>
                </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 custom-scrollbar">
                {lines.map((l, i) => (
                    <div key={i} className="flex items-start gap-3">
                        <Check size={14} className="mt-1 text-[var(--accent)] shrink-0 opacity-80" />
                        <span className="text-sm text-[var(--text-secondary)] font-light leading-relaxed">{l}</span>
                    </div>
                ))}
                {lines.length === 0 && <div className="text-sm text-[var(--text-muted)] italic">No details added.</div>}
            </div>

            {/* Actions Footer Fixed */}
            <div className="p-4 bg-[var(--bg-card)] border-t border-[var(--border)] mt-auto">
                {canManage ? (
                    <div className="grid grid-cols-[1fr,auto,auto] gap-2">
                        <button onClick={onEdit} className="px-3 py-2 bg-[var(--bg-elevated)] border border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-medium uppercase tracking-wider rounded transition-all flex items-center justify-center gap-2">
                            <Edit2 size={12} /> Edit
                        </button>
                        <button onClick={onToggle} className="p-2 bg-[var(--bg-elevated)] border border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded transition-all" title={isActive ? 'Archive' : 'Restore'}>
                            {isActive ? <Archive size={14} /> : <RotateCcw size={14} />}
                        </button>
                        {!isActive && (
                            <button onClick={onDelete} className="p-2 bg-red-500/10 border border-red-500/50 text-red-500 hover:bg-red-600 hover:text-white hover:border-red-600 rounded transition-all shadow-[0_0_15px_-3px_rgba(239,68,68,0.3)] hover:shadow-[0_0_20px_rgba(220,38,38,0.6)]" title="Delete Permanent">
                                <Trash2 size={16} strokeWidth={2.5} />
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="flex items-center justify-center gap-2 text-[var(--text-muted)] text-xs py-2">
                        <Eye size={14} /> View Only
                    </div>
                )}
            </div>
        </div>
    );
}

// BonusCard removed (replaced by PricingCard)

function EmptyState({ compact, onAdd, filter, canAdd = true }: { compact?: boolean, onAdd: () => void, filter?: FilterMode, canAdd?: boolean }) {
    let message = "No packages found";
    let subMessage = "Create a new package to get started";
    let Icon = Package;

    if (filter === 'active') {
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
        <div className={clsx("border border-dashed border-[var(--border)] rounded-xl flex flex-col items-center justify-center text-center p-8", compact ? "h-40" : "h-72")}>
            <div className="w-12 h-12 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center mb-4 text-[var(--accent)]">
                <Icon size={24} />
            </div>
            <h3 className="text-[var(--text-primary)] font-medium mb-1">{message}</h3>
            <p className="text-[var(--text-muted)] text-sm mb-6 max-w-xs mx-auto">{subMessage}</p>
            {canAdd && (
                <button onClick={onAdd} className="px-4 py-2 bg-[var(--accent)] text-[var(--bg-deep)] text-xs font-bold uppercase tracking-wider rounded hover:opacity-90 transition-opacity shadow-lg flex items-center gap-2">
                    <Plus size={14} /> Create Package
                </button>
            )}
        </div>
    );
}

// ============ FORM & DELETE MODALS ============
function FormModal({ title, pkg, cat, onClose, onSubmit, loading }: { title: string; pkg?: PackageData; cat?: 'Utama' | 'Bonus'; onClose: () => void; onSubmit: (d: any) => void; loading: boolean }) {
    const [formData, setFormData] = useState({ name: pkg?.name || '', category: pkg?.category || cat || 'Utama', price: pkg?.price || 0, description: pkg?.description || '' });
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md" onClick={onClose}>
            <div className="w-full max-w-lg bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="px-6 py-5 border-b border-[var(--border)] flex justify-between items-center">
                    <h3 className="text-xl text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>{title}</h3>
                    <button onClick={onClose}><X size={20} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]" /></button>
                </div>
                <div className="p-6 space-y-5">
                    <div>
                        <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest block mb-1.5">Package Name</label>
                        <input className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-4 py-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none transition-colors" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} autoFocus placeholder="e.g. Signature Wedding Package" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div><label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest block mb-1.5">Category</label><select className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-4 py-3 text-sm text-[var(--text-primary)] outline-none" value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value as any })}><option value="Utama">Main</option><option value="Bonus">Bonus</option></select></div>
                        <div><label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest block mb-1.5">Price (IDR)</label><input className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-4 py-3 text-sm text-[var(--text-primary)] text-right outline-none focus:border-[var(--accent)]" value={formData.price > 0 ? formData.price.toLocaleString('id-ID') : ''} onChange={e => setFormData({ ...formData, price: Number(e.target.value.replace(/\D/g, '')) })} placeholder="0" /></div>
                    </div>
                    <div>
                        <div className="flex justify-between items-center mb-1.5">
                            <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Details Included</label>
                            <div className="flex items-center gap-1 text-[10px] text-[var(--accent)] tracking-wide"><Info size={10} /> <span>ONE ITEM PER LINE</span></div>
                        </div>
                        <textarea className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-4 py-3 text-sm text-[var(--text-primary)] h-32 outline-none resize-none focus:border-[var(--accent)]" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="2 Photographers&#10;1 Videographer&#10;Album 20x30..." />
                        <div className="mt-3 p-3 bg-[var(--bg-elevated)]/50 border border-[var(--border)] rounded-lg flex gap-3">
                            <span className="text-base">💡</span>
                            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                                <span className="font-bold text-[var(--text-primary)]">Description Tips:</span> Write key details in the first 3 lines (e.g. Duration, Output, Benefits) for a neat card view.
                            </p>
                        </div>
                    </div>
                </div>
                <div className="px-6 py-4 border-t border-[var(--border)] flex justify-end gap-3 bg-[var(--bg-card)]"><button onClick={onClose} className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]">Cancel</button><button onClick={() => onSubmit(formData)} disabled={!formData.name || loading} className="px-6 py-2 bg-[var(--accent)] text-[var(--bg-deep)] text-sm font-bold uppercase tracking-widest rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-2 shadow-lg">{loading && <Loader2 size={14} className="animate-spin" />} Save Package</button></div>
            </div>
        </div>
    );
}

function DeleteModal({ pkg, onClose, onConfirm, loading }: { pkg: PackageData; onClose: () => void; onConfirm: () => void; loading: boolean }) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md" onClick={onClose}>
            <div className="w-full max-w-sm bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-8 text-center" onClick={e => e.stopPropagation()}>
                <h3 className="text-xl text-[var(--text-primary)] mb-2" style={{ fontFamily: 'var(--font-display)' }}>Delete Package?</h3>
                <p className="text-sm text-[var(--text-secondary)] mb-8 leading-relaxed">Are you sure you want to permanently remove <span className="text-[var(--text-primary)] font-medium">"{pkg.name}"</span>? This cannot be undone.</p>
                <div className="flex gap-3"><button onClick={onClose} className="flex-1 px-4 py-2.5 bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-secondary)] rounded hover:bg-[var(--bg-hover)] uppercase text-xs font-bold tracking-wider">Cancel</button><button onClick={onConfirm} disabled={loading} className="flex-1 px-4 py-2.5 bg-red-900/80 text-white rounded hover:bg-red-800 flex justify-center gap-2 uppercase text-xs font-bold tracking-wider">{loading && <Loader2 size={14} className="animate-spin" />} Delete</button></div>
            </div>
        </div>
    );
}
