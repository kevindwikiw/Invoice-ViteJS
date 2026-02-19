import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Plus, Trash2, Save, ShoppingCart, User, Loader2, Calendar, MapPin, Phone, FileText, CreditCard, Package, ChevronLeft, ChevronRight, Search, X, Info, AlertCircle, Upload, Image as ImageIcon, Eye } from 'lucide-react';
import clsx from 'clsx';
import { compressImage } from '../utils/image';

// Types
interface InvoiceItem {
    id: string;
    name?: string; // New: Explicit Name
    desc: string;
    details?: string; // New: Details/Description from Package
    price: number;
    qty: number;
    isBundle?: boolean;
    _rowId?: string;
    _bundleSrc?: InvoiceItem[];
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
const rupiah = (n: number) => `Rp ${n.toLocaleString('id-ID')} `;

// Use fetchWithAuth for auto-refresh support
import { fetchWithAuth } from '../context/auth';
import { useToast } from '../context/ToastContext';
import { TimeRangePicker } from '../components/TimeRangePicker';

export default function CreateInvoice() {
    const { addToast } = useToast();
    const { editId } = useSearch({ from: '/_layout/create' });
    const isEditMode = !!editId;

    // === FORM STATE ===
    const [invoiceNo, setInvoiceNo] = useState('');
    const [seqPrefix, setSeqPrefix] = useState('INV');
    const [seqNext, setSeqNext] = useState<number | null>(null);
    const [seqPadding, setSeqPadding] = useState(5);
    const [isManualInvoice, setIsManualInvoice] = useState(false);
    const [showSeqModal, setShowSeqModal] = useState(false);
    const [configLastValue, setConfigLastValue] = useState(0);

    // === MERGE STATE ===
    const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
    const [showMergeModal, setShowMergeModal] = useState(false);
    const [mergeTitle, setMergeTitle] = useState('');
    const [mergePriceMode, setMergePriceMode] = useState<'sum' | 'custom'>('sum');

    // === CONFIRM SAVE STATE ===
    const [showSaveConfirm, setShowSaveConfirm] = useState(false);
    const [mergeCustomPrice, setMergeCustomPrice] = useState(0);

    const [weddingDate, setWeddingDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [venue, setVenue] = useState('');
    const [clientName, setClientName] = useState('');
    const [clientPhone, setClientPhone] = useState('');
    const [eventTitle, setEventTitle] = useState('');
    const [hours, setHours] = useState(''); // New State

    // === CONFIG STATE ===
    const [showConfig, setShowConfig] = useState(false);
    const [activeTab, setActiveTab] = useState('Bank');

    // Default values if API fails or first load
    const [bankName, setBankName] = useState('BCA');
    const [bankAcc, setBankAcc] = useState('1234567890');
    const [bankHolder, setBankHolder] = useState('THE ORBIT PHOTOGRAPHY');
    const [terms, setTerms] = useState('Booking fee is non-refundable.\nFull payment is required before event.\nEdit process takes 2-4 weeks.');
    const [footerAddress, setFooterAddress] = useState('Jl. Panembakan Gg Sukamaju 15 No. 3, Kota Cimahi');
    const [footerEmail, setFooterEmail] = useState('theorbitphoto@gmail.com');
    const [footerIG, setFooterIG] = useState('@theorbitphoto');
    const [footerPhone, setFooterPhone] = useState('0813-2333-1506');
    const [waTemplate, setWaTemplate] = useState('Halo kak {clientName}, berikut invoice untuk {eventTitle} yaa..');

    // Fetch Config from API
    const { data: configData } = useQuery({
        queryKey: ['config'],
        queryFn: async () => {
            const res = await fetchWithAuth('/config');
            if (!res.ok) throw new Error('Failed to fetch config');
            return res.json();
        }
    });

    // Update state when config loads
    useEffect(() => {
        if (configData) {
            if (configData.inv_bankName) setBankName(configData.inv_bankName);
            if (configData.inv_bankAcc) setBankAcc(configData.inv_bankAcc);
            if (configData.inv_bankHolder) setBankHolder(configData.inv_bankHolder);
            if (configData.inv_terms) setTerms(configData.inv_terms);
            if (configData.inv_footerAddress) setFooterAddress(configData.inv_footerAddress);
            if (configData.inv_footerEmail) setFooterEmail(configData.inv_footerEmail);
            if (configData.inv_footerIG) setFooterIG(configData.inv_footerIG);
            if (configData.inv_footerPhone) setFooterPhone(configData.inv_footerPhone);
            if (configData.inv_waTemplate) setWaTemplate(configData.inv_waTemplate);
        }
    }, [configData]);

    // Save Config Mutation
    const configMutation = useMutation({
        mutationFn: async (data: any) => {
            const res = await fetchWithAuth('/config', {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            if (!res.ok) throw new Error('Failed to save config');
            return res.json();
        },
        onSuccess: () => {
            addToast("Configuration saved as default!", 'success');
            queryClient.invalidateQueries({ queryKey: ['config'] });
        },
        onError: (err) => {
            addToast("Failed to save config: " + err, 'error');
        }
    });

    const handleSaveConfig = () => {
        setShowSaveConfirm(true);
    };

    const confirmSaveConfig = () => {
        setShowSaveConfirm(false);
        configMutation.mutate({
            inv_bankName: bankName,
            inv_bankAcc: bankAcc,
            inv_bankHolder: bankHolder,
            inv_terms: terms,
            inv_footerAddress: footerAddress,
            inv_footerEmail: footerEmail,
            inv_footerIG: footerIG,
            inv_footerPhone: footerPhone,
            inv_waTemplate: waTemplate
        });
    };

    // === CART STATE ===
    const [cartItems, setCartItems] = useState<InvoiceItem[]>([]);
    const [cashback, setCashback] = useState(0);

    // === PAYMENT STATE ===
    const [paymentTerms, setPaymentTerms] = useState<PaymentTerm[]>([
        { id: 'dp', label: 'Down Payment', amount: 0, locked: true },
        { id: 'full', label: 'Pelunasan', amount: 0, locked: true }
    ]);

    // State for Payment Proof
    const [paymentProofs, setPaymentProofs] = useState<File[]>([]);
    const [existingProofUrls, setExistingProofUrls] = useState<string[]>([]); // from DB when editing
    const [editDataLoaded, setEditDataLoaded] = useState(false);

    // === SIDEBAR STATE ===
    const [searchQuery, setSearchQuery] = useState('');
    const [categoryPages, setCategoryPages] = useState<Record<string, number>>({ Utama: 0, Bonus: 0 });
    const [showMobilePackages, setShowMobilePackages] = useState(false);


    // Fetch Packages & Sequence
    const { data: packagesData = [], isLoading: isLoadingPackages } = useQuery<PackageData[]>({
        queryKey: ['packages'],
        queryFn: async () => {
            const res = await fetchWithAuth('/packages');
            if (!res.ok) throw new Error('Failed to fetch packages');
            return res.json();
        }
    });
    const packages = Array.isArray(packagesData) ? packagesData : [];

    // Fetch Sequence
    const seqQuery = useQuery({
        queryKey: ['sequence'],
        queryFn: async () => {
            const res = await fetchWithAuth('/sequences/invoice');
            if (!res.ok) return null;
            const data = await res.json();
            setSeqPrefix(data.prefix);
            setSeqNext(data.next_value);
            setSeqPadding(data.padding);
            setConfigLastValue(data.last_value);
            return data;
        },
        refetchOnWindowFocus: false
    });

    // Update Sequence Mutation
    const updateSeqMutation = useMutation({
        mutationFn: async (lastValue: number) => {
            const res = await fetchWithAuth('/sequences/invoice', {
                method: 'PUT',
                body: JSON.stringify({ last_value: lastValue })
            });
            if (!res.ok) throw new Error('Failed to update sequence');
            return res.json();
        },
        onSuccess: () => {
            seqQuery.refetch();
            setShowSeqModal(false);
        }
    });

    // Auto-update Invoice No unless manual
    // Auto-update Invoice No unless manual
    useEffect(() => {
        if (!isManualInvoice && seqNext !== null) {
            const padded = String(seqNext).padStart(seqPadding, "0");
            const cleanClient = clientName.trim().replace(/\s+/g, " ");
            const suffix = cleanClient ? `_${cleanClient} ` : "";

            setInvoiceNo(`${seqPrefix}${padded}${suffix}`);
        }
    }, [seqNext, seqPadding, seqPrefix, clientName, isManualInvoice]);

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
            id: `item_${Date.now()} `,
            name: pkg.name,
            desc: pkg.name,
            details: pkg.description,
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
        setSelectedRowIds(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
        });
    };

    // === MERGE ACTIONS ===
    const toggleSelection = (id: string) => {
        setSelectedRowIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleMerge = () => {
        const selectedItems = cartItems.filter(i => selectedRowIds.has(i.id));
        if (selectedItems.length < 2) return;

        // Calculate Price
        let price = 0;
        if (mergePriceMode === 'sum') {
            price = selectedItems.reduce((sum, item) => sum + (item.price * item.qty), 0);
        } else {
            price = mergeCustomPrice;
        }

        // Create Title
        const title = mergeTitle || `Bundling: ${selectedItems.map(i => i.desc).slice(0, 3).join(' + ')}${selectedItems.length > 3 ? '...' : ''} `;

        const newItem: InvoiceItem = {
            id: `bundle_${Date.now()} `,
            desc: title,
            price: price,
            qty: 1,
            isBundle: true,
            _bundleSrc: selectedItems,
            _rowId: `bundle_${Date.now()} `
        };

        // Update Cart: Remove selected, add bundle
        setCartItems(prev => [
            ...prev.filter(i => !selectedRowIds.has(i.id)),
            newItem
        ]);

        // Reset
        setSelectedRowIds(new Set());
        setShowMergeModal(false);
        setMergeTitle('');
        setMergePriceMode('sum');
        setMergeCustomPrice(0);
    };

    const handleUnmerge = (id: string) => {
        const bundleItem = cartItems.find(i => i.id === id);
        if (!bundleItem || !bundleItem._bundleSrc) return;

        setCartItems(prev => {
            const temp = prev.filter(i => i.id !== id);
            // Restore items. Ensure they have unique IDs if needed, but original IDs should correspond to logic?
            // Actually, if we re-add them, we should probably keep them as is or give new IDs to avoid conflicts if needed.
            // But _bundleSrc contains the original objects.
            return [...temp, ...bundleItem._bundleSrc!];
        });
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
            id: `term_${Date.now()} `,
            label: `Payment ${paymentTerms.length} `,
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

    // === LOAD EDIT DATA ===
    const { data: editInvoiceData } = useQuery({
        queryKey: ['invoice', editId],
        queryFn: async () => {
            const res = await fetchWithAuth(`/invoices/${editId}`);
            if (!res.ok) throw new Error('Failed to fetch invoice');
            return res.json();
        },
        enabled: isEditMode && !editDataLoaded,
    });

    useEffect(() => {
        if (!editInvoiceData || editDataLoaded) return;

        // Populate form fields from DB
        setInvoiceNo(editInvoiceData.invoiceNo || editInvoiceData.invoice_no || '');
        setClientName(editInvoiceData.clientName || editInvoiceData.client_name || '');
        setIsManualInvoice(true); // Keep the existing invoice number

        // Parse the invoiceData JSON
        try {
            const data = typeof editInvoiceData.invoiceData === 'string'
                ? JSON.parse(editInvoiceData.invoiceData)
                : (editInvoiceData.invoice_data ? JSON.parse(editInvoiceData.invoice_data) : null);

            if (data) {
                if (data.venue) setVenue(data.venue);
                if (data.weddingDate) setWeddingDate(data.weddingDate);
                if (data.clientPhone) setClientPhone(data.clientPhone);
                if (data.eventTitle) setEventTitle(data.eventTitle);
                if (data.hours) setHours(data.hours); // Load Hours
                if (data.cashback !== undefined) setCashback(data.cashback);

                // Items
                if (data.items && Array.isArray(data.items)) {
                    setCartItems(data.items.map((item: any) => ({
                        ...item,
                        _rowId: item._rowId || item.id || String(Math.random()),
                    })));
                }

                // Payment terms
                if (data.paymentTerms && Array.isArray(data.paymentTerms)) {
                    setPaymentTerms(data.paymentTerms);
                }

                // Config
                if (data.bankName) setBankName(data.bankName);
                if (data.bankAcc) setBankAcc(data.bankAcc);
                if (data.bankHolder) setBankHolder(data.bankHolder);
                if (data.terms) setTerms(data.terms);
                if (data.footerAddress) setFooterAddress(data.footerAddress);
                if (data.footerEmail) setFooterEmail(data.footerEmail);
                if (data.footerIG) setFooterIG(data.footerIG);
                if (data.footerPhone) setFooterPhone(data.footerPhone);
                if (data.waTemplate) setWaTemplate(data.waTemplate);
            }
        } catch (e) {
            console.error('Failed to parse invoiceData:', e);
        }

        // Load existing proofs
        try {
            const proofs = editInvoiceData.paymentProofs || editInvoiceData.payment_proofs;
            if (proofs) {
                const parsed = typeof proofs === 'string' ? JSON.parse(proofs) : proofs;
                if (Array.isArray(parsed)) setExistingProofUrls(parsed);
            }
        } catch (e) {
            console.error('Failed to parse proofs:', e);
        }

        setEditDataLoaded(true);
    }, [editInvoiceData, editDataLoaded]);

    // === BUILD INVOICE PAYLOAD ===
    const buildInvoicePayload = () => ({
        clientName,
        invoiceNo,
        venue,
        weddingDate,
        clientPhone,
        eventTitle,
        hours, // Add to payload
        items: cartItems,
        paymentTerms,
        cashback,
        totalAmount: grandTotal,
        bankName,
        bankAcc,
        bankHolder,
        terms,
        footerAddress,
        footerEmail,
        footerIG,
        footerPhone,
        waTemplate
    });

    // === PREVIEW (New Invoice) ===
    const handlePreview = () => {
        if (!clientName || grandTotal === 0) {
            addToast('Please fill in valid Client Name and Items', 'error');
            return;
        }

        // Notify if proofs were selected but will be lost (limitation of session storage)
        if (paymentProofs.length > 0) {
            addToast('Note: Please re-upload proofs in the preview screen', 'info');
        }

        // Build the same shape that InvoiceDetail expects
        const payload = buildInvoicePayload();
        const previewData = {
            invoiceNo: payload.invoiceNo,
            clientName: payload.clientName,
            date: payload.weddingDate || new Date().toISOString().split('T')[0],
            totalAmount: payload.totalAmount,
            invoiceData: JSON.stringify({
                items: payload.items,
                paymentTerms: payload.paymentTerms,
                cashback: payload.cashback,
                venue: payload.venue,
                weddingDate: payload.weddingDate,
                clientPhone: payload.clientPhone,
                eventTitle: payload.eventTitle,
                hours: payload.hours, // Pass to preview
                bankName: payload.bankName,
                bankAcc: payload.bankAcc,
                bankHolder: payload.bankHolder,
                terms: payload.terms,
                footerAddress: payload.footerAddress,
                footerEmail: payload.footerEmail,
                footerIG: payload.footerIG,
                footerPhone: payload.footerPhone,
                waTemplate: payload.waTemplate
            }),
            // Store raw payload for saving later
            _savePayload: payload
        };

        sessionStorage.setItem('invoice_preview', JSON.stringify(previewData));
        navigate({ to: '/invoices/$invoiceId', params: { invoiceId: 'preview' } });
    };

    // === UPDATE MUTATION (Edit Mode Only) ===
    const mutation = useMutation({
        mutationFn: async (data: any) => {
            try {
                const res = await fetchWithAuth(`/invoices/${editId}`, {
                    method: 'PUT',
                    body: JSON.stringify(data)
                });
                if (!res.ok) {
                    const errorData = await res.json();
                    throw new Error(errorData.error || 'Failed to update invoice');
                }
                const savedInvoice = await res.json();
                const invoiceId = savedInvoice.id;

                // Upload NEW Payment Proofs (if any)
                if (paymentProofs.length > 0) {
                    try {
                        const formData = new FormData();
                        for (const f of paymentProofs) {
                            formData.append('file', f);
                        }
                        const uploadRes = await fetchWithAuth(`/invoices/${invoiceId}/proofs`, {
                            method: 'POST',
                            body: formData
                        });
                        if (!uploadRes.ok) {
                            addToast('Invoice updated but proof upload failed', 'error');
                        }
                    } catch (e) {
                        console.error('Proof upload error:', e);
                        addToast('Invoice updated but proof upload failed', 'error');
                    }
                }

                addToast('Invoice updated!', 'success');
                queryClient.invalidateQueries({ queryKey: ['invoices'] });
                queryClient.invalidateQueries({ queryKey: ['analytics'] });
                navigate({ to: '/history' });

                return savedInvoice;
            } catch (e: any) {
                console.error(e);
                addToast(e.message || 'Failed to update invoice', 'error');
                throw e;
            }
        }
    });

    const handleUpdate = async () => {
        if (!clientName || grandTotal === 0) return;
        mutation.mutate(buildInvoicePayload());
    };

    // === VALIDATION ===
    const missingFields: string[] = [];
    // Invoice No is optional if auto-generated, but we send it if manual or pre-filled
    if (!clientName) missingFields.push('Client Name');
    // Venue is now optional
    // if (!venue) missingFields.push('Venue');

    const isLoading = isLoadingPackages;
    if (isLoading) return <div className="flex items-center justify-center h-screen bg-[var(--bg-deep)]"><Loader2 className="animate-spin text-[var(--accent)]" /></div>;

    return (
        <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-[var(--bg-deep)] text-[var(--text-primary)]">
            {/* === LEFT SIDEBAR: Packages === */}
            <aside className={clsx(
                "flex-shrink-0 bg-[var(--bg-card)] border-b md:border-b-0 md:border-r border-[var(--border)] flex flex-col transition-all duration-300 ease-in-out",
                "w-full md:w-80",
                showMobilePackages ? "h-[60vh]" : "h-[70px] overflow-hidden",
                "md:h-full md:max-h-full md:overflow-hidden"
            )}>
                <div
                    className="flex items-center justify-between gap-2 p-6 md:mb-0 cursor-pointer md:cursor-default"
                    onClick={() => setShowMobilePackages(!showMobilePackages)}
                >
                    <div className="flex items-center gap-2">
                        <Package size={20} className="text-[var(--accent)]" />
                        <h3 className="font-semibold text-[var(--text-primary)] tracking-wide" style={{ fontFamily: 'var(--font-display)' }}>Select Packages</h3>
                    </div>
                    <div className="md:hidden text-[var(--text-muted)]">
                        {showMobilePackages ? <ChevronLeft className="-rotate-90" size={20} /> : <ChevronLeft className="rotate-90" size={20} />}
                    </div>
                </div>

                <div className="px-6 pb-6 overflow-y-auto flex-1">

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
                                                    {/* Details / Description: Bullet Points */}
                                                    {/* Details / Description: Scrollable + Clickable */}
                                                    {pkg.description ? (
                                                        <div className="mt-2 space-y-1 max-h-[52px] overflow-y-auto pr-1 custom-scrollbar">
                                                            {pkg.description.split('\n').filter(Boolean).map((line, i) => (
                                                                <div key={i} className="flex items-start gap-1.5">
                                                                    <span className="text-[var(--accent)] text-[8px] mt-[3px] shrink-0">•</span>
                                                                    <span className="text-[10px] text-[var(--text-muted)] leading-tight">{line}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : null}
                                                    <div className="text-[var(--text-muted)] font-mono text-xs mt-2 group-hover:text-[var(--text-secondary)]">{rupiah(pkg.price)}</div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Pagination */}
                                    {
                                        totalPages > 1 && (
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
                                        )
                                    }
                                </div>
                            );
                        })}
                    </div>
                </div>

            </aside>

            {/* === MAIN CONTENT === */}
            <main className="flex-1 overflow-y-auto p-6 md:p-10 bg-[var(--bg-deep)]">
                <div className="max-w-5xl mx-auto space-y-8">
                    {/* Header */}
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-[var(--accent-muted)] rounded-xl">
                            <FileText className="h-8 w-8 text-[var(--accent)]" />
                        </div>
                        <div>
                            <h1 className="text-4xl text-[var(--text-primary)] mb-1" style={{ fontFamily: 'var(--font-display)' }}>Create Invoice</h1>
                            <p className="text-[var(--text-muted)] text-sm">Create a new transaction for wedding or event.</p>
                        </div>
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
                                <div className="flex justify-between items-center">
                                    <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Invoice No (Max 35)</label>
                                    <div className="flex gap-2">
                                        <button onClick={() => setIsManualInvoice(!isManualInvoice)} className="text-[10px] text-[var(--accent)] hover:underline">
                                            {isManualInvoice ? "Auto" : "Edit"}
                                        </button>
                                        <button onClick={() => setShowSeqModal(true)} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                                            Settings
                                        </button>
                                    </div>
                                </div>
                                <input
                                    type="text"
                                    value={invoiceNo}
                                    maxLength={35}
                                    onChange={(e) => {
                                        setInvoiceNo(e.target.value);
                                        setIsManualInvoice(true);
                                    }}
                                    className={clsx(
                                        "w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none transition-colors font-mono",
                                        !isManualInvoice && "opacity-80"
                                    )}
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
                                <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Venue (Optional)</label>
                                <div className="relative">
                                    <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                                    <input
                                        type="text"
                                        value={venue}
                                        onChange={(e) => setVenue(e.target.value)}
                                        className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none transition-colors"
                                        placeholder="e.g. Grand Ballroom"
                                    />
                                </div>
                            </div>
                            {/* New Hours Input - TimeRangePicker */}
                            <div className="space-y-1.5 md:col-span-3">
                                <label className="block text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Event Time (Start - End)</label>
                                <TimeRangePicker
                                    value={hours}
                                    onChange={setHours}
                                />
                            </div>
                        </div>

                        {/* Row 2 */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="space-y-1.5">
                                <label className="block text-xs font-bold text-neutral-500 uppercase tracking-wider">Client Name (Max 30)</label>
                                <div className="relative">
                                    <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                                    <input
                                        type="text"
                                        value={clientName}
                                        maxLength={30}
                                        onChange={(e) => setClientName(e.target.value)}
                                        className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none transition-colors"
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
                                        className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none transition-colors"
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

                    {/* === CONFIGURATION === */}
                    <div className="bg-[var(--bg-card)] rounded-lg shadow-sm border border-[var(--border)] overflow-hidden mb-6">
                        <div className="flex items-center justify-between p-4 bg-[var(--bg-elevated)] border-b border-[var(--border)]">
                            <div className="flex items-center gap-2 font-medium text-[var(--text-primary)]">
                                <span className="bg-[var(--accent)]/10 text-[var(--accent)] p-1.5 rounded-md"><CreditCard size={14} /></span>
                                Invoice Configuration
                            </div>
                            <button
                                onClick={() => setShowConfig(!showConfig)}
                                className="text-gray-400 hover:text-gray-600 transition-colors"
                            >
                                {showConfig ? <ChevronRight className="w-5 h-5 rotate-90 transition-transform" /> : <ChevronRight className="w-5 h-5 transition-transform" />}
                            </button>
                        </div>

                        {showConfig && (
                            <div className="animate-in slide-in-from-top-2 duration-200">
                                {/* Tabs */}
                                <div className="flex border-b border-[var(--border)]">
                                    {['Bank', 'Terms', 'WhatsApp', 'Footer'].map((tab) => (
                                        <button
                                            key={tab}
                                            onClick={() => setActiveTab(tab)}
                                            className={clsx(
                                                "flex-1 py-3 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2",
                                                activeTab === tab
                                                    ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/5"
                                                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                                            )}
                                        >
                                            {tab}
                                        </button>
                                    ))}
                                </div>

                                <div className="p-6">
                                    {/* Bank Data */}
                                    {activeTab === 'Bank' && (
                                        <div className="space-y-4 animate-in fade-in slide-in-from-left-1 duration-200">
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Bank Name</label>
                                                <input type="text" value={bankName} onChange={e => setBankName(e.target.value)} className="w-full text-sm bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md focus:border-[var(--accent)] text-[var(--text-primary)] outline-none px-3 py-2 transition-colors" placeholder="e.g. BCA" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Account No</label>
                                                <input type="text" value={bankAcc} onChange={e => setBankAcc(e.target.value)} className="w-full text-sm bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md focus:border-[var(--accent)] text-[var(--text-primary)] outline-none px-3 py-2 transition-colors" placeholder="e.g. 1234567890" />
                                            </div>
                                            <div className="col-span-1 md:col-span-2">
                                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Account Holder</label>
                                                <input type="text" value={bankHolder} onChange={e => setBankHolder(e.target.value)} className="w-full text-sm bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md focus:border-[var(--accent)] text-[var(--text-primary)] outline-none px-3 py-2 transition-colors" placeholder="e.g. THE ORBIT PHOTOGRAPHY" />
                                            </div>
                                        </div>
                                    )}

                                    {/* Terms */}
                                    {activeTab === 'Terms' && (
                                        <div className="space-y-4 animate-in fade-in slide-in-from-left-1 duration-200">
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">Terms & Conditions</label>
                                                <textarea rows={6} value={terms} onChange={e => setTerms(e.target.value)} className="w-full text-xs font-mono bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md focus:border-[var(--accent)] text-[var(--text-primary)] outline-none px-3 py-2 transition-colors" />
                                                <p className="text-[10px] text-[var(--text-muted)] mt-1">These terms will appear at the bottom of the invoice.</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* WhatsApp */}
                                    {activeTab === 'WhatsApp' && (
                                        <div className="space-y-4 animate-in fade-in slide-in-from-left-1 duration-200">
                                            <div>
                                                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">WhatsApp Message Template</label>
                                                <textarea rows={4} value={waTemplate} onChange={e => setWaTemplate(e.target.value)} className="w-full text-xs bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md focus:border-[var(--accent)] text-[var(--text-primary)] outline-none px-3 py-2 transition-colors" placeholder="Halo {clientName}..." />
                                                <div className="mt-2 text-xs text-[var(--text-muted)] bg-[var(--bg-elevated)] p-2 rounded border border-[var(--border)]">
                                                    <p className="font-semibold mb-1">Available Variables:</p>
                                                    <ul className="list-disc list-inside space-y-0.5 text-[10px]">
                                                        <li><code className="text-[var(--accent)]">{'{clientName}'}</code> - Client's Name</li>
                                                        <li><code className="text-[var(--accent)]">{'{eventTitle}'}</code> - Event Title</li>
                                                        <li><code className="text-[var(--accent)]">{'{invoiceNo}'}</code> - Invoice Number</li>
                                                    </ul>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Footer */}
                                    {activeTab === 'Footer' && (
                                        <div className="space-y-4 animate-in fade-in slide-in-from-left-1 duration-200">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div className="col-span-1 md:col-span-2">
                                                    <label className="block text-xs font-medium text-gray-500 mb-1">Address</label>
                                                    <input type="text" value={footerAddress} onChange={e => setFooterAddress(e.target.value)} className="w-full text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
                                                    <input type="text" value={footerEmail} onChange={e => setFooterEmail(e.target.value)} className="w-full text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-500 mb-1">Instagram (@)</label>
                                                    <input type="text" value={footerIG} onChange={e => setFooterIG(e.target.value)} className="w-full text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
                                                    <input type="text" value={footerPhone} onChange={e => setFooterPhone(e.target.value)} className="w-full text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="mt-6 pt-4 border-t border-gray-100 flex justify-end">
                                        <button
                                            onClick={handleSaveConfig}
                                            className="px-4 py-2 bg-slate-800 text-white text-xs font-bold uppercase tracking-wider rounded-md hover:bg-slate-900 transition-colors flex items-center gap-2 shadow-sm"
                                        >
                                            <Save className="w-3 h-3" />
                                            Save as Default
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* === SAVE CONFIRMATION MODAL === */}
                    {showSaveConfirm && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200">
                                <div className="flex items-center gap-3 mb-4 text-amber-600">
                                    <div className="p-2 bg-amber-100 rounded-full">
                                        <AlertCircle size={24} />
                                    </div>
                                    <h3 className="font-bold text-lg text-gray-900">Update Defaults?</h3>
                                </div>
                                <p className="text-gray-600 mb-6 text-sm leading-relaxed">
                                    Are you sure you want to update the <b>global default configuration</b>? This will affect all future invoices on all devices.
                                </p>
                                <div className="flex justify-end gap-3">
                                    <button
                                        onClick={() => setShowSaveConfirm(false)}
                                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={confirmSaveConfig}
                                        className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-bold hover:bg-amber-700 transition-colors shadow-sm"
                                    >
                                        Yes, Update Defaults
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                    }

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
                                {/* Table Header (Desktop Only) */}
                                <div className="hidden md:grid grid-cols-12 gap-4 text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2 px-2">
                                    <div className="col-span-5">Service / Item</div>
                                    <div className="col-span-3">Price</div>
                                    <div className="col-span-2 text-center">Qty</div>
                                    <div className="col-span-2 text-right">Actions</div>
                                </div>

                                {/* Merge Button Header */}
                                {selectedRowIds.size >= 2 && (
                                    <div className="flex justify-between items-center bg-[var(--accent)]/10 border border-[var(--accent)]/30 p-2 rounded mb-2 animate-in fade-in">
                                        <span className="text-xs text-[var(--accent)] font-bold px-2">{selectedRowIds.size} Items Selected</span>
                                        <button
                                            onClick={() => setShowMergeModal(true)}
                                            className="text-xs bg-[var(--accent)] text-[var(--bg-deep)] px-3 py-1.5 rounded font-bold uppercase tracking-wider hover:opacity-90 transition-opacity"
                                        >
                                            Merge Selected
                                        </button>
                                    </div>
                                )}

                                {/* Items */}
                                <div className="space-y-2">
                                    {cartItems.map(item => (
                                        <div key={item.id}>
                                            {/* Desktop View */}
                                            <div className="hidden md:grid grid-cols-12 gap-4 py-3 border-b border-[var(--border)]/50 items-center hover:bg-[var(--bg-elevated)] -mx-2 px-2 rounded transition-colors group">
                                                <div className="col-span-5 flex items-start gap-2">
                                                    <div className="pt-0.5">
                                                        {!item.isBundle ? (
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedRowIds.has(item.id)}
                                                                onChange={() => toggleSelection(item.id)}
                                                                className="accent-[var(--accent)] cursor-pointer"
                                                            />
                                                        ) : (
                                                            <Package size={14} className="text-[var(--accent)]" />
                                                        )}
                                                    </div>
                                                    <div className="w-full">
                                                        <div className="flex items-center gap-2 relative">
                                                            <input
                                                                type="text"
                                                                value={item.desc}
                                                                onChange={(e) => updateCartItem(item.id, 'desc', e.target.value)}
                                                                className={clsx(
                                                                    "w-full bg-transparent border-none p-0 text-sm focus:ring-0 placeholder-[var(--text-muted)]",
                                                                    item.isBundle ? "text-[var(--accent)] font-medium" : "text-[var(--text-primary)]"
                                                                )}
                                                            />
                                                            {item.details && (
                                                                <div className="relative group/tooltip shrink-0">
                                                                    <Info size={14} className="text-[var(--text-muted)] hover:text-[var(--accent)] cursor-help transition-colors" />
                                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-[#1a1a1a] border border-[#333] rounded-lg shadow-2xl invisible opacity-0 group-hover/tooltip:visible group-hover/tooltip:opacity-100 transition-all z-[999] pointer-events-none">
                                                                        <div className="text-[10px] font-bold text-[var(--accent)] uppercase tracking-wider mb-2 border-b border-[#333] pb-1">Included Details</div>
                                                                        <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                                                                            {item.details.split('\n').filter(Boolean).map((line, i) => (
                                                                                <div key={i} className="flex items-start gap-2">
                                                                                    <span className="text-[var(--accent)] text-[8px] mt-[3px] shrink-0">•</span>
                                                                                    <span className="text-[11px] text-gray-300 leading-snug">{line}</span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                        {/* Arrow */}
                                                                        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-[#333]"></div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                        {item.isBundle && item._bundleSrc && (
                                                            <div className="text-[10px] text-[var(--text-muted)] leading-tight mt-1">
                                                                Bundle of: {item._bundleSrc.map(s => s.desc).join(', ')}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="col-span-3">
                                                    <input
                                                        type="number"
                                                        value={item.price}
                                                        onChange={(e) => updateCartItem(item.id, 'price', Number(e.target.value))}
                                                        disabled={!item.isBundle}
                                                        className={clsx(
                                                            "w-full bg-transparent border-none p-0 text-sm text-right focus:ring-0 font-mono transition-colors",
                                                            item.isBundle
                                                                ? "text-[var(--text-secondary)] border-b border-[var(--border)] focus:border-[var(--accent)]"
                                                                : "text-[var(--text-muted)] cursor-not-allowed opacity-70"
                                                        )}
                                                    />
                                                </div>
                                                <div className="col-span-2">
                                                    <div className="flex items-center justify-center">
                                                        <button
                                                            onClick={() => updateCartItem(item.id, 'qty', Math.max(1, item.qty - 1))}
                                                            className="w-7 h-7 flex items-center justify-center bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] rounded-full hover:scale-110 active:scale-95 transition-all shadow-sm border border-[var(--border)]"
                                                        >
                                                            -
                                                        </button>
                                                        <div className="w-8 flex items-center justify-center font-mono text-sm text-[var(--text-primary)] font-bold">
                                                            {item.qty}
                                                        </div>
                                                        <button
                                                            onClick={() => updateCartItem(item.id, 'qty', item.qty + 1)}
                                                            className="w-7 h-7 flex items-center justify-center bg-[var(--accent)] text-[var(--bg-deep)] hover:opacity-90 rounded-full hover:scale-110 active:scale-95 transition-all shadow-sm"
                                                        >
                                                            +
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="col-span-2 text-right">
                                                    <button
                                                        onClick={() => deleteCartItem(item.id)}
                                                        className="text-[var(--text-muted)] hover:text-red-500 p-1 transition-all"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                    {item.isBundle && (
                                                        <button
                                                            onClick={() => handleUnmerge(item.id)}
                                                            className="text-[var(--text-muted)] hover:text-[var(--accent)] p-1 ml-1"
                                                            title="Unmerge Bundle"
                                                        >
                                                            <div className="text-[10px] font-bold uppercase tracking-wider">Unmerge</div>
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Mobile View (Card) */}
                                            <div key={`mob-${item.id}`} className="md:hidden py-4 border-b border-[var(--border)]/50 space-y-3">
                                                {/* Row 1: Checkbox & Name */}
                                                <div className="flex items-start gap-3">
                                                    <div className="pt-0.5 shrink-0">
                                                        {!item.isBundle ? (
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedRowIds.has(item.id)}
                                                                onChange={() => toggleSelection(item.id)}
                                                                className="accent-[var(--accent)] cursor-pointer"
                                                            />
                                                        ) : (
                                                            <Package size={16} className="text-[var(--accent)]" />
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <input
                                                            type="text"
                                                            value={item.desc}
                                                            onChange={(e) => updateCartItem(item.id, 'desc', e.target.value)}
                                                            className={clsx(
                                                                "w-full bg-transparent border-none p-0 text-sm focus:ring-0 placeholder-[var(--text-muted)]",
                                                                item.isBundle ? "text-[var(--accent)] font-medium" : "text-[var(--text-primary)] font-medium"
                                                            )}
                                                        />
                                                        {item.isBundle && item._bundleSrc && (
                                                            <div className="text-[10px] text-[var(--text-muted)] leading-tight mt-1 truncate">
                                                                {item._bundleSrc.length} items bundled
                                                            </div>
                                                        )}
                                                    </div>
                                                    <button
                                                        onClick={() => deleteCartItem(item.id)}
                                                        className="text-[var(--text-muted)] hover:text-red-500 p-1"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>

                                                {/* Row 2: Price & Qty */}
                                                <div className="flex items-center justify-between pl-7">
                                                    <div className="flex-1">
                                                        <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block mb-0.5">Price</label>
                                                        <input
                                                            type="number"
                                                            value={item.price}
                                                            onChange={(e) => updateCartItem(item.id, 'price', Number(e.target.value))}
                                                            disabled={!item.isBundle}
                                                            className={clsx(
                                                                "w-full bg-transparent border-none p-0 text-sm focus:ring-0 font-mono transition-colors",
                                                                item.isBundle ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"
                                                            )}
                                                        />
                                                    </div>
                                                    <div className="flex items-center gap-3 bg-[var(--bg-elevated)] rounded-full px-1 py-1 border border-[var(--border)]">
                                                        <button
                                                            onClick={() => updateCartItem(item.id, 'qty', Math.max(1, item.qty - 1))}
                                                            className="w-6 h-6 flex items-center justify-center bg-[var(--bg-card)] rounded-full text-[var(--text-primary)] shadow-sm"
                                                        >
                                                            -
                                                        </button>
                                                        <span className="font-mono text-xs font-bold w-4 text-center">{item.qty}</span>
                                                        <button
                                                            onClick={() => updateCartItem(item.id, 'qty', item.qty + 1)}
                                                            className="w-6 h-6 flex items-center justify-center bg-[var(--accent)] text-[var(--bg-deep)] rounded-full shadow-sm"
                                                        >
                                                            +
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Row 3: Details Expansion (Optional, if space permits) */}
                                                {item.details && (
                                                    <div className="pl-7">
                                                        <p className="text-[10px] text-[var(--text-muted)] line-clamp-2 leading-relaxed">
                                                            {item.details}
                                                        </p>
                                                    </div>
                                                )}
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
                            <div className="flex flex-col items-end gap-1">
                                <div className={clsx(
                                    "text-[10px] uppercase font-bold px-2 py-1 rounded border",
                                    remaining === 0 ? "bg-green-900/20 text-green-500 border-green-900/30" :
                                        remaining > 0 ? "bg-orange-900/20 text-orange-500 border-orange-900/30" :
                                            "bg-red-900/20 text-red-500 border-red-900/30"
                                )}>
                                    {remaining === 0 ? 'Balanced' : remaining > 0 ? `Unallocated: ${rupiah(remaining)}` : `Over: ${rupiah(Math.abs(remaining))}`}
                                </div>
                                <p className="text-[10px] text-[var(--text-muted)] italic">
                                    🔒 DP & Settlement are locked. Add terms as needed.
                                </p>
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

                    {/* === PAYMENT PROOF UPLOAD === */}
                    <section className="bg-[var(--bg-card)] p-6 rounded-xl border border-[var(--border)]">
                        <div className="flex items-center gap-2 mb-4 border-b border-[var(--border)] pb-4">
                            <ImageIcon size={18} className="text-[var(--accent)]" />
                            <h2 className="text-[var(--text-primary)] font-medium tracking-wide">Payment Proof</h2>
                        </div>

                        <div className="border-2 border-dashed border-[var(--border)] rounded-lg p-6 text-center hover:bg-[var(--bg-elevated)] transition-colors relative">
                            <input
                                type="file"
                                multiple
                                accept="image/*,application/pdf"
                                onChange={async (e) => {
                                    const files = e.target.files;
                                    if (files && files.length > 0) {
                                        const newProofs: File[] = [];
                                        // Convert to array to iterate
                                        const fileArray = Array.from(files);

                                        for (const file of fileArray) {
                                            try {
                                                const compressed = await compressImage(file);
                                                // Check size AFTER compression
                                                if (compressed.size > 5 * 1024 * 1024) {
                                                    addToast(`File ${file.name} too large (max 5MB)`, 'error');
                                                    continue;
                                                }
                                                newProofs.push(compressed);
                                            } catch (err) {
                                                console.error(err);
                                                addToast(`Failed to process ${file.name}`, 'error');
                                                newProofs.push(file); // Fallback
                                            }
                                        }

                                        if (newProofs.length > 0) {
                                            setPaymentProofs(prev => [...prev, ...newProofs]);
                                        }
                                    }
                                }}
                            />

                            {/* Existing Proofs (Edit Mode) */}
                            {existingProofUrls.length > 0 && (
                                <div className="mb-4 space-y-2">
                                    <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Existing Proofs</p>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                        {existingProofUrls.map((filename, idx) => (
                                            <div key={idx} className="relative group rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg-deep)]">
                                                <img
                                                    src={`${import.meta.env.VITE_API_URL?.replace('/api', '')}/uploads/proofs/${filename}`}
                                                    alt={`Proof ${idx + 1}`}
                                                    className="w-full h-24 object-cover"
                                                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                                />
                                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                    <span className="text-[10px] text-white font-bold">Saved</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {paymentProofs.length > 0 ? (
                                <div className="space-y-3">
                                    <div className="flex flex-col items-center gap-2 text-[var(--text-muted)] mb-4">
                                        <div className="w-10 h-10 bg-[var(--accent)]/10 rounded-full flex items-center justify-center text-[var(--accent)]">
                                            <Upload size={20} />
                                        </div>
                                        <p className="text-xs font-medium">Click to add more files</p>
                                    </div>

                                    <div className="grid grid-cols-1 gap-2">
                                        {paymentProofs.map((file, idx) => (
                                            <div key={idx} className="flex items-center justify-between p-2 bg-[var(--bg-deep)] border border-[var(--border)] rounded text-left group">
                                                <div className="flex items-center gap-2 overflow-hidden">
                                                    <div className="w-8 h-8 bg-[var(--bg-elevated)] rounded flex items-center justify-center text-[var(--text-muted)] shrink-0">
                                                        {file.type.includes('pdf') ? <FileText size={14} /> : <ImageIcon size={14} />}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-medium text-[var(--text-primary)] truncate">{file.name}</p>
                                                        <p className="text-[10px] text-[var(--text-muted)]">{(file.size / 1024).toFixed(1)} KB</p>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        setPaymentProofs(prev => prev.filter((_, i) => i !== idx));
                                                    }}
                                                    className="p-1.5 text-red-500 hover:bg-red-900/20 rounded transition-colors"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-2 text-[var(--text-muted)]">
                                    <Upload size={24} className="mb-2 opacity-50" />
                                    <p className="text-sm font-medium">Click to upload payment proofs</p>
                                    <p className="text-xs text-[var(--text-muted)]">Optional • JPEG, PNG, PDF (Max 5MB)</p>
                                </div>
                            )}
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

                        {isEditMode ? (
                            <button
                                onClick={handleUpdate}
                                disabled={missingFields.length > 0 || grandTotal === 0 || mutation.isPending}
                                className="w-full flex items-center justify-center gap-3 bg-[var(--accent)] text-[var(--bg-deep)] px-6 py-4 rounded-xl hover:opacity-90 font-bold text-sm tracking-widest uppercase transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(196,163,90,0.3)] hover:shadow-[0_0_30px_rgba(196,163,90,0.5)] transform hover:-translate-y-1"
                            >
                                {mutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                {mutation.isPending ? 'Updating...' : 'Update Invoice'}
                            </button>
                        ) : (
                            <button
                                onClick={handlePreview}
                                disabled={missingFields.length > 0 || grandTotal === 0}
                                className="w-full flex items-center justify-center gap-3 bg-[var(--accent)] text-[var(--bg-deep)] px-6 py-4 rounded-xl hover:opacity-90 font-bold text-sm tracking-widest uppercase transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(196,163,90,0.3)] hover:shadow-[0_0_30px_rgba(196,163,90,0.5)] transform hover:-translate-y-1"
                            >
                                <Eye size={18} />
                                Preview Invoice
                            </button>
                        )}
                    </div>
                </div >
            </main >
            {/* Sequence Modal */}
            {
                showSeqModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-sm p-6 space-y-4">
                            <div className="flex justify-between items-center">
                                <h3 className="text-lg font-medium text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>Invoice Sequence</h3>
                                <button onClick={() => setShowSeqModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={20} /></button>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Last Used Sequence</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="number"
                                        value={configLastValue}
                                        onChange={(e) => setConfigLastValue(Number(e.target.value))}
                                        className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none"
                                    />
                                    <div className="flex gap-1">
                                        <button onClick={() => setConfigLastValue(prev => Math.max(0, prev - 1))} className="p-2 bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] rounded-lg border border-[var(--border)] text-[var(--text-primary)]">-</button>
                                        <button onClick={() => setConfigLastValue(prev => prev + 1)} className="p-2 bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] rounded-lg border border-[var(--border)] text-[var(--text-primary)]">+</button>
                                    </div>
                                </div>
                                <p className="text-[10px] text-[var(--text-muted)]">Next invoice will be: <span className="text-[var(--accent)]">{seqPrefix}{String(configLastValue + 1).padStart(seqPadding, '0')}_...</span></p>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button onClick={() => setShowSeqModal(false)} className="flex-1 px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors">Cancel</button>
                                <button
                                    onClick={() => updateSeqMutation.mutate(configLastValue)}
                                    disabled={updateSeqMutation.isPending}
                                    className="flex-1 px-4 py-2 bg-[var(--accent)] text-[var(--bg-deep)] text-sm font-bold uppercase tracking-wider rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                                >
                                    {updateSeqMutation.isPending ? <Loader2 className="animate-spin mx-auto" size={16} /> : "Save"}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Merge Config Modal */}
            {
                showMergeModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
                        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-sm p-6 space-y-4">
                            <div className="flex justify-between items-center">
                                <h3 className="text-lg font-medium text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>Merge Items</h3>
                                <button onClick={() => setShowMergeModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={20} /></button>
                            </div>

                            <div className="space-y-3">
                                <div className="space-y-1.5">
                                    <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Bundle Title</label>
                                    <input
                                        type="text"
                                        value={mergeTitle}
                                        onChange={(e) => setMergeTitle(e.target.value)}
                                        placeholder="e.g. Wedding Package Bundle"
                                        className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Price Mode</label>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setMergePriceMode('sum')}
                                            className={clsx(
                                                "flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded border transition-colors",
                                                mergePriceMode === 'sum'
                                                    ? "bg-[var(--accent)]/10 border-[var(--accent)] text-[var(--accent)]"
                                                    : "bg-transparent border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-secondary)]"
                                            )}
                                        >
                                            Sum Selected
                                        </button>
                                        <button
                                            onClick={() => setMergePriceMode('custom')}
                                            className={clsx(
                                                "flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded border transition-colors",
                                                mergePriceMode === 'custom'
                                                    ? "bg-[var(--accent)]/10 border-[var(--accent)] text-[var(--accent)]"
                                                    : "bg-transparent border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-secondary)]"
                                            )}
                                        >
                                            Custom Price
                                        </button>
                                    </div>
                                </div>

                                {mergePriceMode === 'custom' && (
                                    <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1">
                                        <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Custom Price</label>
                                        <input
                                            type="number"
                                            value={mergeCustomPrice}
                                            onChange={(e) => setMergeCustomPrice(Number(e.target.value))}
                                            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none font-mono"
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button onClick={() => setShowMergeModal(false)} className="flex-1 px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors">Cancel</button>
                                <button
                                    onClick={handleMerge}
                                    className="flex-1 px-4 py-2 bg-[var(--accent)] text-[var(--bg-deep)] text-sm font-bold uppercase tracking-wider rounded-lg hover:opacity-90 transition-opacity"
                                >
                                    Confirm Merge
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

        </div >
    );
}
