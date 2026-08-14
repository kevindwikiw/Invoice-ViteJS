import { useParams, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pdf } from '@react-pdf/renderer'
import { ProofsSidebar } from '../components/ProofsSidebar'
import { InvoicePDF } from '../components/InvoicePDF'
import { ArrowLeft, Loader2, Download, Printer, Image as ImageIcon, History } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { fetchWithAuth, resolveProofDataUrls } from '../lib/api'
import { useToast } from '../context/ToastContext'
import { useState, useMemo, useEffect } from 'react'
import clsx from 'clsx'

export const InvoiceDetail = () => {
    const { invoiceId } = useParams({ strict: false }) as { invoiceId: string }
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { addToast } = useToast()

    const isPreviewMode = invoiceId === 'preview'

    // === PREVIEW DATA (from sessionStorage) ===
    const rawPreviewData = isPreviewMode ? sessionStorage.getItem('invoice_preview') : null;
    const previewInvoice = useMemo(() => {
        if (!rawPreviewData) return null
        try {
            return JSON.parse(rawPreviewData)
        } catch (e) {
            console.error('Failed to parse preview data:', e)
            return null
        }
    }, [rawPreviewData])

    // === FETCH FROM DB (normal mode) ===
    const { data: fetchedInvoice, isLoading, error } = useQuery({
        queryKey: ['invoice', invoiceId],
        queryFn: async () => {
            const res = await fetchWithAuth(`/invoices/${invoiceId}`)
            if (!res.ok) throw new Error('Failed to fetch invoice')
            return res.json()
        },
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        enabled: !isPreviewMode,
    })

    // Use preview data or fetched data
    const invoice = isPreviewMode ? previewInvoice : fetchedInvoice

    const [showProofs, setShowProofs] = useState(false)
    const [pdfUrl, setPdfUrl] = useState<string | null>(null)

    const rawProofs = invoice?.paymentProofs

    // Memoize proofs to prevent new array reference on every render
    const proofs: string[] = useMemo(() => {
        if (!rawProofs) return []
        try {
            return JSON.parse(rawProofs)
        } catch {
            return []
        }
    }, [rawProofs])

    // Generate PDF blob manually with Debounce — prevents UI lag during rapid changes
    useEffect(() => {
        if (!invoice) return

        let cancelled = false
        let generatedUrl: string | null = null

        void (async () => {
            try {
                const pdfProofs = await resolveProofDataUrls(proofs)
                if (cancelled) return
                const blob = await pdf(<InvoicePDF invoice={invoice} proofs={pdfProofs} />).toBlob()
                if (cancelled) return
                generatedUrl = URL.createObjectURL(blob)
                setPdfUrl(generatedUrl)
            } catch (err) {
                console.error('PDF generation failed:', err)
            }
        })()

        return () => {
            cancelled = true
            if (generatedUrl) URL.revokeObjectURL(generatedUrl)
        }
    }, [invoice, proofs])



    // === SAVE TO HISTORY MUTATION (Preview Mode Only) ===
    const saveMutation = useMutation({
        mutationFn: async () => {
            if (!previewInvoice?._savePayload) throw new Error('No data to save')

            const payload = previewInvoice._savePayload
            const isEdit = !!previewInvoice.isEdit;
            const route = isEdit ? `/invoices/${previewInvoice.editId}` : '/invoices';
            console.log("[saveMutation] Payload:", JSON.stringify(payload).substring(0, 500));
            
            const method = isEdit ? 'PUT' : 'POST';

            const res = await fetchWithAuth(route, {
                method: method,
                body: JSON.stringify(payload)
            })
            if (!res.ok) {
                const errorData = await res.json()
                throw new Error(errorData.error || 'Failed to save invoice')
            }
            return res.json()
        },
        onSuccess: async (savedInvoice) => {
            const isEdit = previewInvoice?.isEdit;
            const newInvoiceId = String(savedInvoice.id);

            sessionStorage.removeItem('invoice_preview')
            sessionStorage.removeItem('invoice_preview_restore')
            addToast(isEdit ? 'Invoice updated!' : 'Invoice saved to history!', 'success')
            
            // Mark related caches stale; the destination route performs the single detail fetch.
            queryClient.invalidateQueries({ queryKey: ['invoices'] })
            queryClient.invalidateQueries({ queryKey: ['invoice', newInvoiceId] })
            queryClient.invalidateQueries({ queryKey: ['analytics'] })
            queryClient.invalidateQueries({ queryKey: ['sequence'] })
            
            // Navigate to the newly saved/updated invoice instead of history
            navigate({ to: `/invoices/${newInvoiceId}` })
        },
        onError: (error: unknown) => {
            addToast(error instanceof Error ? error.message : 'Failed to save invoice', 'error')
        }
    })


    // Moved loading guards here to follow Rules of Hooks - MUST BE AFTER ALL HOOKS
    if (!invoice && (isLoading || isPreviewMode)) {
        return (
            <div className="h-screen flex items-center justify-center bg-[var(--bg-deep)]">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-10 w-10 animate-spin text-[var(--accent)]" />
                    <p className="text-[var(--text-muted)] text-sm animate-pulse tracking-widest uppercase font-light">
                        {isPreviewMode ? "Preparing Preview..." : "Loading Invoice..."}
                    </p>
                </div>
            </div>
        )
    }

    if (!invoice && !isLoading) {
        return (
            <div className="h-screen flex items-center justify-center bg-[var(--bg-deep)]">
                <div className="text-center space-y-4">
                    <p className="text-[var(--text-muted)]">Invoice not found</p>
                    <Link to="/history" className="inline-block px-4 py-2 bg-[var(--bg-elevated)] rounded-lg text-sm">
                        Back to History
                    </Link>
                </div>
            </div>
        )
    }


    const handleDownloadPDF = () => {
        if (!pdfUrl) return;
        const link = document.createElement('a');
        link.href = pdfUrl;
        link.download = `Invoice-${invoice?.invoiceNo || 'Draft'}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleBackToCreate = () => {
        sessionStorage.setItem('invoice_preview_restore', '1');
        navigate({
            to: '/create',
            search: { editId: previewInvoice?.isEdit ? previewInvoice.editId : undefined }
        });
    };

    if (!isPreviewMode && isLoading) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-[var(--bg-deep)]">
                <Loader2 className="h-10 w-10 animate-spin text-[var(--accent)] mb-4" />
                <p className="text-[var(--text-muted)] font-light tracking-widest text-sm uppercase">Loading Invoice...</p>
            </div>
        )
    }

    if (error || !invoice) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-[var(--bg-deep)] text-center p-8">
                <div className="w-16 h-1 bg-red-900/50 mb-6 mx-auto rounded-full" />
                <p className="text-red-500 mb-2 font-mono-var">{isPreviewMode ? 'No preview data found. Please create an invoice first.' : 'Error loading invoice data'}</p>
                <Link to={isPreviewMode ? "/create" : "/"} className="text-[var(--accent)] hover:underline underline-offset-4 text-sm uppercase tracking-wider transition-colors">
                    {isPreviewMode ? 'Go to Create Invoice' : 'Return to Packages'}
                </Link>
            </div>
        )
    }

    return (
        <div className="h-screen flex flex-col bg-[var(--bg-deep)] text-[var(--text-primary)]">
            {/* Header */}
            <div className="h-16 border-b border-[var(--border)] bg-[var(--bg-card)]/90 backdrop-blur-md px-6 flex items-center justify-between z-10">
                <div className="flex items-center gap-4">
                    {isPreviewMode ? (
                        <button onClick={handleBackToCreate} className="p-2 hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg transition-colors group">
                            <ArrowLeft className="h-5 w-5 group-hover:-translate-x-0.5 transition-transform" />
                        </button>
                    ) : (
                        <Link to="/" className="p-2 hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg transition-colors group">
                            <ArrowLeft className="h-5 w-5 group-hover:-translate-x-0.5 transition-transform" />
                        </Link>
                    )}
                    <div>
                        <div className="flex items-baseline gap-2">
                            <h1 className="text-lg font-medium text-[var(--text-primary)] tracking-wide font-display">
                                {isPreviewMode ? 'Preview' : `Invoice #${invoice?.invoiceNo || '...'}`}
                            </h1>
                            <span className={clsx(
                                "text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border",
                                isPreviewMode
                                    ? "bg-orange-900/20 text-orange-400 border-orange-900/30"
                                    : "bg-[var(--bg-elevated)] text-[var(--text-muted)] border-[var(--border)]"
                            )}>
                                {isPreviewMode ? 'UNSAVED' : (invoice?.status || 'DRAFT')}
                            </span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] font-mono-var">
                            {invoice?.clientName || '...'} • {invoice?.date || '...'}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {isPreviewMode ? (
                        /* Preview Mode: Save to History Button */
                        <button
                            onClick={() => saveMutation.mutate()}
                            disabled={saveMutation.isPending}
                            className={clsx(
                                "flex items-center gap-2 px-5 py-2 bg-[var(--accent)] text-[var(--bg-deep)] text-xs font-bold uppercase tracking-wider rounded transition-all shadow-lg",
                                saveMutation.isPending ? "opacity-50 cursor-wait" : "hover:opacity-90 hover:shadow-[0_0_20px_rgba(196,163,90,0.4)]"
                            )}
                        >
                            {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <History size={14} />}
                            {saveMutation.isPending ? 'Saving...' : (previewInvoice?.isEdit ? '💾 Update to History' : '💾 Save to History')}
                        </button>
                    ) : (
                        /* Normal Mode: Full Action Bar */
                        <>
                            <button
                                onClick={() => {
                                    const data = typeof invoice.invoiceData === 'string' ? JSON.parse(invoice.invoiceData) : invoice.invoiceData || {};
                                    const template = data.waTemplate || 'Halo kak {clientName}, berikut invoice untuk {eventTitle} yaa..';
                                    const msg = template
                                        .replace(/{clientName}/g, invoice.clientName || '')
                                        .replace(/{eventTitle}/g, data.eventTitle || data.title || '')
                                        .replace(/{invoiceNo}/g, invoice.invoiceNo || '');

                                    const phone = invoice.clientPhone || data.clientPhone || '';
                                    const target = phone ? `https://wa.me/${phone.replace(/^0/, '62').replace(/[^0-9]/g, '')}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;

                                    window.open(target, '_blank');
                                }}
                                className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-green-100 border border-green-200 hover:bg-green-200 rounded text-xs text-green-700 font-medium transition-colors"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9L3 21" /></svg>
                                WhatsApp
                            </button>
                            <button
                                onClick={() => setShowProofs(true)}
                                className="flex items-center gap-2 px-3 py-1.5 bg-blue-100 border border-blue-200 hover:bg-blue-200 rounded text-xs text-blue-700 font-medium transition-colors"
                            >
                                <ImageIcon size={14} />
                                Proofs
                                {proofs.length > 0 && (
                                    <span className="bg-blue-600 text-white text-[9px] px-1 rounded-full">{proofs.length}</span>
                                )}
                            </button>
                            <button className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-elevated)] border border-[var(--border)] hover:bg-[var(--bg-hover)] rounded text-xs text-[var(--text-secondary)] transition-colors">
                                <Printer size={14} /> Print
                            </button>
                            <button
                                disabled={!pdfUrl}
                                onClick={handleDownloadPDF}
                                className={clsx(
                                    "flex items-center gap-2 px-4 py-1.5 bg-[var(--accent)] text-[var(--bg-deep)] text-xs font-bold uppercase tracking-wider rounded transition-colors shadow-lg",
                                    !pdfUrl ? "opacity-50 cursor-wait" : "hover:opacity-90"
                                )}
                            >
                                {!pdfUrl ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                {!pdfUrl ? "Generating..." : "Download PDF"}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Content - PDF Viewer (stable iframe, no remounting) */}
            <div className="flex-1 bg-[var(--bg-elevated)] p-4 md:p-8 overflow-hidden relative">
                <div className="w-full h-full max-w-5xl mx-auto bg-[var(--bg-card)] rounded-lg shadow-2xl overflow-hidden border border-[var(--border)] ring-1 ring-white/5">
                    {pdfUrl ? (
                        <iframe
                            src={`${pdfUrl}#toolbar=0`}
                            width="100%"
                            height="100%"
                            className="w-full h-full border-0"
                            title={`Invoice ${invoice.invoiceNo || 'Preview'}`}
                        />
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full gap-4">
                            <Loader2 className="h-8 w-8 animate-spin text-[var(--accent)]" />
                            <p className="text-[var(--text-muted)] text-sm font-light tracking-wider">Generating PDF preview...</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Isolated Proofs Sidebar Component */}
            <ProofsSidebar 
                isOpen={showProofs}
                onClose={() => setShowProofs(false)}
                invoiceId={invoiceId}
                isPreviewMode={isPreviewMode}
                invoice={invoice}
                proofs={proofs}
                rawPreviewData={rawPreviewData}
            />
        </div>
    )
}

