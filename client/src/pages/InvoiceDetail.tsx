import { useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { PDFViewer } from '@react-pdf/renderer'
import { InvoicePDF } from '../components/InvoicePDF'
import { ArrowLeft, Loader2, Download, Printer } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import clsx from 'clsx'

export const InvoiceDetail = () => {
    const { invoiceId } = useParams({ strict: false }) as { invoiceId: string }

    const { data: invoice, isLoading, error } = useQuery({
        queryKey: ['invoice', invoiceId],
        queryFn: async () => {
            const res = await fetch(`/api/invoices/${invoiceId}`)
            if (!res.ok) throw new Error('Failed to fetch invoice')
            return res.json()
        }
    })

    if (isLoading) {
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
                <p className="text-red-500 mb-2 font-mono">Error loading invoice data</p>
                <Link to="/" className="text-[var(--accent)] hover:underline underline-offset-4 text-sm uppercase tracking-wider transition-colors">
                    Return to Packages
                </Link>
            </div>
        )
    }

    return (
        <div className="h-screen flex flex-col bg-[var(--bg-deep)] text-[var(--text-primary)]">
            {/* Header */}
            <div className="h-16 border-b border-[var(--border)] bg-[var(--bg-card)]/90 backdrop-blur-md px-6 flex items-center justify-between z-10">
                <div className="flex items-center gap-4">
                    <Link to="/" className="p-2 hover:bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg transition-colors group">
                        <ArrowLeft className="h-5 w-5 group-hover:-translate-x-0.5 transition-transform" />
                    </Link>
                    <div>
                        <div className="flex items-baseline gap-2">
                            <h1 className="text-lg font-medium text-[var(--text-primary)] tracking-wide" style={{ fontFamily: 'var(--font-display)' }}>
                                Invoice #{invoice.invoiceNo}
                            </h1>
                            <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] border border-[var(--border)] px-1.5 py-0.5 rounded bg-[var(--bg-elevated)]">
                                {invoice.status || 'DRAFT'}
                            </span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] font-mono">
                            {invoice.clientName} • {invoice.date}
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Placeholder actions - PDF viewer has its own toolbar usually, but we can add custom ones later */}
                    <button className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-elevated)] border border-[var(--border)] hover:bg-[var(--bg-hover)] rounded text-xs text-[var(--text-secondary)] transition-colors">
                        <Printer size={14} /> Print
                    </button>
                    <button className="flex items-center gap-2 px-4 py-1.5 bg-[var(--accent)] text-[var(--bg-deep)] text-xs font-bold uppercase tracking-wider rounded hover:opacity-90 transition-colors shadow-lg">
                        <Download size={14} /> Download PDF
                    </button>
                </div>
            </div>

            {/* Content - PDF Viewer */}
            <div className="flex-1 bg-[var(--bg-elevated)] p-4 md:p-8 overflow-hidden relative">
                <div className="w-full h-full max-w-5xl mx-auto bg-[var(--bg-card)] rounded-lg shadow-2xl overflow-hidden border border-[var(--border)] ring-1 ring-white/5">
                    {/* 
                       Note: PDFViewer rendered canvas is usually white (paper style). 
                       We keep it as is because standard invoices are white paper.
                   */}
                    <PDFViewer width="100%" height="100%" className="w-full h-full border-0">
                        <InvoicePDF invoice={invoice} />
                    </PDFViewer>
                </div>
            </div>
        </div>
    )
}
