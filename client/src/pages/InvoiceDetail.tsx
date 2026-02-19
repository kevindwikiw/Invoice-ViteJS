import { useParams, useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pdf } from '@react-pdf/renderer'
import { InvoicePDF } from '../components/InvoicePDF'
import { ArrowLeft, Loader2, Download, Printer, Image as ImageIcon, Upload, X, History } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { fetchWithAuth } from '../context/auth'
import { useToast } from '../context/ToastContext'
import { useState, useMemo, useEffect, useRef } from 'react'
import clsx from 'clsx'
import { compressImage } from '../utils/image'

export const InvoiceDetail = () => {
    const { invoiceId } = useParams({ strict: false }) as { invoiceId: string }
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { addToast } = useToast()

    const isPreviewMode = invoiceId === 'preview'

    // === PREVIEW DATA (from sessionStorage) ===
    const previewInvoice = useMemo(() => {
        if (!isPreviewMode) return null
        try {
            const raw = sessionStorage.getItem('invoice_preview')
            if (raw) return JSON.parse(raw)
        } catch (e) {
            console.error('Failed to parse preview data:', e)
        }
        return null
    }, [isPreviewMode])

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
    const [isUploading, setIsUploading] = useState(false)
    const [pdfUrl, setPdfUrl] = useState<string | null>(null)

    // Memoize proofs to prevent new array reference on every render
    const proofs: string[] = useMemo(() => {
        if (!invoice?.paymentProofs) return []
        try {
            return JSON.parse(invoice.paymentProofs)
        } catch {
            return []
        }
    }, [invoice?.paymentProofs])

    // Generate PDF blob manually — avoids usePDF hook issues with React StrictMode
    const pdfGenId = useRef(0)
    useEffect(() => {
        if (!invoice) return

        const currentId = ++pdfGenId.current
        setPdfUrl(null)

        pdf(<InvoicePDF invoice={invoice} proofs={proofs} />)
            .toBlob()
            .then(blob => {
                if (currentId !== pdfGenId.current) return // stale
                setPdfUrl(URL.createObjectURL(blob))
            })
            .catch(err => console.error('PDF generation failed:', err))

        return () => {
            setPdfUrl(prev => {
                if (prev) URL.revokeObjectURL(prev)
                return null
            })
        }
    }, [invoice, proofs])

    // === SAVE TO HISTORY MUTATION (Preview Mode Only) ===
    const saveMutation = useMutation({
        mutationFn: async () => {
            if (!previewInvoice?._savePayload) throw new Error('No data to save')

            const payload = previewInvoice._savePayload
            const res = await fetchWithAuth('/invoices', {
                method: 'POST',
                body: JSON.stringify(payload)
            })
            if (!res.ok) {
                const errorData = await res.json()
                throw new Error(errorData.error || 'Failed to save invoice')
            }
            return res.json()
        },
        onSuccess: (savedInvoice) => {
            sessionStorage.removeItem('invoice_preview')
            addToast('Invoice saved to history!', 'success')
            queryClient.invalidateQueries({ queryKey: ['invoices'] })
            queryClient.invalidateQueries({ queryKey: ['analytics'] })
            queryClient.invalidateQueries({ queryKey: ['sequence'] })
            // Navigate to the saved invoice detail
            navigate({ to: `/invoices/${savedInvoice.id}` })
        },
        onError: (e: any) => {
            addToast(e.message || 'Failed to save invoice', 'error')
        }
    })

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files
        if (!files || files.length === 0) return

        setIsUploading(true)
        let successCount = 0;
        let errorCount = 0;

        const fileArray = Array.from(files);

        for (const file of fileArray) {
            try {
                const compressedFile = await compressImage(file);

                if (compressedFile.size > 5 * 1024 * 1024) {
                    addToast(`File ${file.name} too large after compression (max 5MB)`, 'error');
                    errorCount++;
                    continue;
                }

                const formData = new FormData()
                formData.append('file', compressedFile)

                const res = await fetchWithAuth(`/invoices/${invoiceId}/proofs`, {
                    method: 'POST',
                    body: formData
                })

                if (res.ok) {
                    successCount++;
                } else {
                    errorCount++;
                    addToast(`Failed to upload ${file.name}`, 'error');
                }
            } catch (err) {
                console.error(err);
                errorCount++;
                addToast(`Error uploading ${file.name}`, 'error');
            }
        }

        if (successCount > 0) {
            queryClient.invalidateQueries({ queryKey: ['invoice', invoiceId] })
            addToast(`${successCount} proof(s) uploaded successfully`, 'success')
        }

        setIsUploading(false)
        e.target.value = '' // Reset input
    }

    // Download reuses the pre-generated blob — instant!
    const handleDownloadPDF = () => {
        if (!pdfUrl) return;
        const link = document.createElement('a');
        link.href = pdfUrl;
        link.download = `Invoice-${invoice?.invoiceNo || 'Draft'}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
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
                <p className="text-red-500 mb-2 font-mono">{isPreviewMode ? 'No preview data found. Please create an invoice first.' : 'Error loading invoice data'}</p>
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
                        <button onClick={() => navigate({ to: '/create', search: { editId: undefined } })} className="p-2 hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg transition-colors group">
                            <ArrowLeft className="h-5 w-5 group-hover:-translate-x-0.5 transition-transform" />
                        </button>
                    ) : (
                        <Link to="/" className="p-2 hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg transition-colors group">
                            <ArrowLeft className="h-5 w-5 group-hover:-translate-x-0.5 transition-transform" />
                        </Link>
                    )}
                    <div>
                        <div className="flex items-baseline gap-2">
                            <h1 className="text-lg font-medium text-[var(--text-primary)] tracking-wide" style={{ fontFamily: 'var(--font-display)' }}>
                                {isPreviewMode ? 'Preview' : `Invoice #${invoice.invoiceNo}`}
                            </h1>
                            <span className={clsx(
                                "text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border",
                                isPreviewMode
                                    ? "bg-orange-900/20 text-orange-400 border-orange-900/30"
                                    : "bg-[var(--bg-elevated)] text-[var(--text-muted)] border-[var(--border)]"
                            )}>
                                {isPreviewMode ? 'UNSAVED' : (invoice.status || 'DRAFT')}
                            </span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] font-mono">
                            {invoice.clientName} • {invoice.date}
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
                            {saveMutation.isPending ? 'Saving...' : '💾 Save to History'}
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

            {/* Proofs Drawer / Overlay (only in normal mode) */}
            {!isPreviewMode && (
                <>
                    <div className={clsx(
                        "fixed inset-y-0 right-0 w-80 bg-[var(--bg-card)] shadow-2xl transform transition-transform duration-300 ease-in-out z-50 border-l border-[var(--border)] flex flex-col",
                        showProofs ? "translate-x-0" : "translate-x-full"
                    )}>
                        <div className="flex items-center justify-between p-4 border-b border-[var(--border)] bg-[var(--bg-elevated)]">
                            <h3 className="font-bold text-[var(--text-primary)]">Payment Proofs</h3>
                            <button onClick={() => setShowProofs(false)} className="p-1 hover:bg-[var(--bg-hover)] rounded text-[var(--text-muted)]">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {proofs.length === 0 ? (
                                <div className="text-center py-8 text-[var(--text-muted)] text-sm border-2 border-dashed border-[var(--border)] rounded-lg">
                                    <ImageIcon className="mx-auto mb-2 opacity-50" size={24} />
                                    No proofs uploaded yet
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 gap-4">
                                    {proofs.map((filename, idx) => (
                                        <div key={idx} className="group relative rounded-lg overflow-hidden border border-[var(--border)] bg-[var(--bg-deep)]">
                                            <a href={`/uploads/proofs/${filename}`} target="_blank" rel="noopener noreferrer" className="block aspect-video">
                                                <img
                                                    src={`/uploads/proofs/${filename}`}
                                                    alt="Proof"
                                                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                                                    loading="lazy"
                                                />
                                            </a>
                                            <div className="absolute bottom-0 inset-x-0 bg-black/60 p-2 opacity-0 group-hover:opacity-100 transition-opacity flex justify-between items-center backdrop-blur-sm">
                                                <span className="text-[10px] text-white truncate max-w-[80%]">{filename.split('_').slice(1).join('_')}</span>
                                                <a
                                                    href={`/uploads/proofs/${filename}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-white hover:text-[var(--accent)]"
                                                >
                                                    <Download size={14} />
                                                </a>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-elevated)]">
                            <label className={clsx(
                                "flex items-center justify-center gap-2 w-full px-4 py-2 bg-[var(--bg-card)] border border-dashed border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent)] rounded-lg cursor-pointer transition-all text-sm font-medium text-[var(--text-muted)]",
                                isUploading && "opacity-50 cursor-wait"
                            )}>
                                {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                                {isUploading ? "Uploading..." : "Upload New Proof"}
                                <input
                                    type="file"
                                    multiple
                                    className="hidden"
                                    accept="image/*,application/pdf"
                                    onChange={handleUpload}
                                    disabled={isUploading}
                                />
                            </label>
                        </div>
                    </div>

                    {/* Backdrop for drawer */}
                    {showProofs && (
                        <div
                            className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
                            onClick={() => setShowProofs(false)}
                        />
                    )}
                </>
            )}

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
        </div>
    )
}
