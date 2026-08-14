import { useState } from 'react';
import type { InvoiceItem, PaymentTerm } from '../types/invoice';

const DEFAULT_TERMS = 'Booking fee is non-refundable.\nFull payment is required before event.\nEdit process takes 2-4 weeks.';
const DEFAULT_WA_TEMPLATE = "Hai kak {clientName}! 👋✨\n\nKita lagi semangat banget nih nyiapin segala sesuatunya buat sesimu di {eventTitle}! 📸 \n\nTerlampir invoice nomor {invoiceNo} buat pelengkap administrasinya yaa. Feel free buat tanya-tanya kalau ada yang kurang jelas atau mau request sesuatu. \n\nCan't wait to see you soon and make some magic happen! 🤍✨";

export function useCreateInvoiceState(hasPreviewDraft: boolean) {
    const [invoiceNo, setInvoiceNo] = useState('');
    const [seqPrefix, setSeqPrefix] = useState('INV');
    const [seqNext, setSeqNext] = useState<number | null>(null);
    const [seqPadding, setSeqPadding] = useState(5);
    const [isManualInvoice, setIsManualInvoice] = useState(false);
    const [showSeqModal, setShowSeqModal] = useState(false);
    const [configLastValue, setConfigLastValue] = useState(0);

    const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
    const [showMergeModal, setShowMergeModal] = useState(false);
    const [mergeTitle, setMergeTitle] = useState('');
    const [mergePriceMode, setMergePriceMode] = useState<'sum' | 'custom'>('sum');
    const [showSaveConfirm, setShowSaveConfirm] = useState(false);
    const [mergeCustomPrice, setMergeCustomPrice] = useState(0);

    const [weddingDate, setWeddingDate] = useState('');
    const [venue, setVenue] = useState('');
    const [clientName, setClientName] = useState('');
    const [clientPhone, setClientPhone] = useState('');
    const [eventTitle, setEventTitle] = useState('');
    const [hours, setHours] = useState('');
    const [notes, setNotes] = useState('');

    const [showNotes, setShowNotes] = useState(false);
    const [showConfigSection, setShowConfigSection] = useState(false);
    const [showInvoiceDefaults, setShowInvoiceDefaults] = useState(false);
    const [showValidation, setShowValidation] = useState(false);
    const [activeTab, setActiveTab] = useState<'Bank' | 'Footer' | 'Terms' | 'WhatsApp'>('Bank');

    const [bankName, setBankName] = useState('BCA');
    const [bankAcc, setBankAcc] = useState('1234567890');
    const [bankHolder, setBankHolder] = useState('THE ORBIT PHOTOGRAPHY');
    const [terms, setTerms] = useState(DEFAULT_TERMS);
    const [footerAddress, setFooterAddress] = useState('Jl. Panembakan Gg Sukamaju 15 No. 3, Kota Cimahi');
    const [footerEmail, setFooterEmail] = useState('theorbitphoto@gmail.com');
    const [footerIG, setFooterIG] = useState('@theorbitphoto');
    const [footerPhone, setFooterPhone] = useState('0813-2333-1506');
    const [waTemplate, setWaTemplate] = useState(DEFAULT_WA_TEMPLATE);

    const [cartItems, setCartItems] = useState<InvoiceItem[]>([]);
    const [cashback, setCashback] = useState(0);
    const [paymentTerms, setPaymentTerms] = useState<PaymentTerm[]>([
        { id: 'dp', label: 'Down Payment', amount: 0, locked: true },
        { id: 'full', label: 'Pelunasan', amount: 0, locked: true },
    ]);
    const [paymentProofs, setPaymentProofs] = useState<File[]>([]);
    const [existingProofUrls, setExistingProofUrls] = useState<string[]>([]);
    const [editDataLoaded, setEditDataLoaded] = useState(hasPreviewDraft);
    const [isUploadingProofs, setIsUploadingProofs] = useState(false);

    return {
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
    };
}
