import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus, Trash2, Save, ShoppingCart, User, Loader2, Calendar, MapPin, Phone, FileText, CreditCard, Package, ChevronLeft, ChevronRight, Search } from 'lucide-react';
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

    // === BUNDLE SELECTION ===
    const [selectedForBundle, setSelectedForBundle] = useState<Set<string>>(new Set());

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
        setSelectedForBundle(prev => {
            const next = new Set(prev);
            next.delete(rowId);
            return next;
        });
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

    if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-primary-600" /></div>;

    return (
        <div className="flex gap-6 h-full">
            {/* === LEFT SIDEBAR: Packages === */}
            <aside className="w-72 flex-shrink-0 bg-white border-r border-surface-200 p-4 overflow-y-auto">
                <div className="flex items-center gap-2 mb-4">
                    <Package size={18} className="text-primary-600" />
                    <h3 className="font-semibold text-surface-900">Select Packages</h3>
                </div>

                {/* Search */}
                <div className="relative mb-4">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                    <input
                        type="text"
                        placeholder="Search packages..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-primary-500 outline-none"
                    />
                </div>

                {/* Categories */}
                {CATEGORIES.map(category => {
                    const items = groupedPackages[category] || [];
                    if (items.length === 0) return null;

                    const page = categoryPages[category] || 0;
                    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
                    const displayItems = items.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

                    return (
                        <div key={category} className="mb-6">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-surface-500 uppercase tracking-wide">{category}</span>
                                <span className="text-xs text-surface-400">{items.length}</span>
                            </div>

                            <div className="space-y-2">
                                {displayItems.map(pkg => {
                                    const isInCart = cartRowIds.has(String(pkg.id));
                                    return (
                                        <div
                                            key={pkg.id}
                                            className={clsx(
                                                "p-3 rounded-lg border cursor-pointer transition-all",
                                                isInCart
                                                    ? "border-primary-500 bg-primary-50"
                                                    : "border-surface-200 hover:border-primary-300"
                                            )}
                                            onClick={() => isInCart ? removeFromCart(String(pkg.id)) : addToCart(pkg)}
                                        >
                                            <div className="flex justify-between items-start">
                                                <div className="font-medium text-sm text-surface-900 line-clamp-1">{pkg.name}</div>
                                                {isInCart && <span className="text-xs bg-primary-600 text-white px-1.5 py-0.5 rounded">✓</span>}
                                            </div>
                                            <div className="text-primary-700 font-bold text-sm mt-1">{rupiah(pkg.price)}</div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Pagination */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-between mt-2">
                                    <button
                                        onClick={() => setCategoryPages(p => ({ ...p, [category]: Math.max(0, page - 1) }))}
                                        disabled={page === 0}
                                        className="p-1 text-surface-400 hover:text-surface-600 disabled:opacity-30"
                                    >
                                        <ChevronLeft size={16} />
                                    </button>
                                    <span className="text-xs text-surface-400">{page + 1} / {totalPages}</span>
                                    <button
                                        onClick={() => setCategoryPages(p => ({ ...p, [category]: Math.min(totalPages - 1, page + 1) }))}
                                        disabled={page >= totalPages - 1}
                                        className="p-1 text-surface-400 hover:text-surface-600 disabled:opacity-30"
                                    >
                                        <ChevronRight size={16} />
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </aside>

            {/* === MAIN CONTENT === */}
            <main className="flex-1 overflow-y-auto p-6">
                <div className="max-w-4xl mx-auto">
                    {/* Header */}
                    <div className="mb-6">
                        <h1 className="text-2xl font-bold text-surface-900">Create Invoice</h1>
                        <p className="text-surface-500 text-sm mt-1">Create a new transaction for wedding or event.</p>
                    </div>

                    {/* === EVENT DETAILS FORM === */}
                    <div className="bg-white p-6 rounded-xl border border-surface-200 shadow-sm mb-6">
                        <div className="flex items-center gap-2 mb-4 text-surface-900 font-semibold">
                            <FileText size={18} className="text-primary-600" />
                            Event Details
                        </div>

                        {/* Row 1 */}
                        <div className="grid grid-cols-3 gap-4 mb-4">
                            <div>
                                <label className="block text-xs font-medium text-surface-500 mb-1">Invoice No</label>
                                <input
                                    type="text"
                                    value={invoiceNo}
                                    onChange={(e) => setInvoiceNo(e.target.value)}
                                    className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:border-primary-500 outline-none"
                                    placeholder="INV/2026/001"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-surface-500 mb-1">Wedding Date</label>
                                <div className="relative">
                                    <Calendar size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                                    <input
                                        type="date"
                                        value={weddingDate}
                                        onChange={(e) => setWeddingDate(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2 border border-surface-300 rounded-lg text-sm focus:border-primary-500 outline-none"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-surface-500 mb-1">Venue</label>
                                <div className="relative">
                                    <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                                    <input
                                        type="text"
                                        value={venue}
                                        onChange={(e) => setVenue(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2 border border-surface-300 rounded-lg text-sm focus:border-primary-500 outline-none"
                                        placeholder="e.g. Grand Ballroom Hotel Mulia"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Row 2 */}
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs font-medium text-surface-500 mb-1">Client Name</label>
                                <div className="relative">
                                    <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                                    <input
                                        type="text"
                                        value={clientName}
                                        onChange={(e) => setClientName(e.target.value)}
                                        className="w-full pl-9 pr-3 py-2 border border-surface-300 rounded-lg text-sm focus:border-primary-500 outline-none"
                                        placeholder="e.g. Romeo & Juliet"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-surface-500 mb-1">Client WhatsApp</label>
                                <div className="relative">
                                    <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                                    <input
                                        type="tel"
                                        value={clientPhone}
                                        onChange={(e) => setClientPhone(e.target.value.replace(/[^0-9]/g, ''))}
                                        className="w-full pl-9 pr-3 py-2 border border-surface-300 rounded-lg text-sm focus:border-primary-500 outline-none"
                                        placeholder="08123456789"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-surface-500 mb-1">Event Title</label>
                                <input
                                    type="text"
                                    value={eventTitle}
                                    onChange={(e) => setEventTitle(e.target.value)}
                                    className="w-full px-3 py-2 border border-surface-300 rounded-lg text-sm focus:border-primary-500 outline-none"
                                    placeholder="e.g. Wedding Reception 2026"
                                />
                            </div>
                        </div>
                    </div>

                    {/* === BILL ITEMS === */}
                    <div className="bg-white p-6 rounded-xl border border-surface-200 shadow-sm mb-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2 text-surface-900 font-semibold">
                                <ShoppingCart size={18} className="text-primary-600" />
                                Bill Items
                            </div>
                        </div>

                        {cartItems.length === 0 ? (
                            <div className="text-center text-surface-400 text-sm py-8 bg-surface-50 rounded-lg border border-dashed border-surface-200">
                                <ShoppingCart size={32} className="mx-auto mb-2 opacity-30" />
                                Select packages from the sidebar to add items
                            </div>
                        ) : (
                            <>
                                {/* Header */}
                                <div className="grid grid-cols-12 gap-4 text-xs font-medium text-surface-500 pb-2 border-b border-surface-100 mb-2">
                                    <div className="col-span-5">Description</div>
                                    <div className="col-span-3 text-right">Price</div>
                                    <div className="col-span-2 text-center">Qty</div>
                                    <div className="col-span-2 text-right">Action</div>
                                </div>

                                {/* Items */}
                                {cartItems.map(item => (
                                    <div key={item.id} className="grid grid-cols-12 gap-4 py-3 border-b border-surface-100 items-center">
                                        <div className="col-span-5">
                                            <input
                                                type="text"
                                                value={item.desc}
                                                onChange={(e) => updateCartItem(item.id, 'desc', e.target.value)}
                                                className="w-full px-2 py-1 border border-surface-200 rounded text-sm focus:border-primary-500 outline-none"
                                            />
                                        </div>
                                        <div className="col-span-3">
                                            <input
                                                type="number"
                                                value={item.price}
                                                onChange={(e) => updateCartItem(item.id, 'price', Number(e.target.value))}
                                                className="w-full px-2 py-1 border border-surface-200 rounded text-sm text-right focus:border-primary-500 outline-none"
                                            />
                                        </div>
                                        <div className="col-span-2">
                                            <input
                                                type="number"
                                                value={item.qty}
                                                min={1}
                                                onChange={(e) => updateCartItem(item.id, 'qty', Math.max(1, Number(e.target.value)))}
                                                className="w-full px-2 py-1 border border-surface-200 rounded text-sm text-center focus:border-primary-500 outline-none"
                                            />
                                        </div>
                                        <div className="col-span-2 text-right">
                                            <button
                                                onClick={() => deleteCartItem(item.id)}
                                                className="text-red-400 hover:text-red-600 p-1"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                ))}

                                {/* Totals */}
                                <div className="mt-4 flex justify-end">
                                    <div className="w-64 space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-surface-600">Subtotal</span>
                                            <span className="font-medium">{rupiah(subtotal)}</span>
                                        </div>
                                        <div className="flex justify-between text-sm items-center">
                                            <span className="text-surface-600">Cashback</span>
                                            <input
                                                type="number"
                                                value={cashback}
                                                onChange={(e) => setCashback(Math.max(0, Number(e.target.value)))}
                                                className="w-32 px-2 py-1 border border-surface-200 rounded text-sm text-right focus:border-primary-500 outline-none"
                                            />
                                        </div>
                                        <div className="flex justify-between text-base font-bold pt-2 border-t border-surface-200">
                                            <span className="text-surface-800">Grand Total</span>
                                            <span className="text-primary-600">{rupiah(grandTotal)}</span>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* === PAYMENT MANAGER === */}
                    <div className="bg-white p-6 rounded-xl border border-surface-200 shadow-sm mb-6">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2 text-surface-900 font-semibold">
                                <CreditCard size={18} className="text-primary-600" />
                                Payment Manager
                            </div>
                            <div className={clsx(
                                "text-xs px-2 py-1 rounded-full font-medium",
                                remaining === 0 ? "bg-green-100 text-green-700" :
                                    remaining > 0 ? "bg-orange-100 text-orange-700" :
                                        "bg-red-100 text-red-700"
                            )}>
                                {remaining === 0 ? 'Balanced' : remaining > 0 ? `Unallocated: ${rupiah(remaining)}` : `Over: ${rupiah(Math.abs(remaining))}`}
                            </div>
                        </div>

                        <div className="space-y-3">
                            {paymentTerms.map((term, idx) => (
                                <div key={term.id} className="grid grid-cols-12 gap-3 items-center">
                                    <div className="col-span-5">
                                        <input
                                            type="text"
                                            value={term.label}
                                            onChange={(e) => updatePaymentTerm(term.id, 'label', e.target.value)}
                                            disabled={term.locked}
                                            className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm focus:border-primary-500 outline-none disabled:bg-surface-50 disabled:text-surface-500"
                                        />
                                    </div>
                                    <div className="col-span-5">
                                        <input
                                            type="number"
                                            value={term.amount}
                                            onChange={(e) => updatePaymentTerm(term.id, 'amount', e.target.value)}
                                            step={1000000}
                                            className="w-full px-3 py-2 border border-surface-200 rounded-lg text-sm text-right focus:border-primary-500 outline-none"
                                        />
                                    </div>
                                    <div className="col-span-2 flex justify-center">
                                        {term.locked ? (
                                            <span className="text-surface-400">🔒</span>
                                        ) : (
                                            <button
                                                onClick={() => removePaymentTerm(term.id)}
                                                className="text-red-400 hover:text-red-600"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="flex gap-3 mt-4">
                            <button
                                onClick={addPaymentTerm}
                                disabled={paymentTerms.length >= 6}
                                className="flex-1 text-sm px-3 py-2 border border-primary-200 text-primary-600 rounded-lg hover:bg-primary-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                + Add Payment Term
                            </button>
                            <button
                                onClick={fillRemaining}
                                disabled={remaining <= 0}
                                className="flex-1 text-sm px-3 py-2 border border-surface-200 text-surface-600 rounded-lg hover:bg-surface-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Fill Remaining → Pelunasan
                            </button>
                        </div>
                    </div>

                    {/* === ACTION BUTTONS === */}
                    {missingFields.length > 0 && (
                        <div className="bg-orange-50 border border-orange-200 text-orange-700 px-4 py-3 rounded-lg mb-4 text-sm">
                            ⚠️ Please fill in: <strong>{missingFields.join(', ')}</strong>
                        </div>
                    )}

                    <button
                        onClick={handleSubmit}
                        disabled={missingFields.length > 0 || grandTotal === 0 || mutation.isPending}
                        className="w-full flex items-center justify-center gap-2 bg-primary-600 text-white px-4 py-4 rounded-xl hover:bg-primary-700 font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary-600/20"
                    >
                        {mutation.isPending ? <Loader2 size={20} className="animate-spin" /> : <Save size={20} />}
                        {mutation.isPending ? 'Saving Invoice...' : 'Generate & Save Invoice'}
                    </button>
                </div>
            </main>
        </div>
    );
}
