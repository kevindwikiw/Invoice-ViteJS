import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus, Trash2, Save, ShoppingCart, User, Loader2, Calendar, MapPin, Phone, FileText, CreditCard, Package, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import clsx from 'clsx';

// Types
interface InvoiceItem {
    id: string;
    desc: string;
    price: number;
    qty: number;
    isBundle?: boolean;
    _rowId?: string;
}

interface PaymentTerm {
    id: string;
    label: string;
    amount: number;
    locked: boolean;
}

interface PackageData {
    id: number;
    name: string;
    price: number;
    description: string;
    category: string;
}

const CATEGORIES = ['Utama', 'Bonus'];
const ITEMS_PER_PAGE = 6;

// Utility
const rupiah = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

export default function CreateInvoice() {
    // === FORM STATE ===
    const [invoiceNo, setInvoiceNo] = useState(() => {
        const now = new Date();
        return `INV/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
    });
    const [weddingDate, setWeddingDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [venue, setVenue] = useState('');
    const [clientName, setClientName] = useState('');
    const [clientPhone, setClientPhone] = useState('');
    const [eventTitle, setEventTitle] = useState('');

    // === CART STATE ===
    const [cartItems, setCartItems] = useState<InvoiceItem[]>([]);
    const [cashback, setCashback] = useState(0);

    // === PAYMENT STATE ===
    const [paymentTerms, setPaymentTerms] = useState<PaymentTerm[]>([
        { id: 'dp', label: 'DP', amount: 0, locked: true },
        { id: 'full', label: 'Pelunasan', amount: 0, locked: true }
    ]);

    // === SIDEBAR STATE ===
    const [searchQuery, setSearchQuery] = useState('');
    const [categoryPages, setCategoryPages] = useState<Record<string, number>>({ Utama: 0, Bonus: 0 });


    // Fetch Packages
    const { data: packages = [], isLoading } = useQuery<PackageData[]>({
        queryKey: ['packages'],
        queryFn: async () => {
            const res = await fetch('/api/packages');
            return res.json();
        }
    });

    const navigate = useNavigate();
    const queryClient = useQueryClient();

    // === CALCULATIONS ===
    const subtotal = useMemo(() =>
        cartItems.reduce((sum, item) => sum + (item.price * item.qty), 0),
        [cartItems]
    );
    const grandTotal = useMemo(() => Math.max(0, subtotal - cashback), [subtotal, cashback]);
    const totalAllocated = useMemo(() =>
        paymentTerms.reduce((sum, t) => sum + t.amount, 0),
        [paymentTerms]
    );
    const remaining = grandTotal - totalAllocated;

    // === PACKAGE GROUPING ===
    const groupedPackages = useMemo(() => {
        const filtered = packages.filter((p) =>
            p.name.toLowerCase().includes(searchQuery.toLowerCase())
        );

        const grouped: Record<string, PackageData[]> = {};
        CATEGORIES.forEach(cat => { grouped[cat] = []; });

        filtered.forEach(pkg => {
            const cat = pkg.category || 'Utama';
            if (grouped[cat]) grouped[cat].push(pkg);
        });

        // Sort by price descending
        Object.keys(grouped).forEach(cat => {
            grouped[cat].sort((a, b) => b.price - a.price);
        });

        return grouped;
    }, [packages, searchQuery]);

    // === CART ACTIONS ===
    const cartRowIds = useMemo(() => new Set(cartItems.map(i => i._rowId)), [cartItems]);

    const addToCart = (pkg: PackageData) => {
        const rowId = String(pkg.id);
        if (cartRowIds.has(rowId)) return;

        setCartItems(prev => [...prev, {
            id: `item_${Date.now()}`,
            desc: pkg.name,
            price: pkg.price,
            qty: 1,
            _rowId: rowId
        }]);
    };

    const removeFromCart = (rowId: string) => {
        setCartItems(prev => prev.filter(i => i._rowId !== rowId));
    };

    const updateCartItem = (id: string, field: keyof InvoiceItem, value: any) => {
        setCartItems(prev => prev.map(item =>
            item.id === id ? { ...item, [field]: value } : item
        ));
    };

    const deleteCartItem = (id: string) => {
        setCartItems(prev => prev.filter(i => i.id !== id));
    };

    // === PAYMENT ACTIONS ===
    const updatePaymentTerm = (id: string, field: 'label' | 'amount', value: string | number) => {
        setPaymentTerms(prev => prev.map(t =>
            t.id === id ? { ...t, [field]: field === 'amount' ? Number(value) : value } : t
        ));
    };

    const addPaymentTerm = () => {
        if (paymentTerms.length >= 6) return;
        const newTerm: PaymentTerm = {
            id: `term_${Date.now()}`,
            label: `Payment ${paymentTerms.length}`,
            amount: 0,
            locked: false
        };
        // Insert before Pelunasan
        const fullIdx = paymentTerms.findIndex(t => t.id === 'full');
        const newTerms = [...paymentTerms];
        newTerms.splice(fullIdx, 0, newTerm);
        setPaymentTerms(newTerms);
    };

    const removePaymentTerm = (id: string) => {
        if (paymentTerms.length <= 2) return;
        setPaymentTerms(prev => prev.filter(t => t.id !== id));
    };

    const fillRemaining = () => {
        if (remaining <= 0) return;
        setPaymentTerms(prev => prev.map(t =>
            t.id === 'full' ? { ...t, amount: t.amount + remaining } : t
        ));
    };

    // === SAVE MUTATION ===
    const mutation = useMutation({
        mutationFn: async (data: any) => {
            const res = await fetch('/api/invoices', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (!res.ok) throw new Error('Failed to save invoice');
            return res.json();
        },
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            navigate({ to: '/invoices/$invoiceId', params: { invoiceId: String(data.id) } });
        }
    });

    const handleSubmit = async () => {
        if (!clientName || !venue || grandTotal === 0) return;

        mutation.mutate({
            clientName,
            invoiceNo,
            venue,
            weddingDate,
            clientPhone,
            eventTitle,
            items: cartItems,
            paymentTerms,
            cashback,
            totalAmount: grandTotal
        });
    };

    // === VALIDATION ===
    const missingFields: string[] = [];
    if (!invoiceNo) missingFields.push('Invoice No');
    if (!clientName) missingFields.push('Client Name');
    if (!venue) missingFields.push('Venue');

    if (isLoading) return <div className="flex items-center justify-center h-screen bg-[var(--bg-deep)]"><Loader2 className="animate-spin text-[var(--accent)]" /></div>;

    return (
        <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-[var(--bg-deep)] text-[var(--text-primary)]">
            {/* === LEFT SIDEBAR: Packages === */}
            <aside className="w-full md:w-80 flex-shrink-0 bg-[var(--bg-card)] border-b md:border-b-0 md:border-r border-[var(--border)] p-6 overflow-y-auto flex flex-col h-auto max-h-[35vh] md:h-full md:max-h-full">
                <div className="flex items-center gap-2 mb-6 sticky top-0 bg-[var(--bg-card)] z-10 py-2 -my-2">
                    <Package size={20} className="text-[var(--accent)]" />
                    <h3 className="font-semibold text-[var(--text-primary)] tracking-wide" style={{ fontFamily: 'var(--font-display)' }}>Select Packages</h3>
                </div>

                {/* Search */}
                <div className="relative mb-6">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                    <input
                        type="text"
                        placeholder="Search packages..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2 text-xs focus:border-[var(--accent)] outline-none transition-colors text-[var(--text-primary)]"
                    />
                </div>

                {/* Categories */}
                <div className="flex-1 space-y-8">
                    {CATEGORIES.map(category => {
                        const items = groupedPackages[category] || [];
                        if (items.length === 0) return null;

                        const page = categoryPages[category] || 0;
                        const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
                        const displayItems = items.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

                        return (
                            <div key={category}>
                                <div className="flex items-center justify-between mb-3 border-b border-[var(--border)] pb-2">
                                    <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">{category === 'Utama' ? 'Main' : category}</span>
                                    <span className="text-[10px] text-[var(--text-muted)] font-mono">{items.length} Items</span>
                                </div>

                                <div className="space-y-3">
                                    {displayItems.map(pkg => {
                                        const isInCart = cartRowIds.has(String(pkg.id));
                                        return (
                                            <div
                                                key={pkg.id}
                                                className={clsx(
                                                    "p-3 rounded-lg border cursor-pointer transition-all group relative",
                                                    isInCart
                                                        ? "border-[var(--accent)]/50 bg-[var(--accent)]/10"
                                                        : "border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--text-muted)]"
                                                )}
                                                onClick={() => isInCart ? removeFromCart(String(pkg.id)) : addToCart(pkg)}
                                            >
                                                <div className="flex justify-between items-start gap-2">
                                                    <div className={clsx("font-medium text-sm line-clamp-1 transition-colors", isInCart ? "text-[var(--accent)]" : "text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]")}>{pkg.name}</div>
                                                    {isInCart && <div className="bg-[var(--accent)] text-[var(--bg-deep)] p-0.5 rounded-full"><Plus size={10} className="rotate-45" /></div>}
                                                </div>
                                                <div className="text-[var(--text-muted)] font-mono text-xs mt-1 group-hover:text-[var(--text-secondary)]">{rupiah(pkg.price)}</div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Pagination */}
                                {totalPages > 1 && (
                                    <div className="flex items-center justify-center gap-4 mt-3">
                                        <button
                                            onClick={() => setCategoryPages(p => ({ ...p, [category]: Math.max(0, page - 1) }))}
                                            disabled={page === 0}
                                            className="p-1 text-[var(--text-muted)] hover:text-[var(--accent)] disabled:opacity-30 transition-colors"
                                        >
                                            <ChevronLeft size={14} />
                                        </button>
                                        <span className="text-[10px] text-[var(--text-muted)] font-mono">{page + 1} / {totalPages}</span>
                                        <button
                                            onClick={() => setCategoryPages(p => ({ ...p, [category]: Math.min(totalPages - 1, page + 1) }))}
                                            disabled={page >= totalPages - 1}
                                            className="p-1 text-[var(--text-muted)] hover:text-[var(--accent)] disabled:opacity-30 transition-colors"
                                        >
                                            <ChevronRight size={14} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </aside>

            {/* === MAIN CONTENT === */}
            <main className="flex-1 overflow-y-auto p-6 md:p-10 bg-[var(--bg-deep)]">
                <div className="max-w-5xl mx-auto space-y-8">
                    {/* Header */}
                    <div>
                        <h1 className="text-3xl text-[var(--text-primary)] mb-2" style={{ fontFamily: 'var(--font-display)' }}>Create Invoice</h1>
                        <p className="text-[var(--text-muted)] text-sm">Create a new transaction for wedding or event.</p>
                    </div>

                    {/* === EVENT DETAILS FORM === */}
                    <section className="bg-[var(--bg-card)] p-6 rounded-xl border border-[var(--border)]">
                        <div className="flex items-center gap-2 mb-6 border-b border-[var(--border)] pb-4">
                            <FileText size={18} className="text-[var(--accent)]" />
                            <h2 className="text-[var(--text-primary)] font-medium tracking-wide">Event Details</h2>
                        </div>

                        {/* Row 1 */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                            <div className="space-y-1.5">
                                <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Invoice No</label>
                                <input
                                    type="text"
                                    value={invoiceNo}
                                    onChange={(e) => setInvoiceNo(e.target.value)}
                                    className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none transition-colors"
                                    placeholder="INV/..."
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Wedding Date</label>
                                <div className="relative">
                                    <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                                    <input
                                        type="date"
                                        value={weddingDate}
                                        onChange={(e) => setWeddingDate(e.target.value)}
                                        className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none transition-colors [color-scheme:dark]"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider">Venue</label>
                                <div className="relative">
                                    <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                                    <input
                                        type="text"
                                        value={venue}
                                        onChange={(e) => setVenue(e.target.value)}
                                        className="w-full bg-[#1a1a1a] border border-neutral-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white focus:border-[#c4a35a] outline-none transition-colors"
                                        placeholder="e.g. Grand Ballroom"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Row 2 */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="space-y-1.5">
                                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider">Client Name</label>
                                <div className="relative">
                                    <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                                    <input
                                        type="text"
                                        value={clientName}
                                        onChange={(e) => setClientName(e.target.value)}
                                        className="w-full bg-[#1a1a1a] border border-neutral-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white focus:border-[#c4a35a] outline-none transition-colors"
                                        placeholder="e.g. Romeo & Juliet"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider">WhatsApp</label>
                                <div className="relative">
                                    <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                                    <input
                                        type="tel"
                                        value={clientPhone}
                                        onChange={(e) => setClientPhone(e.target.value.replace(/[^0-9]/g, ''))}
                                        className="w-full bg-[#1a1a1a] border border-neutral-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-white focus:border-[#c4a35a] outline-none transition-colors"
                                        placeholder="081..."
                                    />
                                </div>
                            </div>
                            <div className="space-y-1.5">
                                <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Event Title</label>
                                <input
                                    type="text"
                                    value={eventTitle}
                                    onChange={(e) => setEventTitle(e.target.value)}
                                    className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none transition-colors"
                                    placeholder="e.g. Wedding Reception"
                                />
                            </div>
                        </div>
                    </section>

                    {/* === BILL ITEMS === */}
                    <section className="bg-[var(--bg-card)] p-6 rounded-xl border border-[var(--border)]">
                        <div className="flex items-center gap-2 mb-6 border-b border-[var(--border)] pb-4">
                            <ShoppingCart size={18} className="text-[var(--accent)]" />
                            <h2 className="text-[var(--text-primary)] font-medium tracking-wide">Bill Items</h2>
                        </div>

                        {cartItems.length === 0 ? (
                            <div className="text-center py-12 border border-dashed border-[var(--border)] rounded-lg bg-[var(--bg-elevated)]/50">
                                <div className="w-12 h-12 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center mx-auto mb-3 text-[var(--text-muted)]">
                                    <ShoppingCart size={20} />
                                </div>
                                <p className="text-[var(--text-muted)] text-sm">Your cart is empty.</p>
                                <p className="text-[var(--text-muted)] text-xs mt-1">Select packages from the sidebar to add items.</p>
                            </div>
                        ) : (
                            <>
                                {/* Header */}
                                <div className="grid grid-cols-12 gap-4 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider pb-3 border-b border-[var(--border)] mb-2">
                                    <div className="col-span-5">Description</div>
                                    <div className="col-span-3 text-right">Price</div>
                                    <div className="col-span-2 text-center">Qty</div>
                                    <div className="col-span-2 text-right">Action</div>
                                </div>

                                {/* Items */}
                                <div className="space-y-2">
                                    {cartItems.map(item => (
                                        <div key={item.id} className="grid grid-cols-12 gap-4 py-3 border-b border-[var(--border)]/50 items-center hover:bg-[var(--bg-elevated)] -mx-2 px-2 rounded transition-colors group">
                                            <div className="col-span-5">
                                                <input
                                                    type="text"
                                                    value={item.desc}
                                                    onChange={(e) => updateCartItem(item.id, 'desc', e.target.value)}
                                                    className="w-full bg-transparent border-none p-0 text-sm text-[var(--text-primary)] focus:ring-0 placeholder-[var(--text-muted)]"
                                                />
                                            </div>
                                            <div className="col-span-3">
                                                <input
                                                    type="number"
                                                    value={item.price}
                                                    onChange={(e) => updateCartItem(item.id, 'price', Number(e.target.value))}
                                                    className="w-full bg-transparent border-none p-0 text-sm text-[var(--text-secondary)] text-right focus:ring-0 font-mono"
                                                />
                                            </div>
                                            <div className="col-span-2">
                                                <input
                                                    type="number"
                                                    value={item.qty}
                                                    min={1}
                                                    onChange={(e) => updateCartItem(item.id, 'qty', Math.max(1, Number(e.target.value)))}
                                                    className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-1 py-1 text-xs text-center text-[var(--text-primary)] focus:border-[var(--accent)] outline-none"
                                                />
                                            </div>
                                            <div className="col-span-2 text-right">
                                                <button
                                                    onClick={() => deleteCartItem(item.id)}
                                                    className="text-[var(--text-muted)] hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-all"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Totals */}
                                <div className="mt-8 pt-6 border-t border-[var(--border)] flex justify-end">
                                    <div className="w-full md:w-72 space-y-3">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-[var(--text-muted)]">Subtotal</span>
                                            <span className="font-mono text-[var(--text-secondary)]">{rupiah(subtotal)}</span>
                                        </div>
                                        <div className="flex justify-between text-sm items-center">
                                            <span className="text-[var(--text-muted)]">Cashback</span>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[var(--text-muted)] text-xs">-</span>
                                                <input
                                                    type="number"
                                                    value={cashback}
                                                    onChange={(e) => setCashback(Math.max(0, Number(e.target.value)))}
                                                    className="w-32 bg-[var(--bg-elevated)] border border-[var(--border)] rounded px-2 py-1 text-sm text-right text-[var(--accent)] focus:border-[var(--accent)] outline-none font-mono"
                                                />
                                            </div>
                                        </div>
                                        <div className="flex justify-between text-lg pt-4 border-t border-[var(--border)]">
                                            <span className="text-[var(--text-primary)] font-medium" style={{ fontFamily: 'var(--font-display)' }}>Grand Total</span>
                                            <span className="text-[var(--accent)] font-light tracking-wide">{rupiah(grandTotal)}</span>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </section>

                    {/* === PAYMENT MANAGER === */}
                    <section className="bg-[var(--bg-card)] p-6 rounded-xl border border-[var(--border)]">
                        <div className="flex items-center justify-between gap-2 mb-6 border-b border-[var(--border)] pb-4">
                            <div className="flex items-center gap-2">
                                <CreditCard size={18} className="text-[var(--accent)]" />
                                <h2 className="text-[var(--text-primary)] font-medium tracking-wide">Payment Terms</h2>
                            </div>
                            <div className={clsx(
                                "text-[10px] uppercase font-bold px-2 py-1 rounded border",
                                remaining === 0 ? "bg-green-900/20 text-green-500 border-green-900/30" :
                                    remaining > 0 ? "bg-orange-900/20 text-orange-500 border-orange-900/30" :
                                        "bg-red-900/20 text-red-500 border-red-900/30"
                            )}>
                                {remaining === 0 ? 'Balanced' : remaining > 0 ? `Unallocated: ${rupiah(remaining)}` : `Over: ${rupiah(Math.abs(remaining))}`}
                            </div>
                        </div>

                        <div className="space-y-3">
                            {paymentTerms.map((term) => (
                                <div key={term.id} className="grid grid-cols-12 gap-3 items-center">
                                    <div className="col-span-5">
                                        <input
                                            type="text"
                                            value={term.label}
                                            onChange={(e) => updatePaymentTerm(term.id, 'label', e.target.value)}
                                            disabled={term.locked}
                                            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                                        />
                                    </div>
                                    <div className="col-span-5">
                                        <input
                                            type="number"
                                            value={term.amount}
                                            onChange={(e) => updatePaymentTerm(term.id, 'amount', e.target.value)}
                                            step={1000000}
                                            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-right text-[var(--text-primary)] focus:border-[var(--accent)] outline-none font-mono"
                                        />
                                    </div>
                                    <div className="col-span-2 flex justify-center">
                                        {term.locked ? (
                                            <span className="text-neutral-700 text-xs">🔒</span>
                                        ) : (
                                            <button
                                                onClick={() => removePaymentTerm(term.id)}
                                                className="text-neutral-600 hover:text-red-500 transition-colors"
                                            >
                                                <X size={16} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="flex gap-4 mt-6">
                            <button
                                onClick={addPaymentTerm}
                                disabled={paymentTerms.length >= 6}
                                className="flex-1 text-xs uppercase tracking-wider font-bold px-4 py-3 border border-[var(--border)] text-[var(--text-muted)] rounded-lg hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] hover:border-[var(--text-muted)] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                + Add Term
                            </button>
                            <button
                                onClick={fillRemaining}
                                disabled={remaining <= 0}
                                className="flex-1 text-xs uppercase tracking-wider font-bold px-4 py-3 border border-[var(--accent)]/30 text-[var(--accent)] rounded-lg hover:bg-[var(--accent)]/10 hover:border-[var(--accent)]/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                Fill Remaining → Pelunasan
                            </button>
                        </div>
                    </section>

                    <div className="h-10"></div> {/* Spacer */}

                    {/* === ACTION BUTTONS === */}
                    <div className="sticky bottom-6 z-10">
                        {missingFields.length > 0 && (
                            <div className="bg-red-900/80 backdrop-blur border border-red-500/30 text-red-200 px-4 py-3 rounded-lg mb-4 text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2">
                                ⚠️ Please fill in: <strong className="text-white">{missingFields.join(', ')}</strong>
                            </div>
                        )}

                        <button
                            onClick={handleSubmit}
                            disabled={missingFields.length > 0 || grandTotal === 0 || mutation.isPending}
                            className="w-full flex items-center justify-center gap-3 bg-[var(--accent)] text-[var(--bg-deep)] px-6 py-4 rounded-xl hover:opacity-90 font-bold text-sm tracking-widest uppercase transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(196,163,90,0.3)] hover:shadow-[0_0_30px_rgba(196,163,90,0.5)] transform hover:-translate-y-1"
                        >
                            {mutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                            {mutation.isPending ? 'Saving Invoice...' : 'Generate & Save Invoice'}
                        </button>
                    </div>
                </div>
            </main>
        </div>
    );
}
