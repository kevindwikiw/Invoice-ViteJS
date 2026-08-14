import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Save, Eye, Loader2, ChevronRight, Settings } from 'lucide-react';
import clsx from 'clsx';

import type { InvoiceItem, PaymentTerm, PackageData } from '../types/invoice';
import { 
    PANEL_CARD_CLASS,
    FORM_LABEL_CLASS
} from '../constants/invoice';

import { PackageSidebar } from '../components/PackageSidebar';
import { SequenceModal } from '../components/SequenceModal';
import { MergeModal } from '../components/MergeModal';
import { SaveConfirmModal } from '../components/SaveConfirmModal';
import { BillItems } from '../components/BillItems';
import { PaymentDetails } from '../components/PaymentDetails';
import { DatePicker } from '../components/DatePicker';
import { TimeRangePicker } from '../components/TimeRangePicker';
import { compressImage } from '../utils/image';

// Utility
const rupiah = (n: number) => `Rp ${n.toLocaleString('id-ID')} `;
const toTitleCase = (text: string) =>
    text.replace(/\b([a-z])/gi, (match) => match.toUpperCase());

import { fetchWithAuth } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useCreateInvoiceState } from '../hooks/useCreateInvoiceState';

type PreviewDraft = {
    paymentProofs?: string;
    _savePayload?: InvoicePayload;
    _formState?: {
        isManualInvoice?: boolean;
    };
};

type InvoicePayload = {
    clientName: string;
    invoiceNo: string;
    venue: string;
    weddingDate: string;
    clientPhone: string;
    eventTitle: string;
    hours: string;
    items: InvoiceItem[];
    paymentTerms: PaymentTerm[];
    cashback: number;
    totalAmount: number;
    bankName: string;
    bankAcc: string;
    bankHolder: string;
    terms: string;
    footerAddress: string;
    footerEmail: string;
    footerIG: string;
    footerPhone: string;
    waTemplate: string;
    notes: string;
    payment_proofs: string;
};

type InvoiceConfigPayload = {
    inv_bankName: string;
    inv_bankAcc: string;
    inv_bankHolder: string;
    inv_terms: string;
    inv_footerAddress: string;
    inv_footerEmail: string;
    inv_footerIG: string;
    inv_footerPhone: string;
    inv_waTemplate: string;
};

type SequenceResponse = {
    prefix: string;
    next_value: number | null;
    padding: number;
    last_value: number;
};

const restorePreviewDraft = (): PreviewDraft | null => {
    if (sessionStorage.getItem('invoice_preview_restore') !== '1') return null;

    try {
        const rawDraft = sessionStorage.getItem('invoice_preview');
        return rawDraft ? JSON.parse(rawDraft) : null;
    } catch (error) {
        console.error('Failed to restore invoice preview draft:', error);
        return null;
    }
};

const dataUrlToFile = (dataUrl: string, index: number): File => {
    const [header, encodedData] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
    const extension = mime.split('/')[1] || 'png';
    const binary = atob(encodedData);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }

    return new File([bytes], `preview-proof-${index + 1}.${extension}`, { type: mime });
};

export default function CreateInvoice() {
    const { addToast } = useToast();
    const { editId } = useSearch({ from: '/_layout/create' });
    const isEditMode = !!editId;
    const editInvoiceKey = editId == null ? '' : String(editId);
    const [previewDraft] = useState<PreviewDraft | null>(restorePreviewDraft);

    const {
        invoiceNo, setInvoiceNo, seqPrefix, setSeqPrefix, seqNext, setSeqNext, seqPadding, setSeqPadding,
        isManualInvoice, setIsManualInvoice, showSeqModal, setShowSeqModal, configLastValue, setConfigLastValue,
        selectedRowIds, setSelectedRowIds, showMergeModal, setShowMergeModal, mergeTitle, setMergeTitle,
        mergePriceMode, setMergePriceMode, showSaveConfirm, setShowSaveConfirm, mergeCustomPrice, setMergeCustomPrice,
        weddingDate, setWeddingDate, venue, setVenue, clientName, setClientName, clientPhone, setClientPhone,
        eventTitle, setEventTitle, hours, setHours, notes, setNotes, showNotes, setShowNotes,
        showConfigSection, setShowConfigSection, showInvoiceDefaults, setShowInvoiceDefaults, showValidation, setShowValidation,
        activeTab, setActiveTab, bankName, setBankName, bankAcc, setBankAcc, bankHolder, setBankHolder,
        terms, setTerms, footerAddress, setFooterAddress, footerEmail, setFooterEmail, footerIG, setFooterIG,
        footerPhone, setFooterPhone, waTemplate, setWaTemplate, cartItems, setCartItems, cashback, setCashback,
        paymentTerms, setPaymentTerms, paymentProofs, setPaymentProofs, existingProofUrls, setExistingProofUrls,
        editDataLoaded, setEditDataLoaded, isUploadingProofs, setIsUploadingProofs,
    } = useCreateInvoiceState(Boolean(previewDraft));

    // Fetch Config from API
    const { data: configData } = useQuery({
        queryKey: ['config'],
        queryFn: async () => {
            const res = await fetchWithAuth('/config');
            if (!res.ok) throw new Error('Failed to fetch config');
            return res.json();
        },
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false
    });

    // Update state when config loads
    useEffect(() => {
        if (!configData || previewDraft) return;

        const timer = window.setTimeout(() => {
            if (configData.inv_bankName) setBankName(configData.inv_bankName);
            if (configData.inv_bankAcc) setBankAcc(configData.inv_bankAcc);
            if (configData.inv_bankHolder) setBankHolder(configData.inv_bankHolder);
            if (configData.inv_terms) setTerms(configData.inv_terms);
            if (configData.inv_footerAddress) setFooterAddress(configData.inv_footerAddress);
            if (configData.inv_footerEmail) setFooterEmail(configData.inv_footerEmail);
            if (configData.inv_footerIG) setFooterIG(configData.inv_footerIG);
            if (configData.inv_footerPhone) setFooterPhone(configData.inv_footerPhone);
            if (configData.inv_waTemplate) {
                const oldDefault = 'Halo kak {clientName}, berikut invoice untuk {eventTitle} yaa..';
                setWaTemplate(configData.inv_waTemplate === oldDefault ? "Hai kak {clientName}! 👋✨\n\nKita lagi semangat banget nih nyiapin segala sesuatunya buat sesimu di {eventTitle}! 📸 \n\nTerlampir invoice nomor {invoiceNo} buat pelengkap administrasinya yaa. Feel free buat tanya-tanya kalau ada yang kurang jelas atau mau request sesuatu. \n\nCan't wait to see you soon and make some magic happen! 🤍✨" : configData.inv_waTemplate);
            }
        }, 0);

        return () => window.clearTimeout(timer);
    }, [configData, previewDraft, setBankAcc, setBankHolder, setBankName, setFooterAddress, setFooterEmail, setFooterIG, setFooterPhone, setTerms, setWaTemplate]);

    // Save Config Mutation
    const configMutation = useMutation({
        mutationFn: async (data: InvoiceConfigPayload) => {
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

    useEffect(() => {
        const draft = previewDraft?._savePayload;
        if (!draft) return;

        const timer = window.setTimeout(() => {
            sessionStorage.removeItem('invoice_preview_restore');
            setInvoiceNo(draft.invoiceNo || '');
            setClientName(draft.clientName || '');
            setVenue(draft.venue || '');
            setWeddingDate(draft.weddingDate || '');
            setClientPhone(draft.clientPhone || '');
            setEventTitle(draft.eventTitle || '');
            setHours(draft.hours || '');
            setCartItems(Array.isArray(draft.items) ? draft.items : []);
            if (Array.isArray(draft.paymentTerms)) setPaymentTerms(draft.paymentTerms);
            setCashback(draft.cashback || 0);
            setBankName(draft.bankName || '');
            setBankAcc(draft.bankAcc || '');
            setBankHolder(draft.bankHolder || '');
            setTerms(draft.terms || '');
            setFooterAddress(draft.footerAddress || '');
            setFooterEmail(draft.footerEmail || '');
            setFooterIG(draft.footerIG || '');
            setFooterPhone(draft.footerPhone || '');
            setWaTemplate(draft.waTemplate || '');
            setNotes(draft.notes || '');
            setIsManualInvoice(previewDraft?._formState?.isManualInvoice ?? false);

            try {
                const proofs: string[] = previewDraft.paymentProofs
                    ? JSON.parse(previewDraft.paymentProofs)
                    : [];
                setExistingProofUrls(proofs.filter(proof => !proof.startsWith('data:')));
                setPaymentProofs(
                    proofs
                        .filter(proof => proof.startsWith('data:'))
                        .map(dataUrlToFile)
                );
            } catch (error) {
                console.error('Failed to restore payment proofs:', error);
            }
        }, 0);

        return () => window.clearTimeout(timer);
    }, [previewDraft, setBankAcc, setBankHolder, setBankName, setCartItems, setCashback, setClientName, setClientPhone, setEventTitle, setExistingProofUrls, setFooterAddress, setFooterEmail, setFooterIG, setFooterPhone, setHours, setInvoiceNo, setIsManualInvoice, setNotes, setPaymentProofs, setPaymentTerms, setTerms, setVenue, setWaTemplate, setWeddingDate]);


    // Fetch Packages & Sequence
    const { data: packagesData = [], isLoading: isLoadingPackages } = useQuery<PackageData[]>({
        queryKey: ['packages'],
        queryFn: async () => {
            const res = await fetchWithAuth('/packages');
            if (!res.ok) throw new Error('Failed to fetch packages');
            return res.json();
        },
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false
    });
    const packages = Array.isArray(packagesData) ? packagesData : [];

    // Fetch Sequence
    const seqQuery = useQuery<SequenceResponse | null>({
        queryKey: ['sequence'],
        queryFn: async () => {
            const res = await fetchWithAuth('/sequences/invoice');
            if (!res.ok) return null;
            return res.json();
        },
        staleTime: 0,
        refetchOnWindowFocus: false
    });

    useEffect(() => {
        const data = seqQuery.data;
        if (!data) return;
        setSeqPrefix(data.prefix);
        setSeqNext(data.next_value);
        setSeqPadding(data.padding);
        setConfigLastValue(data.last_value);
    }, [seqQuery.data, setConfigLastValue, setSeqNext, setSeqPadding, setSeqPrefix]);

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

    const generatedInvoiceNo = seqNext === null
        ? invoiceNo
        : `${seqPrefix}${String(seqNext).padStart(seqPadding, '0')}${clientName.trim() ? `_${clientName.trim().replace(/\s+/g, ' ')}` : ''}`;
    const effectiveInvoiceNo = isManualInvoice ? invoiceNo : generatedInvoiceNo;

    const navigate = useNavigate();
    const queryClient = useQueryClient();

    // CALCULATIONS
    const subtotal = useMemo(() =>
        cartItems.reduce((sum, item) => sum + (item.price * item.qty), 0),
        [cartItems]
    );
    const grandTotal = useMemo(() => Math.max(0, subtotal - cashback), [subtotal, cashback]);
    const scheduledPaymentTotal = useMemo(() =>
        paymentTerms
            .filter((term) => term.id !== 'full')
            .reduce((sum, term) => sum + term.amount, 0),
        [paymentTerms]
    );
    const resolvedPaymentTerms = useMemo(() => {
        const settlementAmount = Math.max(0, grandTotal - scheduledPaymentTotal);
        return paymentTerms.map((term) =>
            term.id === 'full' ? { ...term, amount: settlementAmount } : term
        );
    }, [grandTotal, paymentTerms, scheduledPaymentTotal]);
    const totalAllocated = useMemo(() =>
        resolvedPaymentTerms.reduce((sum, term) => sum + term.amount, 0),
        [resolvedPaymentTerms]
    );
    const remaining = grandTotal - totalAllocated;
    const maxCashback = Math.max(0, subtotal - scheduledPaymentTotal);
    const cashbackStepUp = (curr: number) => Math.min(maxCashback, curr + 200000);
    const cashbackStepDown = (curr: number) => Math.max(0, curr - 200000);
    const canIncreaseCashback = cashback < maxCashback;
    const canAddPaymentTerm = paymentTerms.length < 6 && scheduledPaymentTotal < grandTotal;

    // CART ACTIONS
    const cartRowIds = useMemo(() => new Set(cartItems.map(i => i._rowId).filter((id): id is string => id !== undefined)), [cartItems]);
    const selectedItems = useMemo(() => cartItems.filter(item => selectedRowIds.has(item.id)), [cartItems, selectedRowIds]);

    const addToCart = (pkg: PackageData) => {
        const rowId = String(pkg.id);
        if (cartRowIds.has(rowId)) return;

        setCartItems(prev => [...prev, {
            id: `item_${Date.now()}`,
            name: pkg.name,
            desc: pkg.name,
            details: pkg.description,
            price: pkg.price,
            qty: 1,
            _rowId: rowId
        }]);
    };

    const removeFromCart = (rowId: string) => {
        setCartItems(prev => prev.filter(item => item._rowId !== rowId));
    };

    const updateCartItem = <Key extends keyof InvoiceItem>(id: string, field: Key, value: InvoiceItem[Key]) => {
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

        const price = mergePriceMode === 'sum' 
            ? selectedItems.reduce((sum, item) => sum + (item.price * item.qty), 0)
            : mergeCustomPrice;

        const title = mergeTitle || `Bundling: ${selectedItems.map(i => i.desc).slice(0, 2).join(' + ')}...`;

        const newItem: InvoiceItem = {
            id: `bundle_${Date.now()}`,
            desc: title,
            price: price,
            qty: 1,
            isBundle: true,
            _bundleSrc: selectedItems,
            _rowId: `bundle_${Date.now()}`
        };

        setCartItems(prev => [...prev.filter(i => !selectedRowIds.has(i.id)), newItem]);
        setSelectedRowIds(new Set());
        setShowMergeModal(false);
    };

    const handleUnmerge = (id: string) => {
        const bundleItem = cartItems.find(i => i.id === id);
        if (!bundleItem || !bundleItem._bundleSrc) return;
        setCartItems(prev => [...prev.filter(i => i.id !== id), ...bundleItem._bundleSrc!]);
    };

    // PAYMENT ACTIONS
    const updatePaymentTerm = <Key extends keyof PaymentTerm>(id: string, field: Key, value: PaymentTerm[Key]) => {
        if (field === 'id') return; // Cannot update ID
        if (id === 'full' && field === 'amount') return;

        setPaymentTerms(prev => {
            if (field !== 'amount') {
                return prev.map(term => term.id === id ? { ...term, [field]: value } : term);
            }

            const otherScheduledTotal = prev
                .filter((term) => term.id !== id && term.id !== 'full')
                .reduce((sum, term) => sum + term.amount, 0);
            const amount = Math.min(Math.max(0, Number(value) || 0), Math.max(0, grandTotal - otherScheduledTotal));

            return prev.map(term => term.id === id ? { ...term, amount } : term);
        });
    };
    const stepPaymentTerm = (id: string, dir: 'up' | 'down') => {
        if (id === 'full') return;

        setPaymentTerms(prev => {
            const term = prev.find((item) => item.id === id);
            if (!term) return prev;

            const otherScheduledTotal = prev
                .filter((item) => item.id !== id && item.id !== 'full')
                .reduce((sum, item) => sum + item.amount, 0);
            const maxAmount = Math.max(0, grandTotal - otherScheduledTotal);
            const amount = dir === 'up'
                ? Math.min(maxAmount, term.amount + 200000)
                : Math.max(0, term.amount - 200000);

            return prev.map((item) => item.id === id ? { ...item, amount } : item);
        });
    };
    const addPaymentTerm = () => {
        if (!canAddPaymentTerm) return;
        const newTerm: PaymentTerm = { id: `term_${Date.now()}`, label: `Termin ${paymentTerms.length}`, amount: 0, locked: false };
        const fullIdx = paymentTerms.findIndex(t => t.id === 'full');
        const newTerms = [...paymentTerms];
        newTerms.splice(fullIdx, 0, newTerm);
        setPaymentTerms(newTerms);
    };
    const removePaymentTerm = (id: string) => {
        if (paymentTerms.length <= 2) return;
        setPaymentTerms(prev => prev.filter(t => t.id !== id));
    };
    // EDIT LOAD
    const { data: editInvoiceData } = useQuery({
        queryKey: ['invoice', editInvoiceKey],
        queryFn: async () => {
            const res = await fetchWithAuth(`/invoices/${editId}`);
            if (!res.ok) throw new Error('Failed to fetch invoice');
            return res.json();
        },
        enabled: isEditMode && !editDataLoaded,
    });

    useEffect(() => {
        if (!editInvoiceData || editDataLoaded) return;
        const timer = window.setTimeout(() => {
            setInvoiceNo(editInvoiceData.invoiceNo || editInvoiceData.invoice_no || '');
            setClientName(editInvoiceData.clientName || editInvoiceData.client_name || '');
            setIsManualInvoice(true);
            try {
                const data = typeof editInvoiceData.invoiceData === 'string' ? JSON.parse(editInvoiceData.invoiceData) : editInvoiceData.invoice_data;
                if (data) {
                    if (data.venue) setVenue(data.venue);
                    if (data.weddingDate) setWeddingDate(data.weddingDate);
                    if (data.clientPhone) setClientPhone(data.clientPhone);
                    if (data.eventTitle) setEventTitle(data.eventTitle);
                    if (data.hours) setHours(data.hours);
                    if (data.cashback !== undefined) setCashback(data.cashback);
                    if (data.items) setCartItems(data.items.map((it: InvoiceItem) => ({ ...it, _rowId: it._rowId || it.id || String(Math.random()) })));
                    if (data.paymentTerms) setPaymentTerms(data.paymentTerms);
                    if (data.notes) setNotes(data.notes);
                }
                const proofs = editInvoiceData.paymentProofs || editInvoiceData.payment_proofs;
                if (proofs) setExistingProofUrls(typeof proofs === 'string' ? JSON.parse(proofs) : proofs);
            } catch (error) {
                console.error(error);
            }
            setEditDataLoaded(true);
        }, 0);

        return () => window.clearTimeout(timer);
    }, [editInvoiceData, editDataLoaded, setCartItems, setCashback, setClientName, setClientPhone, setEditDataLoaded, setEventTitle, setExistingProofUrls, setHours, setInvoiceNo, setIsManualInvoice, setNotes, setPaymentTerms, setVenue, setWeddingDate]);

    const buildInvoicePayload = () => ({
        clientName, invoiceNo: effectiveInvoiceNo, venue, weddingDate, clientPhone, eventTitle, hours, items: cartItems, paymentTerms: resolvedPaymentTerms, cashback, totalAmount: grandTotal, bankName, bankAcc, bankHolder, terms, footerAddress, footerEmail, footerIG, footerPhone, waTemplate, notes,
        payment_proofs: JSON.stringify(existingProofUrls)
    });

    const handlePreview = async () => {
        const missing = [];
        if (!clientName) missing.push('Client Name');
        if (cartItems.length === 0) missing.push('at least one item');
        
        if (missing.length > 0) {
            setShowValidation(true);
            addToast(`Please fill: ${missing.join(' & ')}`, 'error');
            
            // Auto-scroll to first error
            const idToScroll = !clientName ? 'client-name-section' : 'billing-section';
            document.getElementById(idToScroll)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        
        const payload = buildInvoicePayload();
        
        // Convert File objects to Base64 (Data URLs) because react-pdf fails to fetch blob: URLs
        const imageFiles = paymentProofs.filter(f => f.type.startsWith('image/'));
        const base64Proofs = await Promise.all(
            imageFiles.map((file) => {
                return new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target?.result as string);
                    reader.readAsDataURL(file);
                });
            })
        );
        
        // Combine existing (filenames) and new (Base64) for preview
        const combinedProofs = [
            ...existingProofUrls,
            ...base64Proofs
        ];

        const previewData = {
            invoiceNo: payload.invoiceNo, 
            clientName: payload.clientName, 
            date: payload.weddingDate, 
            totalAmount: payload.totalAmount,
            paymentProofs: JSON.stringify(combinedProofs), // To be parsed by InvoiceDetail
            invoiceData: JSON.stringify({ ...payload }), 
            _savePayload: payload,
            _formState: { isManualInvoice },
            isEdit: isEditMode,
            editId
        };
        sessionStorage.setItem('invoice_preview', JSON.stringify(previewData));
        sessionStorage.setItem('invoice_preview_restore', '1');
        navigate({ to: '/invoices/$invoiceId', params: { invoiceId: 'preview' } });
    };

    const mutation = useMutation({
        mutationFn: async (data: InvoicePayload) => {
            const res = await fetchWithAuth(`/invoices/${editId}`, { method: 'PUT', body: JSON.stringify(data) });
            if (!res.ok) throw new Error('Failed to update');
            return res.json();
        },
        onSuccess: () => {
            addToast('Updated!', 'success');
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            navigate({ to: '/history' });
        }
    });

    const handleUpdate = () => {
        if (!clientName || cartItems.length === 0) {
            setShowValidation(true);
            addToast('Please fill Client Name and add some items', 'error');
            const idToScroll = !clientName ? 'client-name-section' : 'billing-section';
            document.getElementById(idToScroll)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }
        mutation.mutate(buildInvoicePayload());
    };

    const handleUpload = async (files: FileList) => {
        if (!files || files.length === 0) return;
        
        setIsUploadingProofs(true);
        const fileArray = Array.from(files);
        let successCount = 0;

        for (const file of fileArray) {
            try {
                const compressed = await compressImage(file);
                
                if (isEditMode) {
                    // Immediate Upload in Edit Mode
                    const formData = new FormData();
                    formData.append('file', compressed);
                    
                    const res = await fetchWithAuth(`/invoices/${editId}/proofs`, {
                        method: 'POST',
                        body: formData
                    });
                    
                    if (res.ok) {
                        successCount++;
                    } else {
                        addToast(`Failed to upload ${file.name}`, 'error');
                    }
                } else {
                    // Queue for final save in Create Mode
                    setPaymentProofs(prev => [...prev, compressed]);
                    successCount++;
                }
            } catch (err) {
                console.error('Upload Error:', err);
                addToast(`Error processing ${file.name}`, 'error');
            }
        }

        if (successCount > 0) {
            if (isEditMode) {
                // Fetch the updated invoice to get new filenames
                try {
                    const res = await fetchWithAuth(`/invoices/${editId}`);
                    if (res.ok) {
                        const data = await res.json();
                        const proofs = data.paymentProofs || data.payment_proofs;
                        if (proofs) setExistingProofUrls(typeof proofs === 'string' ? JSON.parse(proofs) : proofs);
                    }
                } catch (e) { console.error(e); }
                
                queryClient.invalidateQueries({ queryKey: ['invoice', editInvoiceKey] });
                addToast(`${successCount} proof(s) uploaded`, 'success');
            } else {
                addToast(`${successCount} proof(s) added to queue`, 'info');
            }
        }
        
        setIsUploadingProofs(false);
    };

    const handleRemoveExistingProof = async (filename: string) => {
        if (isEditMode) {
            try {
                const res = await fetchWithAuth(`/invoices/${editId}/proofs/${filename}`, { method: 'DELETE' });
                if (res.ok) {
                    setExistingProofUrls(prev => prev.filter(p => p !== filename));
                    addToast('Proof removed', 'success');
                } else {
                    addToast('Failed to remove proof', 'error');
                }
            } catch {
                addToast('Error removing proof', 'error');
            }
        } else {
            setExistingProofUrls(prev => prev.filter(p => p !== filename));
        }
    };

    const missingFields: string[] = [];
    if (!clientName) missingFields.push('Client Name');

    if (isLoadingPackages) return <div className="h-screen flex items-center justify-center bg-[var(--bg-deep)]"><Loader2 className="animate-spin text-[var(--accent)]" /></div>;

    return (
        <div className="flex flex-col md:flex-row-reverse md:gap-0 h-screen overflow-hidden bg-[var(--bg-deep)] text-[var(--text-primary)]">
            <PackageSidebar 
                packages={packages}
                cartRowIds={cartRowIds}
                addToCart={addToCart}
                removeFromCart={removeFromCart}
                toTitleCase={toTitleCase}
            />

            <main className="flex-1 overflow-y-auto bg-[var(--bg-deep)] p-4 sm:p-6 md:p-10">
                <div className="mx-auto max-w-7xl space-y-6">
                    <div className="mb-10">
                        <h1 className="text-2xl sm:text-3xl md:text-4xl text-[var(--text-primary)] mb-2 font-medium tracking-tight font-display">
                            Create Invoice
                        </h1>
                        <div className="label-xs text-[var(--text-muted)] font-sans">
                            STANDARD OPERATING PROCEDURE: BILLING & TRANSACTION
                        </div>
                    </div>

                    <section className={PANEL_CARD_CLASS}>
                        <div className="mb-10 pl-4 border-l-2 border-[var(--accent)] text-left">
                            <h2 className="text-xl font-medium tracking-tight text-[var(--text-primary)] font-display">Project Overview</h2>
                            <div className="label-xs text-[var(--accent)] mt-1">CLIENT & SESSION INFORMATION</div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            {/* 1. Client Name (Slot 1) */}
                            <div className="space-y-1.5 text-left" id="client-name-section">
                                <label htmlFor="client-name" className={FORM_LABEL_CLASS}>Client Name</label>
                                <input 
                                    id="client-name"
                                    name="clientName"
                                    type="text" 
                                    value={clientName} 
                                    onChange={(e) => {
                                        setClientName(e.target.value);
                                        if (e.target.value) setShowValidation(false);
                                    }} 
                                    className={clsx(
                                        "w-full bg-transparent border rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] outline-none transition-all font-display placeholder:opacity-50",
                                        showValidation && !clientName ? "border-red-500 ring-1 ring-red-500 animate-shake" : "border-[var(--border)]"
                                    )}
                                    placeholder="e.g. Kevin & Putri" 
                                />
                                {showValidation && !clientName && <p className="text-[10px] text-red-500 font-bold tracking-wide mt-1">This field is required</p>}
                            </div>
                            
                            {/* 2. Venue / Location (Slot 2) */}
                            <div className="space-y-1.5 text-left">
                                <label htmlFor="event-venue" className={FORM_LABEL_CLASS}>Venue / Location</label>
                                <input id="event-venue" name="venue" type="text" value={venue} onChange={(e) => setVenue(e.target.value)} className="w-full bg-transparent border border-[var(--border)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] outline-none transition-all font-display placeholder:opacity-50" placeholder="e.g. Ayana Bali, Rooftop Hall" />
                            </div>

                            {/* 3. Event Date (Slot 3) */}
                            <div className="space-y-1.5 text-left">
                                <label htmlFor="event-date" className={FORM_LABEL_CLASS}>Event Date</label>
                                <DatePicker id="event-date" name="eventDate" value={weddingDate} onChange={setWeddingDate} />
                            </div>

                            {/* 4. WhatsApp (Slot 4) */}
                            <div className="space-y-1.5 text-left">
                                <label htmlFor="client-phone" className={FORM_LABEL_CLASS}>WhatsApp / Phone</label>
                                <input id="client-phone" name="clientPhone" type="tel" autoComplete="tel" value={clientPhone} onChange={(e) => setClientPhone(e.target.value.replace(/[^0-9]/g, ''))} className="w-full bg-transparent border border-[var(--border)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] outline-none transition-all font-display" placeholder="62..." />
                            </div>

                            {/* 5. Event Title (Slot 5 - CENTER) */}
                            <div className="space-y-1.5 text-left">
                                <label htmlFor="event-title" className={FORM_LABEL_CLASS}>Event Title</label>
                                <input id="event-title" name="eventTitle" type="text" value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} className="w-full bg-transparent border border-[var(--border)] rounded-xl px-4 py-3 text-sm focus:border-[var(--accent)] outline-none transition-all font-display placeholder:opacity-50" placeholder="e.g. Wedding Reception" />
                            </div>

                            {/* 6. Event Time (Slot 6) */}
                            <div className="space-y-1.5 text-left">
                                <label htmlFor="event-time" className={FORM_LABEL_CLASS}>Event Time</label>
                                <TimeRangePicker id="event-time" name="eventTime" value={hours} onChange={setHours} className="h-[48px]" />
                            </div>

                            {/* 7. Invoice ID (Slot 7) */}
                            <div className="space-y-1.5 text-left">
                                <div className="relative">
                                    <label htmlFor="invoice-number" className={FORM_LABEL_CLASS}>Invoice ID</label>
                                    <div className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-1">
                                        <div className="flex items-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)]/70 p-px">
                                            <button
                                                type="button"
                                                onClick={() => { setIsManualInvoice(false); }}
                                                className={clsx(
                                                    "rounded px-2 py-0.5 text-[7px] font-black uppercase tracking-widest transition-all",
                                                    !isManualInvoice
                                                        ? "bg-[var(--accent)] text-[var(--bg-deep)] shadow-sm"
                                                        : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                                                )}
                                            >
                                                Auto
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setIsManualInvoice(true)}
                                                className={clsx(
                                                    "rounded px-2 py-0.5 text-[7px] font-black uppercase tracking-widest transition-all",
                                                    isManualInvoice
                                                        ? "bg-[var(--accent)] text-[var(--bg-deep)] shadow-sm"
                                                        : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                                                )}
                                            >
                                                Manual
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setShowSeqModal(true)}
                                            className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:border-[var(--accent)]/50 hover:text-[var(--accent)]"
                                            title="Sequence Settings"
                                        >
                                            <Settings size={11} />
                                        </button>
                                    </div>
                                </div>
                                <div className="relative group">
                                    <input 
                                        id="invoice-number"
                                        name="invoiceNumber"
                                        type="text" 
                                        value={effectiveInvoiceNo}
                                        title={effectiveInvoiceNo}
                                        readOnly={!isManualInvoice}
                                        onChange={(e) => { 
                                            setInvoiceNo(e.target.value); 
                                            setIsManualInvoice(true); 
                                        }} 
                                        className={clsx(
                                            "h-[48px] w-full rounded-xl border bg-transparent px-4 text-sm font-medium font-display transition-all outline-none",
                                            isManualInvoice 
                                                ? "border-[var(--accent)] text-[var(--text-primary)] shadow-[0_0_15px_rgba(var(--accent-rgb),0.1)]" 
                                                : "border-[var(--border)] text-[var(--text-primary)] cursor-not-allowed select-none"
                                        )} 
                                    />
                                </div>
                            </div>

                            {/* 8. Identity (Slot 8) */}
                            <div className="space-y-1.5 text-left">
                                <label htmlFor="invoice-template-toggle" className={FORM_LABEL_CLASS}>Invoice Template</label>
                                <button
                                    type="button"
                                    id="invoice-template-toggle"
                                    aria-expanded={showInvoiceDefaults}
                                    onClick={() => {
                                        setShowInvoiceDefaults(!showInvoiceDefaults);
                                        setShowNotes(false);
                                    }}
                                    className={clsx("group relative flex h-[48px] w-full items-center justify-between gap-3 rounded-xl border px-4 text-left transition-all", showInvoiceDefaults ? "border-[var(--accent)] bg-[var(--accent)]/5 shadow-[0_0_15px_rgba(var(--accent-rgb),0.08)]" : "border-[var(--border)] bg-transparent hover:border-[var(--accent)]/40")}
                                >
                                    <span className="min-w-0">
                                        <span className="block truncate text-sm font-medium text-[var(--text-primary)] font-display">Identity</span>
                                    </span>
                                    <span className="flex shrink-0 items-center gap-2">
                                        {(bankHolder || footerIG || terms) && (
                                            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--accent)]/30 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-[var(--accent)]">
                                                <span className="h-1 w-1 rounded-full bg-[var(--accent)]" />
                                                Set
                                            </span>
                                        )}
                                        <span className={clsx("flex h-6 w-6 items-center justify-center rounded-md border transition-colors", showInvoiceDefaults ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-muted)] group-hover:border-[var(--accent)]/50 group-hover:text-[var(--accent)]")}>
                                            <ChevronRight size={13} className={clsx("transition-transform", showInvoiceDefaults && "rotate-90")} />
                                        </span>
                                    </span>
                                    <span className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-64 translate-y-1 rounded-xl border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2.5 text-left opacity-0 shadow-2xl transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100">
                                        <span className="block text-[9px] font-black uppercase tracking-widest text-[var(--accent)]">Invoice template</span>
                                        <span className="mt-1 block text-[11px] font-medium leading-relaxed normal-case tracking-normal text-[var(--text-secondary)]">Atur data bank, footer, terms, dan pesan WhatsApp yang dipakai di invoice.</span>
                                    </span>
                                </button>
                            </div>

                            {/* 9. Remarks (Slot 9) */}
                            <div className="space-y-1.5 text-left">
                                <label htmlFor="invoice-notes-toggle" className={FORM_LABEL_CLASS}>Invoice Notes</label>
                                <button
                                    type="button"
                                    id="invoice-notes-toggle"
                                    aria-expanded={showNotes}
                                    onClick={() => {
                                        setShowNotes(!showNotes);
                                        setShowInvoiceDefaults(false);
                                        if (showConfigSection) setShowConfigSection(false);
                                    }}
                                    className={clsx("group relative flex h-[48px] w-full items-center justify-between gap-3 rounded-xl border px-4 text-left transition-all", showNotes ? "border-[var(--accent)] bg-[var(--accent)]/5 shadow-[0_0_15px_rgba(var(--accent-rgb),0.08)]" : "border-[var(--border)] bg-transparent hover:border-[var(--accent)]/40")}
                                >
                                    <span className="min-w-0">
                                        <span className="block truncate text-sm font-medium text-[var(--text-primary)] font-display">Remarks</span>
                                    </span>
                                    <span className="flex shrink-0 items-center gap-2">
                                        <span className={clsx("rounded-full border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest", notes ? "border-[var(--accent)]/30 text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-muted)]")}>
                                            {notes ? 'Set' : 'Optional'}
                                        </span>
                                        <span className={clsx("flex h-6 w-6 items-center justify-center rounded-md border transition-colors", showNotes ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--text-muted)] group-hover:border-[var(--accent)]/50 group-hover:text-[var(--accent)]")}>
                                            <ChevronRight size={13} className={clsx("transition-transform", showNotes && "rotate-90")} />
                                        </span>
                                    </span>
                                    <span className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 w-64 translate-y-1 rounded-xl border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2.5 text-left opacity-0 shadow-2xl transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100">
                                        <span className="block text-[9px] font-black uppercase tracking-widest text-[var(--accent)]">Invoice remarks</span>
                                        <span className="mt-1 block text-[11px] font-medium leading-relaxed normal-case tracking-normal text-[var(--text-secondary)]">Catatan tambahan khusus untuk invoice ini saja, tidak mengubah template invoice.</span>
                                    </span>
                                </button>
                            </div>
                        </div>

                        <div className="space-y-6 mt-6">
                            {showInvoiceDefaults && (
                                <div className="border border-[var(--border)] rounded-2xl bg-[var(--bg-card)] overflow-hidden animate-in fade-in slide-in-from-top-2">
                                    <div className="flex bg-[var(--bg-elevated)]/50 border-b border-[var(--border)]">
                                        {(['Bank', 'Footer', 'Terms', 'WhatsApp'] as const).map(t => (
                                            <button key={t} onClick={() => setActiveTab(t)} className={clsx('relative flex-1 py-3 text-[10px] font-black uppercase tracking-widest transition-colors', activeTab === t ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]')}>
                                                {t}
                                                {activeTab === t && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent)]" />}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="p-6">
                                        {activeTab === 'Bank' && (
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                                                {[
                                                    { id: 'bank-account-holder', name: 'bankHolder', label: 'Account Holder', value: bankHolder, set: setBankHolder },
                                                    { id: 'bank-name', name: 'bankName', label: 'Bank Name', value: bankName, set: setBankName },
                                                    { id: 'bank-account-number', name: 'bankAccountNumber', label: 'Account Number', value: bankAcc, set: setBankAcc },
                                                ].map(f => (
                                                    <div key={f.label} className="space-y-1.5 text-left">
                                                        <label htmlFor={f.id} className={FORM_LABEL_CLASS}>{f.label}</label>
                                                        <input id={f.id} name={f.name} type="text" value={f.value} onChange={e => f.set(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-transparent px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition-all focus:border-[var(--accent)] font-display" />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {activeTab === 'Footer' && (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                                {[
                                                    { id: 'footer-address', name: 'footerAddress', label: 'Address', value: footerAddress, set: setFooterAddress },
                                                    { id: 'footer-email', name: 'footerEmail', label: 'Email', value: footerEmail, set: setFooterEmail },
                                                    { id: 'footer-instagram', name: 'footerInstagram', label: 'Instagram', value: footerIG, set: setFooterIG },
                                                    { id: 'footer-phone', name: 'footerPhone', label: 'Contact Phone', value: footerPhone, set: setFooterPhone },
                                                ].map(f => (
                                                    <div key={f.label} className="space-y-1.5 text-left">
                                                        <label htmlFor={f.id} className={FORM_LABEL_CLASS}>{f.label}</label>
                                                        <input id={f.id} name={f.name} type="text" value={f.value} onChange={e => f.set(e.target.value)} className="w-full rounded-xl border border-[var(--border)] bg-transparent px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition-all focus:border-[var(--accent)] font-display" />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {activeTab === 'Terms' && (
                                            <div className="space-y-2 text-left">
                                                <div>
                                                    <label htmlFor="invoice-terms" className={FORM_LABEL_CLASS}>Terms & Conditions</label>
                                                    <p className="mt-1 text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">One line becomes one invoice bullet</p>
                                                </div>
                                                <textarea id="invoice-terms" name="invoiceTerms" value={terms} onChange={e => setTerms(e.target.value)} rows={7} className="w-full rounded-xl border border-[var(--border)] bg-transparent p-4 text-sm leading-relaxed text-[var(--text-primary)] outline-none resize-none transition-all focus:border-[var(--accent)] font-display" placeholder={"1. Booking fee is non-refundable.\n2. Full payment before event.\n3. Edit takes 2-4 weeks."} />
                                            </div>
                                        )}
                                        {activeTab === 'WhatsApp' && (
                                            <div className="space-y-3 text-left">
                                                <div>
                                                    <label htmlFor="whatsapp-template" className={FORM_LABEL_CLASS}>WhatsApp Template</label>
                                                    <p className="mt-1 text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Variables: <code className="rounded bg-[var(--bg-elevated)] px-1">{'{clientName}'}</code>, <code className="rounded bg-[var(--bg-elevated)] px-1">{'{eventTitle}'}</code>, <code className="rounded bg-[var(--bg-elevated)] px-1">{'{invoiceNo}'}</code></p>
                                                </div>
                                                <textarea id="whatsapp-template" name="whatsAppTemplate" value={waTemplate} onChange={e => setWaTemplate(e.target.value)} rows={4} className="w-full rounded-xl border border-[var(--border)] bg-transparent p-4 text-sm text-[var(--text-primary)] outline-none resize-none transition-all focus:border-[var(--accent)] font-display" placeholder={"Hai kak {clientName}! 👋✨\n\nKita lagi semangat banget nih nyiapin segala sesuatunya buat sesimu di {eventTitle}! 📸 \n\nTerlampir invoice nomor {invoiceNo} buat pelengkap administrasinya yaa. Feel free buat tanya-tanya kalau ada yang kurang jelas atau mau request sesuatu. \n\nCan't wait to see you soon and make some magic happen! 🤍✨"} />
                                                {waTemplate && (
                                                    <div className="bg-[var(--bg-elevated)] rounded-xl p-3 border border-[var(--border)]">
                                                        <p className="mb-1.5 text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Preview</p>
                                                        <p className="text-xs text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap font-display">{waTemplate.replace('{clientName}', clientName || 'Nama Client').replace('{eventTitle}', eventTitle || 'Wedding Day').replace('{invoiceNo}', effectiveInvoiceNo || 'INV00001')}</p>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <div className="px-6 pb-5 flex justify-end">
                                        <button onClick={handleSaveConfig} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-[10px] font-black uppercase tracking-widest text-[var(--bg-deep)] transition-opacity hover:opacity-90">Save Defaults</button>
                                    </div>
                                </div>
                            )}
                            {showNotes && (
                                <div className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-left animate-in fade-in slide-in-from-top-2">
                                    <div>
                                        <label htmlFor="invoice-notes" className={FORM_LABEL_CLASS}>Invoice Notes</label>
                                        <p className="mt-1 text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)]">Only applies to this invoice</p>
                                    </div>
                                    <textarea id="invoice-notes" name="invoiceNotes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} className="w-full rounded-xl border border-[var(--border)] bg-transparent p-4 text-sm text-[var(--text-primary)] outline-none resize-none transition-all focus:border-[var(--accent)] font-display" placeholder="Special terms, additional info..." />
                                </div>
                            )}
                        </div>
                    </section>

                    <section className={PANEL_CARD_CLASS} id="billing-section">
                        <div className="mb-8 pl-4 border-l-2 border-[var(--accent)] text-left">
                            <h2 className="text-xl font-medium tracking-tight text-[var(--text-primary)] font-display">Billing & Settlement</h2>
                            <div className="label-xs text-[var(--accent)] mt-1">RATES & PAYMENT SCHEDULE</div>
                        </div>
                        <BillItems 
                            items={cartItems}
                            selectedRowIds={selectedRowIds}
                            toggleSelection={toggleSelection}
                            updateItem={updateCartItem}
                            deleteItem={deleteCartItem}
                            unmergeBundle={handleUnmerge}
                            onShowMergeModal={() => setShowMergeModal(true)}
                            subtotal={subtotal}
                            cashback={cashback}
                            setCashback={setCashback}
                            grandTotal={grandTotal}
                            rupiah={rupiah}
                            cashbackStepUp={cashbackStepUp}
                            cashbackStepDown={cashbackStepDown}
                            paymentTerms={resolvedPaymentTerms}
                            updatePaymentTerm={updatePaymentTerm}
                            stepPaymentTerm={stepPaymentTerm}
                            removePaymentTerm={removePaymentTerm}
                            addPaymentTerm={addPaymentTerm}
                            remaining={remaining}
                            canIncreaseCashback={canIncreaseCashback}
                            canAddPaymentTerm={canAddPaymentTerm}
                            hasError={showValidation && cartItems.length === 0}
                        />
                    </section>

                    <section className={PANEL_CARD_CLASS}>
                        <div className="mb-8 pl-4 border-l-2 border-[var(--accent)] text-left">
                            <h2 className="text-xl font-medium tracking-tight text-[var(--text-primary)] font-display">Evidence of Transaction</h2>
                            <div className="label-xs text-[var(--accent)] mt-1">PROOF OF PAYMENT & VERIFICATION</div>
                        </div>
                        <PaymentDetails 
                            isUploadingProofs={isUploadingProofs}
                            existingProofUrls={existingProofUrls}
                            paymentProofs={paymentProofs}
                            setPaymentProofs={setPaymentProofs}
                            onUploadProofs={handleUpload}
                            onRemoveExistingProof={handleRemoveExistingProof}
                        />

                        <div className="mt-12 flex justify-end gap-4 p-6 bg-[var(--bg-elevated)]/30 rounded-2xl border border-[var(--border)]">
                            <button 
                                onClick={handlePreview} 
                                className={clsx(
                                    "px-8 py-3 bg-[var(--bg-elevated)] text-[var(--text-primary)] text-xs font-bold uppercase tracking-widest rounded-xl border border-[var(--border)] flex items-center gap-2 transition-all hover:border-[var(--text-muted)]",
                                    (missingFields.length > 0 || cartItems.length === 0) && "opacity-60"
                                )}
                            >
                                <Eye size={16} /> Preview
                            </button>
                            <button 
                                onClick={isEditMode ? handleUpdate : handlePreview} 
                                className={clsx(
                                    "px-8 py-3 bg-[var(--accent)] text-[var(--bg-deep)] text-xs font-black uppercase tracking-widest rounded-xl flex items-center gap-2 transition-all hover:scale-[1.02] active:scale-95",
                                    (missingFields.length > 0 || cartItems.length === 0) && "opacity-70"
                                )}
                            >
                                <Save size={16} /> {isEditMode ? 'Update' : 'Create'}
                            </button>
                        </div>
                    </section>


                </div>
            </main>

            <SequenceModal show={showSeqModal} onClose={() => setShowSeqModal(false)} prefix={seqPrefix} padding={seqPadding} lastValue={configLastValue} setLastValue={setConfigLastValue} onSave={(v) => updateSeqMutation.mutate(v)} isPending={updateSeqMutation.isPending} />
            <MergeModal 
                show={showMergeModal} 
                onClose={() => setShowMergeModal(false)} 
                title={mergeTitle} 
                setTitle={setMergeTitle} 
                priceMode={mergePriceMode} 
                setPriceMode={setMergePriceMode} 
                customPrice={mergeCustomPrice} 
                setCustomPrice={setMergeCustomPrice} 
                onMerge={handleMerge}
                items={selectedItems}
            />
            <SaveConfirmModal show={showSaveConfirm} onClose={() => setShowSaveConfirm(false)} onConfirm={confirmSaveConfig} />
        </div>
    );
}
