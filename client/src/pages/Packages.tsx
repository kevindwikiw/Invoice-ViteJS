import { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Edit2, Trash2, Archive, RotateCcw, X, Loader2, AlertCircle } from 'lucide-react';
import clsx from 'clsx';

// ============ TYPES ============
interface PackageData {
    id: number;
    name: string;
    price: number;
    category: 'Utama' | 'Bonus';
    description: string;
    isActive: number;
}

type FilterType = 'all' | 'active' | 'archived';
type ModalMode = 'add' | 'edit' | 'delete' | 'view' | null;

// ============ CONSTANTS ============
const CATEGORIES: PackageData['category'][] = ['Utama', 'Bonus'];
const QUERY_KEY = ['packages', 'all'] as const;

// ============ UTILS ============
const formatPrice = (n: number) => new Intl.NumberFormat('id-ID').format(n);

async function fetchJSON<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
    const res = await fetch(input, init);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Request failed: ${res.status}`);
    }
    return res.json();
}

// ============ HOOKS ============
function usePackages() {
    const queryClient = useQueryClient();

    const query = useQuery<PackageData[]>({
        queryKey: QUERY_KEY,
        queryFn: () => fetchJSON<PackageData[]>('/api/packages?all=true'),
    });

    const invalidate = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEY, exact: true });
    }, [queryClient]);

    const create = useMutation({
        mutationFn: (data: Omit<PackageData, 'id' | 'isActive'>) =>
            fetchJSON<PackageData>('/api/packages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            }),
        onSuccess: invalidate,
    });

    const update = useMutation({
        mutationFn: ({ id, ...data }: Partial<PackageData> & { id: number }) =>
            fetchJSON<PackageData>(`/api/packages/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            }),
        onSuccess: invalidate,
    });

    const remove = useMutation({
        mutationFn: (id: number) => fetchJSON(`/api/packages/${id}`, { method: 'DELETE' }),
        onSuccess: invalidate,
    });

    const toggleStatus = useMutation({
        mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
            fetchJSON(`/api/packages/${id}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isActive }),
            }),
        onSuccess: invalidate,
    });

    return { query, create, update, remove, toggleStatus };
}

function useModal(onClose: () => void) {
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handleEsc);
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', handleEsc);
            document.body.style.overflow = '';
        };
    }, [onClose]);
}

// ============ MAIN COMPONENT ============
export default function PackagesPage() {
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<FilterType>('active');
    const [modalMode, setModalMode] = useState<ModalMode>(null);
    const [selectedPkg, setSelectedPkg] = useState<PackageData | null>(null);
    const [addCategory, setAddCategory] = useState<PackageData['category']>('Utama');

    const { query, create, update, remove, toggleStatus } = usePackages();
    const { data: packages = [], isLoading, error } = query;

    const filtered = useMemo(() => {
        let data = [...packages];
        if (filter === 'active') data = data.filter(p => p.isActive === 1);
        else if (filter === 'archived') data = data.filter(p => p.isActive === 0);
        if (search) data = data.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
        return data.sort((a, b) => b.price - a.price);
    }, [packages, filter, search]);

    const utama = filtered.filter(p => p.category === 'Utama');
    const bonus = filtered.filter(p => p.category === 'Bonus');

    const counts = {
        all: packages.length,
        active: packages.filter(p => p.isActive === 1).length,
        archived: packages.filter(p => p.isActive === 0).length,
    };

    const closeModal = useCallback(() => {
        setModalMode(null);
        setSelectedPkg(null);
    }, []);

    const openAdd = (cat: PackageData['category']) => {
        setAddCategory(cat);
        setModalMode('add');
    };

    const openView = (pkg: PackageData) => { setSelectedPkg(pkg); setModalMode('view'); };
    const openEdit = (pkg: PackageData) => { setSelectedPkg(pkg); setModalMode('edit'); };
    const openDelete = (pkg: PackageData) => { setSelectedPkg(pkg); setModalMode('delete'); };

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-deep)' }}>
                <Loader2 className="animate-spin" size={24} style={{ color: 'var(--accent)' }} />
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-deep)' }}>
                <div className="text-center">
                    <AlertCircle size={32} className="mx-auto mb-4" style={{ color: '#ef4444' }} />
                    <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Failed to load packages</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen" style={{ background: 'var(--bg-deep)' }}>
            {/* Header */}
            <header className="px-8 py-12 text-center" style={{ borderBottom: '1px solid var(--border)' }}>
                <p className="text-[11px] tracking-[0.3em] uppercase mb-4" style={{ color: 'var(--accent)' }}>
                    Service Catalog
                </p>
                <h1 className="text-4xl md:text-5xl font-light" style={{ fontFamily: 'var(--font-display)' }}>
                    Packages
                </h1>
            </header>

            {/* Filter Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-8 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="flex items-center gap-6">
                    {(['all', 'active', 'archived'] as const).map(f => (
                        <button
                            key={f}
                            onClick={() => setFilter(f)}
                            className={clsx("text-xs tracking-[0.15em] uppercase pb-1 transition-all", filter === f ? "border-b-2" : "opacity-50 hover:opacity-100")}
                            style={{ borderColor: filter === f ? 'var(--accent)' : 'transparent' }}
                        >
                            {f} ({counts[f]})
                        </button>
                    ))}
                </div>
                <div className="relative">
                    <Search size={14} className="absolute left-0 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                    <input
                        type="text"
                        placeholder="Search..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-6 pr-4 py-2 text-sm bg-transparent border-b outline-none w-48 transition-colors"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                    />
                    {search && (
                        <button onClick={() => setSearch('')} className="absolute right-0 top-1/2 -translate-y-1/2">
                            <X size={12} style={{ color: 'var(--text-muted)' }} />
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="px-8 py-12">
                {/* Utama Section */}
                <Section
                    title="Utama"
                    subtitle="Main Packages"
                    count={utama.length}
                    accent="var(--accent)"
                    onAdd={() => openAdd('Utama')}
                >
                    {utama.length === 0 ? (
                        <EmptyState onAdd={() => openAdd('Utama')} />
                    ) : (
                        <div className="space-y-4">
                            {utama.map((pkg, i) => (
                                <PackageCard
                                    key={pkg.id}
                                    pkg={pkg}
                                    index={i}
                                    accent="var(--accent)"
                                    onView={() => openView(pkg)}
                                    onEdit={() => openEdit(pkg)}
                                    onDelete={() => openDelete(pkg)}
                                    onToggle={(active) => toggleStatus.mutate({ id: pkg.id, isActive: active })}
                                />
                            ))}
                        </div>
                    )}
                </Section>

                <div className="my-12 h-px" style={{ background: 'var(--border)' }} />

                {/* Bonus Section */}
                <Section
                    title="Bonus"
                    subtitle="Add-on Packages"
                    count={bonus.length}
                    accent="#a78bfa"
                    onAdd={() => openAdd('Bonus')}
                >
                    {bonus.length === 0 ? (
                        <EmptyState onAdd={() => openAdd('Bonus')} purple />
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {bonus.map((pkg, i) => (
                                <BonusCard
                                    key={pkg.id}
                                    pkg={pkg}
                                    index={i}
                                    onView={() => openView(pkg)}
                                    onEdit={() => openEdit(pkg)}
                                    onDelete={() => openDelete(pkg)}
                                    onToggle={(active) => toggleStatus.mutate({ id: pkg.id, isActive: active })}
                                />
                            ))}
                        </div>
                    )}
                </Section>
            </div>

            {/* Modals */}
            {modalMode === 'view' && selectedPkg && (
                <DetailModal pkg={selectedPkg} onClose={closeModal} onEdit={() => setModalMode('edit')} />
            )}
            {modalMode === 'add' && (
                <FormModal
                    title="New Package"
                    defaultCategory={addCategory}
                    onClose={closeModal}
                    onSubmit={(d) => create.mutateAsync(d).then(closeModal)}
                    loading={create.isPending}
                    error={create.error?.message}
                />
            )}
            {modalMode === 'edit' && selectedPkg && (
                <FormModal
                    title="Edit Package"
                    initialData={selectedPkg}
                    onClose={closeModal}
                    onSubmit={(d) => update.mutateAsync({ id: selectedPkg.id, ...d }).then(closeModal)}
                    loading={update.isPending}
                    error={update.error?.message}
                />
            )}
            {modalMode === 'delete' && selectedPkg && (
                <DeleteModal
                    name={selectedPkg.name}
                    onClose={closeModal}
                    onConfirm={() => remove.mutateAsync(selectedPkg.id).then(closeModal)}
                    loading={remove.isPending}
                />
            )}
        </div>
    );
}

// ============ SECTION COMPONENT ============
function Section({ title, subtitle, count, accent, onAdd, children }: {
    title: string; subtitle: string; count: number; accent: string; onAdd: () => void; children: React.ReactNode;
}) {
    return (
        <section>
            <div className="flex items-end justify-between mb-8">
                <div>
                    <p className="text-[11px] tracking-[0.25em] uppercase mb-2" style={{ color: accent }}>{subtitle}</p>
                    <h2 className="text-2xl font-light flex items-baseline gap-3" style={{ fontFamily: 'var(--font-display)' }}>
                        {title}
                        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>({count})</span>
                    </h2>
                </div>
                <button
                    onClick={onAdd}
                    className="flex items-center gap-2 px-4 py-2 text-xs tracking-[0.1em] uppercase transition-opacity hover:opacity-80"
                    style={{ background: accent, color: '#0a0a0a' }}
                >
                    <Plus size={14} /> Add
                </button>
            </div>
            {children}
        </section>
    );
}

// ============ EMPTY STATE ============
function EmptyState({ onAdd, purple }: { onAdd: () => void; purple?: boolean }) {
    return (
        <div className="py-16 text-center" style={{ border: '1px dashed var(--border)' }}>
            <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>No packages yet</p>
            <button onClick={onAdd} className="text-xs underline" style={{ color: purple ? '#a78bfa' : 'var(--accent)' }}>
                Create first package
            </button>
        </div>
    );
}

// ============ PACKAGE CARD (UTAMA) ============
function PackageCard({ pkg, index, accent, onView, onEdit, onDelete, onToggle }: {
    pkg: PackageData; index: number; accent: string;
    onView: () => void; onEdit: () => void; onDelete: () => void; onToggle: (isActive: boolean) => void;
}) {
    const isActive = pkg.isActive === 1;
    const lines = (pkg.description || '').split('\n').filter(Boolean);

    return (
        <div
            className={clsx("group p-6 transition-colors hover:bg-[var(--bg-card)]", !isActive && "opacity-50")}
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div className="flex items-start gap-4 flex-1">
                    <span className="text-xs font-mono mt-1" style={{ color: accent }}>
                        {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className="flex-1">
                        <h3 className="text-xl font-medium mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                            {pkg.name}
                        </h3>
                        {lines.length > 0 && (
                            <div className="space-y-1">
                                {lines.slice(0, 3).map((l, i) => (
                                    <p key={i} className="text-xs flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                                        <span className="w-2 h-px" style={{ background: accent }} />{l}
                                    </p>
                                ))}
                                {lines.length > 3 && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>+{lines.length - 3} more</p>}
                            </div>
                        )}
                        {!isActive && <span className="text-[10px] tracking-widest uppercase mt-2 inline-block" style={{ color: 'var(--text-muted)' }}>Archived</span>}
                    </div>
                </div>

                <div className="text-right md:text-left md:w-40">
                    <p className="text-[10px] tracking-widest uppercase mb-1" style={{ color: 'var(--text-muted)' }}>Price</p>
                    <p className="text-2xl font-light" style={{ color: accent }}>{formatPrice(pkg.price)}</p>
                    <p className="text-[10px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>IDR</p>
                </div>
            </div>

            <div className="flex items-center justify-between mt-6 pt-4 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity" style={{ borderTop: '1px solid var(--border)' }}>
                <button onClick={onView} className="text-xs tracking-widest uppercase" style={{ color: accent }}>
                    View Details →
                </button>
                <div className="flex items-center gap-2">
                    <button onClick={onEdit} className="p-2" style={{ color: 'var(--text-muted)' }}><Edit2 size={14} /></button>
                    <button onClick={() => onToggle(!isActive)} className="p-2" style={{ color: 'var(--text-muted)' }}>
                        {isActive ? <Archive size={14} /> : <RotateCcw size={14} />}
                    </button>
                    {!isActive && <button onClick={onDelete} className="p-2 hover:text-red-500" style={{ color: 'var(--text-muted)' }}><Trash2 size={14} /></button>}
                </div>
            </div>
        </div>
    );
}

// ============ BONUS CARD ============
function BonusCard({ pkg, index, onView, onEdit, onDelete, onToggle }: {
    pkg: PackageData; index: number;
    onView: () => void; onEdit: () => void; onDelete: () => void; onToggle: (isActive: boolean) => void;
}) {
    const isActive = pkg.isActive === 1;
    const lines = (pkg.description || '').split('\n').filter(Boolean);
    const accent = '#a78bfa';

    return (
        <div
            className={clsx("group p-6 transition-colors hover:bg-[var(--bg-card)]", !isActive && "opacity-50")}
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
            <div className="flex items-center justify-between mb-4">
                <span className="text-xs font-mono" style={{ color: accent }}>{String(index + 1).padStart(2, '0')}</span>
                {!isActive && <span className="text-[10px] tracking-widest uppercase" style={{ color: 'var(--text-muted)' }}>Archived</span>}
            </div>

            <h3 className="text-lg font-medium mb-2" style={{ fontFamily: 'var(--font-display)' }}>{pkg.name}</h3>
            {lines.length > 0 && <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>{lines.length} items</p>}

            <p className="text-xl font-light mb-6" style={{ color: accent }}>IDR {formatPrice(pkg.price)}</p>

            <div className="flex items-center justify-between pt-4 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity" style={{ borderTop: '1px solid var(--border)' }}>
                <button onClick={onView} className="text-xs tracking-widest uppercase" style={{ color: accent }}>Details</button>
                <div className="flex items-center gap-1">
                    <button onClick={onEdit} className="p-1.5" style={{ color: 'var(--text-muted)' }}><Edit2 size={12} /></button>
                    <button onClick={() => onToggle(!isActive)} className="p-1.5" style={{ color: 'var(--text-muted)' }}>
                        {isActive ? <Archive size={12} /> : <RotateCcw size={12} />}
                    </button>
                    {!isActive && <button onClick={onDelete} className="p-1.5 hover:text-red-500" style={{ color: 'var(--text-muted)' }}><Trash2 size={12} /></button>}
                </div>
            </div>
        </div>
    );
}

// ============ DETAIL MODAL ============
function DetailModal({ pkg, onClose, onEdit }: { pkg: PackageData; onClose: () => void; onEdit: () => void }) {
    useModal(onClose);
    const lines = (pkg.description || '').split('\n').filter(Boolean);
    const accent = pkg.category === 'Utama' ? 'var(--accent)' : '#a78bfa';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.9)' }} onClick={onClose}>
            <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-6" style={{ borderBottom: '1px solid var(--border)' }}>
                    <span className="text-[10px] tracking-[0.2em] uppercase px-3 py-1.5" style={{ background: accent, color: '#0a0a0a' }}>{pkg.category}</span>
                    <button onClick={onClose} className="p-2" style={{ color: 'var(--text-muted)' }}><X size={20} /></button>
                </div>

                <div className="p-8">
                    <h1 className="text-3xl font-light mb-2" style={{ fontFamily: 'var(--font-display)' }}>{pkg.name}</h1>
                    {pkg.isActive === 0 && <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>(Archived)</p>}
                    <p className="text-3xl font-light mb-10" style={{ color: accent }}>IDR {formatPrice(pkg.price)}</p>

                    <h3 className="text-[10px] tracking-[0.2em] uppercase mb-4" style={{ color: 'var(--text-muted)' }}>Includes ({lines.length})</h3>
                    {lines.length > 0 ? (
                        <div className="space-y-2 mb-10">
                            {lines.map((l, i) => (
                                <div key={i} className="flex items-center gap-4 p-4" style={{ background: 'var(--bg-elevated)' }}>
                                    <span className="text-xs font-mono" style={{ color: accent }}>{String(i + 1).padStart(2, '0')}</span>
                                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{l}</p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm italic mb-10" style={{ color: 'var(--text-muted)' }}>No items</p>
                    )}

                    <div className="flex gap-4">
                        <button onClick={onClose} className="flex-1 btn btn-ghost">Close</button>
                        <button onClick={onEdit} className="flex-1 btn btn-primary"><Edit2 size={14} /> Edit</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ============ FORM MODAL ============
function FormModal({ title, initialData, defaultCategory, onClose, onSubmit, loading, error }: {
    title: string; initialData?: PackageData; defaultCategory?: PackageData['category'];
    onClose: () => void; onSubmit: (d: Omit<PackageData, 'id' | 'isActive'>) => void; loading: boolean; error?: string;
}) {
    useModal(onClose);
    const [name, setName] = useState(initialData?.name || '');
    const [category, setCategory] = useState<PackageData['category']>(initialData?.category || defaultCategory || 'Utama');
    const [price, setPrice] = useState(initialData?.price || 0);
    const [description, setDescription] = useState(initialData?.description || '');
    const lines = description.split('\n').filter(Boolean);
    const accent = category === 'Utama' ? 'var(--accent)' : '#a78bfa';

    const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.replace(/[^\d]/g, '');
        setPrice(raw ? Number(raw) : 0);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.9)' }} onClick={onClose}>
            <div className="w-full max-w-md" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-6" style={{ borderBottom: `2px solid ${accent}` }}>
                    <h2 className="text-lg font-light" style={{ fontFamily: 'var(--font-display)' }}>{title}</h2>
                    <button onClick={onClose} className="p-1" style={{ color: 'var(--text-muted)' }}><X size={18} /></button>
                </div>

                <div className="p-6 space-y-5">
                    {error && (
                        <div className="p-3 text-sm flex items-center gap-2" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                            <AlertCircle size={14} /> {error}
                        </div>
                    )}

                    <div>
                        <label className="block text-[10px] tracking-[0.15em] uppercase mb-2" style={{ color: 'var(--text-muted)' }}>Name</label>
                        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Package name" className="w-full px-4 py-3 text-sm" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[10px] tracking-[0.15em] uppercase mb-2" style={{ color: 'var(--text-muted)' }}>Category</label>
                            <select value={category} onChange={e => setCategory(e.target.value as PackageData['category'])} className="w-full px-4 py-3 text-sm" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] tracking-[0.15em] uppercase mb-2" style={{ color: 'var(--text-muted)' }}>Price (IDR)</label>
                            <input type="text" value={price > 0 ? price.toLocaleString('id-ID') : ''} onChange={handlePriceChange} placeholder="0" className="w-full px-4 py-3 text-sm text-right" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                        </div>
                    </div>
                    <div>
                        <label className="block text-[10px] tracking-[0.15em] uppercase mb-2" style={{ color: 'var(--text-muted)' }}>Items (one per line)</label>
                        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={5} placeholder="2 Photographer&#10;1 Videographer" className="w-full px-4 py-3 text-sm resize-none" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                        {lines.length > 0 && <p className="text-xs mt-2" style={{ color: accent }}>{lines.length} items</p>}
                    </div>
                </div>

                <div className="flex gap-4 p-6" style={{ borderTop: '1px solid var(--border)' }}>
                    <button onClick={onClose} className="flex-1 btn btn-ghost">Cancel</button>
                    <button onClick={() => { if (name.trim()) onSubmit({ name: name.trim(), category, price, description: description.trim() }); }} disabled={!name.trim() || loading} className="flex-1 btn btn-primary disabled:opacity-50">
                        {loading && <Loader2 size={14} className="animate-spin" />} Save
                    </button>
                </div>
            </div>
        </div>
    );
}

// ============ DELETE MODAL ============
function DeleteModal({ name, onClose, onConfirm, loading }: { name: string; onClose: () => void; onConfirm: () => void; loading: boolean }) {
    useModal(onClose);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.9)' }} onClick={onClose}>
            <div className="w-full max-w-sm p-8 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
                <h2 className="text-xl font-light mb-4" style={{ fontFamily: 'var(--font-display)' }}>Delete Package</h2>
                <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>Remove "{name}" permanently?</p>
                <div className="flex gap-4">
                    <button onClick={onClose} className="flex-1 btn btn-ghost">Cancel</button>
                    <button onClick={onConfirm} disabled={loading} className="flex-1 py-3 text-xs tracking-widest uppercase disabled:opacity-50 flex items-center justify-center gap-2" style={{ background: '#ef4444', color: '#fff' }}>
                        {loading && <Loader2 size={14} className="animate-spin" />} Delete
                    </button>
                </div>
            </div>
        </div>
    );
}
