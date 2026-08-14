import { useState, useEffect, useMemo, useRef } from 'react'
import { keepPreviousData, useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useNavigate, Link } from '@tanstack/react-router'
import { useAuth } from '../context/auth'
import { fetchWithAuth, resolveProofDataUrls } from '../lib/api'
import { useToast } from '../context/ToastContext'
import {
    Search, FileClock, Eye, Pencil, Trash2, Loader2, Plus, Filter, Paperclip, MoreHorizontal, Archive, RotateCcw, Check,
    ChevronLeft, ChevronRight, Download, X,
} from 'lucide-react'
import clsx from 'clsx'
import {
    PAGE_SHELL_CLASS,
    SEGMENT_GROUP_CLASS,
    SEGMENT_BUTTON_BASE_CLASS,
    SEGMENT_BUTTON_ACTIVE_CLASS,
    SEGMENT_BUTTON_INACTIVE_CLASS,
    SEARCH_INPUT_CLASS,
    TABLE_HEAD_TEXT_CLASS,
} from '../constants/uiContract'
import { PANEL_CARD_CLASS } from '../constants/invoice'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { SectionHeading } from '../components/SectionHeading'

const INVOICE_GRID_CLASS = 'md:min-w-[1100px] md:grid-cols-[40px_minmax(220px,2fr)_110px_120px_120px_minmax(160px,1.6fr)_140px_160px] md:gap-4';

// ─── Helpers ─────────────────────────────────────────────────

const RUPIAH_FORMATTER = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
})

const rupiah = (val: number) => RUPIAH_FORMATTER.format(val)
const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

type PaymentTerm = { id?: string; label?: string; amount?: number }

type InvoiceListItem = {
    id: number
    invoiceNo?: string | null
    invoice_no?: string | null
    clientName?: string | null
    client_name?: string | null
    date?: string | null
    totalAmount?: number | null
    total_amount?: number | null
    invoiceData?: string | null
    invoice_data?: string | null
    paymentProofs?: unknown
    payment_proofs?: unknown
    isArchived?: boolean | number | null
    is_archived?: boolean | number | null
}

type InvoiceListResponse = {
    items: InvoiceListItem[]
    page: number
    limit: number
    total: number
    totalPages: number
}

type InvoiceListApiResponse = InvoiceListResponse | InvoiceListItem[]

type InvoiceDetailData = InvoiceListItem & {
    paymentProofs?: string | string[] | null
    payment_proofs?: string | string[] | null
}

const EMPTY_INVOICES: InvoiceListItem[] = []

function getPaymentProofCount(paymentProofs: unknown): number {
    if (Array.isArray(paymentProofs)) return paymentProofs.length
    if (typeof paymentProofs === 'string') {
        const trimmed = paymentProofs.trim()
        if (!trimmed) return 0
        try {
            const parsed = JSON.parse(trimmed)
            return Array.isArray(parsed) ? parsed.length : 0
        } catch {
            return trimmed !== '[]' ? 1 : 0
        }
    }
    return 0
}

function parsePaymentProofs(paymentProofs: unknown): string[] {
    if (Array.isArray(paymentProofs)) return paymentProofs.filter((proof): proof is string => typeof proof === 'string')
    if (typeof paymentProofs !== 'string' || !paymentProofs.trim()) return []
    try {
        const parsed = JSON.parse(paymentProofs)
        return Array.isArray(parsed) ? parsed.filter((proof): proof is string => typeof proof === 'string') : []
    } catch {
        return []
    }
}

function extractNotes(invoiceData: unknown): string {
    if (!invoiceData) return ''
    try {
        const data = typeof invoiceData === 'string' ? JSON.parse(invoiceData) : invoiceData
        const notes = (data as { notes?: unknown })?.notes
        if (typeof notes === 'string') return notes.trim()
        if (notes == null) return ''
        return String(notes).trim()
    } catch {
        return ''
    }
}

function deriveStatus(invoiceData: string | null | undefined): 'LUNAS' | 'DP' | 'DP+TERMIN' | 'UNPAID' {
    if (!invoiceData) return 'UNPAID'
    try {
        const data = JSON.parse(invoiceData)
        const terms: PaymentTerm[] = data.paymentTerms || []
        if (!terms.length) return 'UNPAID'

        const pelunasan = terms.find(t => t.id === 'full' || (t.label && t.label.toLowerCase().includes('pelunasan')))
        if (pelunasan && Number(pelunasan.amount || 0) > 0) return 'LUNAS'

        const paidOthers = terms.filter(t => t.id !== 'full' && Number(t.amount || 0) > 0)
        if (paidOthers.length > 1) return 'DP+TERMIN'
        if (paidOthers.length === 1) return 'DP'
        return 'UNPAID'
    } catch {
        return 'UNPAID'
    }
}

const statusConfig = {
    LUNAS: { label: 'LUNAS', bg: 'bg-emerald-500/10', text: 'text-emerald-500', border: 'border-emerald-500/20' },
    DP: { label: 'DP', bg: 'bg-amber-500/10', text: 'text-amber-500', border: 'border-amber-500/20' },
    'DP+TERMIN': { label: 'DP + TERMIN', bg: 'bg-sky-500/10', text: 'text-sky-500', border: 'border-sky-500/20' },
    UNPAID: { label: 'UNPAID', bg: 'bg-rose-500/10', text: 'text-rose-500', border: 'border-rose-500/20' },
}

// ─── Component ───────────────────────────────────────────────

export default function InvoiceHistory() {
    const [search, setSearch] = useState('')
    const debouncedSearch = useDebouncedValue(search)
    const [limit, setLimit] = useState(25)
    const [page, setPage] = useState(1)
    const [selected, setSelected] = useState<Set<number>>(new Set())
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const [invoiceToDelete, setInvoiceToDelete] = useState<{ id: number; invoiceNo: string } | null>(null)
    const [downloadingId, setDownloadingId] = useState<number | null>(null)
    const [activeView, setActiveView] = useState<'all' | 'active' | 'archived'>('all')
    const [openRowMenuId, setOpenRowMenuId] = useState<number | null>(null)
    const [showRefine, setShowRefine] = useState(false)
    const [refineStatus, setRefineStatus] = useState<'all' | 'lunas' | 'dp' | 'dp+termin' | 'unpaid'>('all')
    const [refineNotes, setRefineNotes] = useState<'all' | 'with' | 'without'>('all')
    const [refineAmountMode, setRefineAmountMode] = useState<'all' | 'gt' | 'lt'>('all')
    const [refineAmountValue, setRefineAmountValue] = useState('')
    const [headerStatusFilters, setHeaderStatusFilters] = useState<Array<'lunas' | 'dp' | 'dp+termin' | 'unpaid'>>([])
    const [headerProofFilters, setHeaderProofFilters] = useState<Array<'with' | 'without'>>([])
    const [headerNotesFilters, setHeaderNotesFilters] = useState<Array<'with' | 'without'>>([])
    const [headerDateSort, setHeaderDateSort] = useState<'none' | 'desc' | 'asc'>('none')
    const [headerAmountSort, setHeaderAmountSort] = useState<'none' | 'desc' | 'asc'>('none')
    const [openHeaderMenu, setOpenHeaderMenu] = useState<null | 'date' | 'status' | 'proof' | 'notes' | 'amount'>(null)
    const refineRef = useRef<HTMLDivElement>(null)
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    const { addToast } = useToast()
    const { hasPermission } = useAuth()

    const canDelete = hasPermission('delete_history')
    const canViewHistory = hasPermission('view_billing_history')
    const canEditHistory = hasPermission('edit_billing_history')
    const canDownload = hasPermission('download_invoices')

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (refineRef.current && !refineRef.current.contains(e.target as Node)) {
                setShowRefine(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const { data: stats, isLoading: statsLoading } = useQuery({
        queryKey: ['invoices', 'stats'],
        queryFn: async () => {
            const res = await fetchWithAuth('/invoices/stats')
            if (!res.ok) throw new Error('Failed to fetch stats')
            return res.json()
        },
        staleTime: 30_000,
        enabled: canViewHistory,
    })

    const { data: invoicePage, isLoading: listLoading, isFetching: listFetching } = useQuery<InvoiceListApiResponse>({
        queryKey: ['invoices', 'list', debouncedSearch, limit, page],
        queryFn: async () => {
            const params = new URLSearchParams()
            if (debouncedSearch) params.set('search', debouncedSearch)
            params.set('limit', String(limit))
            params.set('page', String(page))
            const res = await fetchWithAuth(`/invoices?${params}`)
            if (!res.ok) throw new Error('Failed to fetch invoices')
            return res.json()
        },
        staleTime: 15_000,
        placeholderData: keepPreviousData,
        enabled: canViewHistory,
    })

    const isLegacyInvoiceResponse = Array.isArray(invoicePage)
    const invoices = isLegacyInvoiceResponse ? invoicePage : invoicePage?.items ?? EMPTY_INVOICES
    const currentPage = isLegacyInvoiceResponse ? 1 : invoicePage?.page ?? page
    const totalPages = isLegacyInvoiceResponse ? 1 : invoicePage?.totalPages ?? 1
    const totalInvoices = isLegacyInvoiceResponse ? invoicePage.length : invoicePage?.total ?? 0

    const archiveMutation = useMutation({
        mutationFn: async ({ id, isArchived }: { id: number; isArchived: boolean }) => {
            const res = await fetchWithAuth(`/invoices/${id}/archive`, {
                method: 'PATCH',
                body: JSON.stringify({ isArchived }),
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.error || 'Failed to update archive status')
            }
            return res.json()
        },
        onSuccess: (_data, vars) => {
            queryClient.invalidateQueries({ queryKey: ['invoices'] })
            addToast(vars.isArchived ? 'Invoice archived' : 'Invoice restored', 'success')
        },
        onError: (err: unknown) => {
            addToast(errorMessage(err, 'Failed to update archive status'), 'error')
        }
    })

    const deleteInvoiceMutation = useMutation({
        mutationFn: async (id: number) => {
            const res = await fetchWithAuth(`/invoices/${id}`, { method: 'DELETE' })
            if (!res.ok) {
                const error = await res.json().catch(() => ({}))
                throw new Error(error.error || 'Failed to delete invoice')
            }
            return res.json()
        },
        onSuccess: (_data, id) => {
            setSelected(prev => {
                const next = new Set(prev)
                next.delete(id)
                return next
            })
            setInvoiceToDelete(null)
            queryClient.invalidateQueries({ queryKey: ['invoices'] })
            queryClient.invalidateQueries({ queryKey: ['analytics'] })
            addToast('Invoice deleted permanently', 'success')
        },
        onError: (error: Error) => {
            addToast(error.message || 'Failed to delete invoice', 'error')
        },
    })

    const handleDownloadInvoice = async (id: number, fallbackInvoiceNo: string) => {
        if (!canDownload || downloadingId !== null) return
        setDownloadingId(id)

        try {
            const invoice = await queryClient.fetchQuery<InvoiceDetailData>({
                queryKey: ['invoice', String(id)],
                queryFn: async () => {
                    const res = await fetchWithAuth(`/invoices/${id}`)
                    if (!res.ok) throw new Error('Failed to fetch invoice')
                    return res.json()
                },
                staleTime: 5 * 60 * 1000,
            })
            const proofs = parsePaymentProofs(invoice.paymentProofs ?? invoice.payment_proofs)
            const pdfProofs = await resolveProofDataUrls(proofs)
            const [{ pdf }, { InvoicePDF }] = await Promise.all([
                import('@react-pdf/renderer'),
                import('../components/InvoicePDF'),
            ])
            const blob = await pdf(<InvoicePDF invoice={invoice} proofs={pdfProofs} />).toBlob()
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            const invoiceNo = String(invoice.invoiceNo ?? invoice.invoice_no ?? fallbackInvoiceNo)
                .replace(/[<>:"/\\|?*]/g, '-')

            link.href = url
            link.download = `Invoice-${invoiceNo}.pdf`
            document.body.appendChild(link)
            link.click()
            link.remove()
            window.setTimeout(() => URL.revokeObjectURL(url), 0)
            addToast('Invoice PDF downloaded', 'success')
        } catch (error) {
            addToast(error instanceof Error ? error.message : 'Failed to download invoice', 'error')
        } finally {
            setDownloadingId(null)
        }
    }

    // ─── Selection Handlers ──────────────────

    const toggleSelect = (id: number) => {
        setSelected(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const toggleSelectAll = () => {
        if (selected.size === visibleInvoices.length) {
            setSelected(new Set())
        } else {
            setSelected(new Set(visibleInvoices.map(inv => inv.id)))
        }
    }

    const changePage = (nextPage: number) => {
        setPage(nextPage)
        setSelected(new Set())
        setOpenRowMenuId(null)
        setOpenHeaderMenu(null)
    }

    const handleDeleteSelected = async () => {
        if (selected.size === 0) return
        setIsDeleting(true)

        try {
            const res = await fetchWithAuth('/invoices/batch-delete', {
                method: 'POST',
                body: JSON.stringify({ ids: Array.from(selected) }),
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error || 'Delete failed')
            }
            const data = await res.json()
            addToast(`Deleted ${data.count} invoice(s)`, 'success')
            setSelected(new Set())
            queryClient.invalidateQueries({ queryKey: ['invoices'] })
            queryClient.invalidateQueries({ queryKey: ['analytics'] })
        } catch (err: unknown) {
            addToast(errorMessage(err, 'Failed to delete'), 'error')
        } finally {
            setIsDeleting(false)
            setShowDeleteConfirm(false)
        }
    }

    const parsedRefineAmount = Number(refineAmountValue.replace(/\D/g, ''))

    const visibleInvoices = useMemo(() => {
        let rows = invoices.filter(inv => {
            const rawInvoiceData = inv.invoiceData || inv.invoice_data
            const isArchived = Boolean(inv.isArchived ?? inv.is_archived)
            const totalAmount = Number(inv.totalAmount ?? inv.total_amount ?? 0)
            const status = deriveStatus(rawInvoiceData).toLowerCase() as 'lunas' | 'dp' | 'dp+termin' | 'unpaid'
            const notesText = extractNotes(rawInvoiceData)
            const hasNotes = notesText.length > 0
            const proofCount = getPaymentProofCount(inv.paymentProofs ?? inv.payment_proofs)

            if (activeView === 'active' && isArchived) return false
            if (activeView === 'archived' && !isArchived) return false

            if (refineStatus !== 'all' && status !== refineStatus) return false
            if (refineNotes === 'with' && !hasNotes) return false
            if (refineNotes === 'without' && hasNotes) return false

            if (headerStatusFilters.length > 0 && !headerStatusFilters.includes(status)) return false

            const wantWithProof = headerProofFilters.includes('with')
            const wantWithoutProof = headerProofFilters.includes('without')
            if (wantWithProof !== wantWithoutProof) {
                if (wantWithProof && proofCount === 0) return false
                if (wantWithoutProof && proofCount > 0) return false
            }

            const wantWithNotes = headerNotesFilters.includes('with')
            const wantWithoutNotes = headerNotesFilters.includes('without')
            if (wantWithNotes !== wantWithoutNotes) {
                if (wantWithNotes && !hasNotes) return false
                if (wantWithoutNotes && hasNotes) return false
            }

            if (refineAmountMode !== 'all' && parsedRefineAmount > 0) {
                if (refineAmountMode === 'gt' && !(totalAmount > parsedRefineAmount)) return false
                if (refineAmountMode === 'lt' && !(totalAmount < parsedRefineAmount)) return false
            }

            return true
        })

        if (headerDateSort !== 'none') {
            rows = [...rows].sort((a, b) => {
                const aDate = new Date(a.date ?? 0).getTime()
                const bDate = new Date(b.date ?? 0).getTime()
                return headerDateSort === 'desc' ? bDate - aDate : aDate - bDate
            })
        } else if (headerAmountSort !== 'none') {
            rows = [...rows].sort((a, b) => {
                const aAmount = Number(a.totalAmount ?? a.total_amount ?? 0)
                const bAmount = Number(b.totalAmount ?? b.total_amount ?? 0)
                return headerAmountSort === 'desc' ? bAmount - aAmount : aAmount - bAmount
            })
        }

        return rows
    }, [invoices, activeView, refineStatus, refineNotes, refineAmountMode, parsedRefineAmount, headerStatusFilters, headerProofFilters, headerNotesFilters, headerDateSort, headerAmountSort])

    const hasRefineFilters =
        refineStatus !== 'all' ||
        refineNotes !== 'all' ||
        (refineAmountMode !== 'all' && parsedRefineAmount > 0) ||
        headerStatusFilters.length > 0 ||
        headerProofFilters.length > 0 ||
        headerNotesFilters.length > 0 ||
        headerDateSort !== 'none' ||
        headerAmountSort !== 'none'

    const clearAllFilters = () => {
        setRefineStatus('all')
        setRefineNotes('all')
        setRefineAmountMode('all')
        setRefineAmountValue('')
        setHeaderStatusFilters([])
        setHeaderProofFilters([])
        setHeaderNotesFilters([])
        setHeaderDateSort('none')
        setHeaderAmountSort('none')
        setActiveView('all')
        setOpenHeaderMenu(null)
        setShowRefine(false)
    }

    const allSelected = visibleInvoices.length > 0 && selected.size === visibleInvoices.length
    const someSelected = selected.size > 0

    if (!canViewHistory) {
        return (
            <div className={PAGE_SHELL_CLASS}>
                <div className="max-w-7xl mx-auto">
                    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-10 text-center">
                        <h1 className="text-2xl text-[var(--text-primary)] mb-2 font-display">
                            Access Denied
                        </h1>
                        <p className="text-[var(--text-muted)]">You don't have permission to view billing history.</p>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div
            className={PAGE_SHELL_CLASS}
            onClick={() => {
                setOpenRowMenuId(null)
                setOpenHeaderMenu(null)
            }}
        >
            <div className="mx-auto max-w-7xl space-y-6">

                {/* Header Area */}
                <div className="mb-10">
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                        <div className="flex-1 min-w-0">
                            <h1 className="text-2xl sm:text-3xl md:text-4xl text-[var(--text-primary)] mb-2 font-medium tracking-tight font-display">
                                Invoice History
                            </h1>
                            <div className="label-xs text-[var(--text-muted)] font-sans">
                                {statsLoading ? (
                                    'STANDARD OPERATING PROCEDURE: LOADING BILLING RECORDS'
                                ) : (
                                    `STANDARD OPERATING PROCEDURE: BILLING RECORDS / ${stats?.total || 0} INVOICES / ${stats?.lunas || 0} PAID`
                                )}
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
                            <button
                                onClick={() => navigate({ to: '/create', search: { editId: undefined } })}
                                className="bg-[var(--accent)] text-[var(--bg-deep)] px-6 py-2.5 rounded-lg label-xs font-bold hover:opacity-90 active:scale-[0.98] transition-colors flex items-center justify-center gap-2"
                            >
                                <Plus size={16} />
                                Create Invoice
                            </button>
                        </div>
                    </div>
                </div>

                {/* Selection Actions Bar */}
                {someSelected && canDelete && (
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-rose-500/10 border border-rose-500/20 rounded-lg animate-in fade-in slide-in-from-top-2">
                        <span className="text-sm text-rose-500 font-medium font-sans" style={{ fontFamily: 'var(--font-body)' }}>
                            {selected.size} Selected
                        </span>
                        <div className="flex-1" />
                        <button
                            onClick={() => setSelected(new Set())}
                            className="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors uppercase font-bold tracking-widest font-sans"
                            style={{ fontFamily: 'var(--font-body)' }}
                        >
                            Clear
                        </button>
                        <button
                            onClick={() => setShowDeleteConfirm(true)}
                            className="px-4 py-1.5 bg-rose-500 text-white text-[10px] font-bold rounded-md hover:bg-rose-600 transition-colors flex items-center gap-1.5 uppercase tracking-widest font-sans"
                            style={{ fontFamily: 'var(--font-body)' }}
                        >
                            <Trash2 size={13} />
                            Delete Selected
                        </button>
                    </div>
                )}

                {/* Table */}
                <section className={`${PANEL_CARD_CLASS} space-y-6 overflow-visible relative`}>

                    <div className="pb-4 border-b border-[var(--border)] relative z-40">
                        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                            <div className={`${SEGMENT_GROUP_CLASS} overflow-x-auto no-scrollbar`}>
                                {[
                                    { key: 'all', label: 'All' },
                                    { key: 'active', label: 'Active' },
                                    { key: 'archived', label: 'Archive' },
                                ].map(tab => (
                                    <button
                                        key={tab.key}
                                        onClick={() => {
                                            setActiveView(tab.key as 'all' | 'active' | 'archived')
                                            setSelected(new Set())
                                        }}
                                        className={clsx(
                                            SEGMENT_BUTTON_BASE_CLASS,
                                            activeView === tab.key
                                                ? SEGMENT_BUTTON_ACTIVE_CLASS
                                                : SEGMENT_BUTTON_INACTIVE_CLASS
                                        )}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            <div className="flex items-center gap-3 w-full xl:w-auto xl:flex-1 xl:justify-end">
                                {hasRefineFilters && (
                                    <button
                                        onClick={clearAllFilters}
                                        className="inline-flex items-center px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.14em] rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)]/40 transition-colors"
                                    >
                                        Clear Filters
                                    </button>
                                )}
                                <div className="relative shrink-0" ref={refineRef}>
                                    <button
                                        onClick={() => setShowRefine((prev) => !prev)}
                                        className="flex h-10 items-center gap-2 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-4 label-xs text-[var(--text-secondary)] hover:border-[var(--accent)]/40 transition-colors"
                                    >
                                        <Filter size={14} className="text-[var(--text-muted)]" />
                                        Refine
                                    </button>
                                    <div
                                        className={clsx(
                                            'absolute right-0 sm:left-0 top-full mt-2 z-[70] min-w-[280px] rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3 origin-top-right sm:origin-top-left transition-all duration-200',
                                            showRefine ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'
                                        )}
                                    >
                                        <div className="space-y-3">
                                            <div>
                                                <label htmlFor="history-limit-select" className="block mb-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">Rows</label>
                                                <select
                                                    id="history-limit-select"
                                                    name="historyLimit"
                                                    value={limit}
                                                    onChange={e => {
                                                        setLimit(Number(e.target.value))
                                                        changePage(1)
                                                    }}
                                                    className="w-full bg-[var(--bg-deep)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
                                                >
                                                    <option value={10}>Show 10 Rows</option>
                                                    <option value={25}>Show 25 Rows</option>
                                                    <option value={50}>Show 50 Rows</option>
                                                    <option value={100}>Show 100 Rows</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label htmlFor="history-status-select" className="block mb-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">Status</label>
                                                <select
                                                    id="history-status-select"
                                                    name="historyStatus"
                                                    value={refineStatus}
                                                    onChange={(e) => setRefineStatus(e.target.value as typeof refineStatus)}
                                                    className="w-full bg-[var(--bg-deep)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
                                                >
                                                    <option value="all">All</option>
                                                    <option value="lunas">Lunas</option>
                                                    <option value="dp">DP</option>
                                                    <option value="dp+termin">DP + Termin</option>
                                                    <option value="unpaid">Unpaid</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label htmlFor="history-notes-select" className="block mb-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">Notes</label>
                                                <select
                                                    id="history-notes-select"
                                                    name="historyNotes"
                                                    value={refineNotes}
                                                    onChange={(e) => setRefineNotes(e.target.value as typeof refineNotes)}
                                                    className="w-full bg-[var(--bg-deep)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
                                                >
                                                    <option value="all">All</option>
                                                    <option value="with">With Notes</option>
                                                    <option value="without">Without Notes</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label htmlFor="history-amount-mode" className="block mb-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">Amount</label>
                                                <div className="grid grid-cols-[100px_1fr] gap-2">
                                                    <select
                                                        id="history-amount-mode"
                                                        name="historyAmountMode"
                                                        aria-label="Amount comparison mode"
                                                        value={refineAmountMode}
                                                        onChange={(e) => setRefineAmountMode(e.target.value as typeof refineAmountMode)}
                                                        className="bg-[var(--bg-deep)] border border-[var(--border)] rounded-lg px-2.5 py-2 text-xs text-[var(--text-primary)] outline-none"
                                                    >
                                                        <option value="all">Any</option>
                                                        <option value="gt">More Than</option>
                                                        <option value="lt">Less Than</option>
                                                    </select>
                                                    <input
                                                        id="history-amount-value"
                                                        name="historyAmountValue"
                                                        aria-label="Amount threshold value"
                                                        value={refineAmountValue}
                                                        onChange={(e) => setRefineAmountValue(e.target.value)}
                                                        placeholder="e.g. 10000000"
                                                        className="bg-[var(--bg-deep)] border border-[var(--border)] rounded-lg px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
                                                    />
                                                </div>
                                            </div>
                                            <button
                                                onClick={clearAllFilters}
                                                className="w-full text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] hover:text-[var(--text-primary)] underline underline-offset-2 py-1"
                                            >
                                                Reset Refine
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <div className="relative flex-1 w-full min-w-0 xl:w-[280px] xl:flex-none font-sans text-xs">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                                    <input
                                        id="history-search-input"
                                        name="historySearch"
                                        aria-label="Search invoices by client name, number, or venue"
                                        type="text"
                                        placeholder="Search invoices..."
                                        value={search}
                                        onChange={e => {
                                            setSearch(e.target.value)
                                            changePage(1)
                                        }}
                                        className={SEARCH_INPUT_CLASS + (search ? ' pr-9' : '')}
                                        style={{ height: '40px', paddingLeft: '2.5rem' }}
                                    />
                                    {search && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSearch('')
                                                changePage(1)
                                            }}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
                                            title="Clear search"
                                            aria-label="Clear invoice search"
                                        >
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Active Filter Badges */}
                        {hasRefineFilters && (
                            <div className="pt-4 flex flex-wrap items-center gap-2">
                                {refineStatus !== 'all' && (
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-[0.14em] border border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-elevated)]">
                                        Status: {refineStatus === 'dp+termin' ? 'DP + Termin' : refineStatus.toUpperCase()}
                                    </span>
                                )}
                                {refineNotes !== 'all' && (
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-[0.14em] border border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-elevated)]">
                                        Notes: {refineNotes === 'with' ? 'With Notes' : 'Without Notes'}
                                    </span>
                                )}
                                {headerStatusFilters.length > 0 && (
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-[0.14em] border border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-elevated)]">
                                        Status (Multi): {headerStatusFilters.join(', ')}
                                    </span>
                                )}
                                {headerProofFilters.length > 0 && (
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-[0.14em] border border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-elevated)]">
                                        Proof (Multi): {headerProofFilters.join(', ')}
                                    </span>
                                )}
                                {headerNotesFilters.length > 0 && (
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-[0.14em] border border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-elevated)]">
                                        Notes (Multi): {headerNotesFilters.join(', ')}
                                    </span>
                                )}
                                {headerDateSort !== 'none' && (
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-[0.14em] border border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-elevated)]">
                                        Date: {headerDateSort === 'desc' ? 'Newest' : 'Oldest'}
                                    </span>
                                )}
                                {headerAmountSort !== 'none' && (
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-[0.14em] border border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-elevated)]">
                                        Amount: {headerAmountSort === 'desc' ? 'Highest' : 'Lowest'}
                                    </span>
                                )}
                                {refineAmountMode !== 'all' && parsedRefineAmount > 0 && (
                                    <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-[0.14em] border border-[var(--border)] text-[var(--text-secondary)] bg-[var(--bg-elevated)]">
                                        Amount {refineAmountMode === 'gt' ? '>' : '<'} {parsedRefineAmount.toLocaleString('id-ID')}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>

                    <SectionHeading
                        title={activeView === 'all' ? 'All Invoices' : activeView === 'active' ? 'Active Invoices' : 'Invoice Archive'}
                        subtitle={`BILLING RECORDS & SETTLEMENT (${visibleInvoices.length} SHOWN / ${totalInvoices} TOTAL)`}
                    />

                    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/10">
                    {/* Table Header */}
                    <div className={clsx('hidden md:grid px-6 py-3.5 border-b border-[var(--border)] bg-[var(--bg-elevated)]/30', INVOICE_GRID_CLASS)}>
                        {canDelete ? (
                            <div className="flex items-center">
                                <input
                                    id="select-all-invoices"
                                    name="selectAllInvoices"
                                    aria-label="Select all invoices"
                                    type="checkbox"
                                    checked={allSelected}
                                    onChange={toggleSelectAll}
                                    className="w-4 h-4 rounded border-[var(--border)] accent-[var(--accent)] cursor-pointer"
                                />
                            </div>
                        ) : <div />}

                        <div className={clsx(TABLE_HEAD_TEXT_CLASS, 'text-left')} style={{ fontFamily: 'var(--font-body)' }}>Invoice</div>

                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                            <button
                                onClick={() => setOpenHeaderMenu((prev) => (prev === 'date' ? null : 'date'))}
                                className={clsx(TABLE_HEAD_TEXT_CLASS, 'w-full justify-center flex items-center gap-1.5 hover:text-[var(--text-primary)]')}
                                style={{ fontFamily: 'var(--font-body)' }}
                            >
                                Date
                                <span className="text-[9px]">{headerDateSort === 'desc' ? 'Newest' : headerDateSort === 'asc' ? 'Oldest' : 'Any'}</span>
                            </button>
                            {openHeaderMenu === 'date' && (
                                <div className="absolute left-0 top-full mt-1 z-[80] min-w-[140px] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-1.5">
                                    <button onClick={() => { setHeaderDateSort('none'); setOpenHeaderMenu(null) }} className={clsx("w-full text-left px-2.5 py-2 text-xs rounded hover:bg-[var(--bg-elevated)] flex items-center justify-between", headerDateSort === 'none' && "text-[var(--text-primary)]")}>Any Date {headerDateSort === 'none' && <Check size={12} className="text-[var(--accent)]" />}</button>
                                    <button onClick={() => { setHeaderDateSort('desc'); setOpenHeaderMenu(null) }} className={clsx("w-full text-left px-2.5 py-2 text-xs rounded hover:bg-[var(--bg-elevated)] flex items-center justify-between", headerDateSort === 'desc' && "text-[var(--text-primary)]")}>Newest {headerDateSort === 'desc' && <Check size={12} className="text-[var(--accent)]" />}</button>
                                    <button onClick={() => { setHeaderDateSort('asc'); setOpenHeaderMenu(null) }} className={clsx("w-full text-left px-2.5 py-2 text-xs rounded hover:bg-[var(--bg-elevated)] flex items-center justify-between", headerDateSort === 'asc' && "text-[var(--text-primary)]")}>Oldest {headerDateSort === 'asc' && <Check size={12} className="text-[var(--accent)]" />}</button>
                                </div>
                            )}
                        </div>

                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                            <button
                                onClick={() => setOpenHeaderMenu((prev) => (prev === 'status' ? null : 'status'))}
                                className={clsx(TABLE_HEAD_TEXT_CLASS, 'w-full justify-center flex items-center gap-1.5 hover:text-[var(--text-primary)]')}
                                style={{ fontFamily: 'var(--font-body)' }}
                            >
                                Status
                                <span className="text-[9px]">{headerStatusFilters.length === 0 ? 'Any' : `${headerStatusFilters.length} selected`}</span>
                            </button>
                            {openHeaderMenu === 'status' && (
                                <div className="absolute left-0 top-full mt-1 z-[80] min-w-[170px] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-1.5">
                                    <button onClick={() => { setHeaderStatusFilters([]); setOpenHeaderMenu(null) }} className="w-full text-left px-2.5 py-2 text-xs rounded hover:bg-[var(--bg-elevated)]">Clear Multi</button>
                                    {(['lunas', 'dp', 'dp+termin', 'unpaid'] as const).map((statusKey) => {
                                        const active = headerStatusFilters.includes(statusKey)
                                        return (
                                            <button
                                                key={statusKey}
                                                onClick={() => setHeaderStatusFilters((prev) => prev.includes(statusKey) ? prev.filter((s) => s !== statusKey) : [...prev, statusKey])}
                                                className={clsx("w-full text-left px-2.5 py-2 text-xs rounded hover:bg-[var(--bg-elevated)] flex items-center justify-between", active && "text-[var(--text-primary)]")}
                                            >
                                                <span>{statusKey === 'dp+termin' ? 'DP + Termin' : statusKey.toUpperCase()}</span>
                                                {active && <Check size={12} className="text-[var(--accent)]" />}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                            <button
                                onClick={() => setOpenHeaderMenu((prev) => (prev === 'proof' ? null : 'proof'))}
                                className={clsx(TABLE_HEAD_TEXT_CLASS, 'w-full justify-center flex items-center gap-1.5 hover:text-[var(--text-primary)]')}
                                style={{ fontFamily: 'var(--font-body)' }}
                            >
                                Proof
                                <span className="text-[9px]">{headerProofFilters.length === 0 ? 'Any' : `${headerProofFilters.length} selected`}</span>
                            </button>
                            {openHeaderMenu === 'proof' && (
                                <div className="absolute left-0 top-full mt-1 z-[80] min-w-[140px] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-1.5">
                                    <button onClick={() => { setHeaderProofFilters([]); setOpenHeaderMenu(null) }} className="w-full text-left px-2.5 py-2 text-xs rounded hover:bg-[var(--bg-elevated)]">Clear Multi</button>
                                    {(['with', 'without'] as const).map((proofKey) => {
                                        const active = headerProofFilters.includes(proofKey)
                                        return (
                                            <button
                                                key={proofKey}
                                                onClick={() => setHeaderProofFilters((prev) => prev.includes(proofKey) ? prev.filter((s) => s !== proofKey) : [...prev, proofKey])}
                                                className={clsx("w-full text-left px-2.5 py-2 text-xs rounded hover:bg-[var(--bg-elevated)] flex items-center justify-between", active && "text-[var(--text-primary)]")}
                                            >
                                                <span>{proofKey === 'with' ? 'With Proof' : 'Without Proof'}</span>
                                                {active && <Check size={12} className="text-[var(--accent)]" />}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                            <button
                                onClick={() => setOpenHeaderMenu((prev) => (prev === 'notes' ? null : 'notes'))}
                                className={clsx(TABLE_HEAD_TEXT_CLASS, 'text-left flex items-center gap-1.5 hover:text-[var(--text-primary)]')}
                                style={{ fontFamily: 'var(--font-body)' }}
                            >
                                Notes
                                <span className="text-[9px]">{headerNotesFilters.length === 0 ? 'Any' : `${headerNotesFilters.length} selected`}</span>
                            </button>
                            {openHeaderMenu === 'notes' && (
                                <div className="absolute left-0 top-full mt-1 z-[80] min-w-[140px] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-1.5">
                                    <button onClick={() => { setHeaderNotesFilters([]); setOpenHeaderMenu(null) }} className="w-full text-left px-2.5 py-2 text-xs rounded hover:bg-[var(--bg-elevated)]">Clear Multi</button>
                                    {(['with', 'without'] as const).map((noteKey) => {
                                        const active = headerNotesFilters.includes(noteKey)
                                        return (
                                            <button
                                                key={noteKey}
                                                onClick={() => setHeaderNotesFilters((prev) => prev.includes(noteKey) ? prev.filter((s) => s !== noteKey) : [...prev, noteKey])}
                                                className={clsx("w-full text-left px-2.5 py-2 text-xs rounded hover:bg-[var(--bg-elevated)] flex items-center justify-between", active && "text-[var(--text-primary)]")}
                                            >
                                                <span>{noteKey === 'with' ? 'With Notes' : 'Without Notes'}</span>
                                                {active && <Check size={12} className="text-[var(--accent)]" />}
                                            </button>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="relative" onClick={(e) => e.stopPropagation()}>
                            <button
                                onClick={() => setOpenHeaderMenu((prev) => (prev === 'amount' ? null : 'amount'))}
                                className={clsx(TABLE_HEAD_TEXT_CLASS, 'text-right flex items-center justify-end gap-1.5 hover:text-[var(--text-primary)]')}
                                style={{ fontFamily: 'var(--font-body)' }}
                            >
                                Amount
                                <span className="text-[9px]">{headerAmountSort === 'desc' ? 'Highest' : headerAmountSort === 'asc' ? 'Lowest' : 'Any'}</span>
                            </button>
                            {openHeaderMenu === 'amount' && (
                                <div className="absolute right-0 top-full mt-1 z-[80] min-w-[150px] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-1.5">
                                    <button onClick={() => { setHeaderAmountSort('none'); setOpenHeaderMenu(null) }} className={clsx("w-full text-left px-2.5 py-2 text-xs rounded hover:bg-[var(--bg-elevated)] flex items-center justify-between", headerAmountSort === 'none' && "text-[var(--text-primary)]")}>Any Amount {headerAmountSort === 'none' && <Check size={12} className="text-[var(--accent)]" />}</button>
                                    <button onClick={() => { setHeaderAmountSort('desc'); setOpenHeaderMenu(null) }} className={clsx("w-full text-left px-2.5 py-2 text-xs rounded hover:bg-[var(--bg-elevated)] flex items-center justify-between", headerAmountSort === 'desc' && "text-[var(--text-primary)]")}>Highest {headerAmountSort === 'desc' && <Check size={12} className="text-[var(--accent)]" />}</button>
                                    <button onClick={() => { setHeaderAmountSort('asc'); setOpenHeaderMenu(null) }} className={clsx("w-full text-left px-2.5 py-2 text-xs rounded hover:bg-[var(--bg-elevated)] flex items-center justify-between", headerAmountSort === 'asc' && "text-[var(--text-primary)]")}>Lowest {headerAmountSort === 'asc' && <Check size={12} className="text-[var(--accent)]" />}</button>
                                </div>
                            )}
                        </div>

                        <div className={clsx(TABLE_HEAD_TEXT_CLASS, 'text-center')} style={{ fontFamily: 'var(--font-body)' }}>Actions</div>
                    </div>
                    {/* Rows */}
                    {listLoading ? (
                        <div className="flex items-center justify-center py-24 gap-3">
                            <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
                            <span className="text-xs uppercase tracking-[0.2em] font-medium text-[var(--text-muted)] font-sans" style={{ fontFamily: 'var(--font-body)' }}>Loading Invoices...</span>
                        </div>
                    ) : visibleInvoices.length === 0 ? (
                        <div className="text-center py-24 text-[var(--text-muted)]">
                            <div className="w-12 h-12 bg-[var(--bg-elevated)] rounded-full flex items-center justify-center mx-auto mb-4 border border-[var(--border)]">
                                <FileClock className="opacity-40" size={24} />
                            </div>
                            <p className="text-sm font-medium uppercase tracking-[0.1em] text-[var(--text-primary)] font-sans" style={{ fontFamily: 'var(--font-body)' }}>No Invoices Found</p>
                            <p className="text-[10px] mt-1 opacity-60 uppercase tracking-widest font-sans" style={{ fontFamily: 'var(--font-body)' }}>Create your first invoice to get started!</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-[var(--border)]/60">
                            {visibleInvoices.map((inv, idx) => {
                                const rawInvoiceData = inv.invoiceData || inv.invoice_data
                                const status = deriveStatus(rawInvoiceData)
                                const sc = statusConfig[status]
                                const totalAmount = inv.totalAmount ?? inv.total_amount ?? 0
                                const invoiceNo = (inv.invoiceNo ?? inv.invoice_no ?? '-').toUpperCase()
                                const clientName = (inv.clientName ?? inv.client_name ?? '-')
                                    .split(' ')
                                    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                                    .join(' ')
                                const date = inv.date ?? '-'
                                const id = inv.id
                                const isChecked = selected.has(id)
                                const isArchived = Boolean(inv.isArchived ?? inv.is_archived)
                                const canArchive = status === 'LUNAS'
                                const proofCount = getPaymentProofCount(inv.paymentProofs ?? inv.payment_proofs)
                                const notesText = extractNotes(rawInvoiceData)
                                const notesExists = notesText.length > 0

                                return (
                                    <div
                                        key={id}
                                        className={clsx(
                                            "group relative grid min-w-0 grid-cols-1 gap-3 px-6 py-4 md:py-5 transition-colors",
                                            INVOICE_GRID_CLASS,
                                            idx % 2 === 0 ? "bg-transparent" : "bg-[var(--bg-elevated)]/15",
                                            isChecked ? "bg-rose-500/5" : "hover:bg-[var(--bg-elevated)]/35"
                                        )}
                                    >
                                        <span className="pointer-events-none absolute left-0 top-0 h-full w-[2px] bg-[var(--accent)] opacity-0 group-hover:opacity-70 transition-opacity" />
                                        {/* Checkbox */}
                                        {canDelete ? (
                                            <div className="flex items-center">
                                                <input
                                                    type="checkbox"
                                                    checked={isChecked}
                                                    onChange={() => toggleSelect(id)}
                                                    className="w-4 h-4 rounded border-[var(--border)] accent-[var(--accent)] cursor-pointer"
                                                />
                                            </div>
                                        ) : <div className="hidden md:block" />}

                                        {/* Invoice No */}
                                        <div className="flex flex-col justify-center min-w-0">
                                            <Link
                                                to="/invoices/$invoiceId"
                                                params={{ invoiceId: String(id) }}
                                                className="font-semibold text-sm text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors truncate uppercase font-sans tracking-tight"
                                                style={{ fontFamily: 'var(--font-body)' }}
                                            >
                                                {invoiceNo}
                                            </Link>
                                            <span className="text-[10px] text-[var(--text-secondary)] font-normal truncate mt-0.5" style={{ fontFamily: 'var(--font-body)' }}>
                                                {clientName}
                                            </span>
                                        </div>

                                        {/* Date */}
                                        <div className="flex items-center justify-center">
                                            <span className="text-[11px] tabular-nums text-[var(--text-muted)] font-sans opacity-90" style={{ fontFamily: 'var(--font-body)' }}>
                                                {date}
                                            </span>
                                        </div>

                                        {/* Status */}
                                        <div className="flex items-center justify-center">
                                            <span className={clsx(
                                                "inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider border shrink-0 whitespace-nowrap",
                                                sc.bg, sc.text, sc.border
                                            )} style={{ fontFamily: 'var(--font-body)' }}>
                                                {sc.label}
                                            </span>
                                        </div>

                                        {/* Proof */}
                                        <div className="flex items-center justify-center">
                                            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text-secondary)] whitespace-nowrap">
                                                <Paperclip size={12} className="text-[var(--text-muted)]" />
                                                {`${proofCount} LEMBAR`}
                                            </span>
                                        </div>

                                        {/* Notes */}
                                        <div className="flex items-center min-w-0">
                                            <span
                                                className={clsx(
                                                    "text-xs truncate font-sans block w-full",
                                                    notesExists
                                                        ? "text-[var(--text-secondary)]"
                                                        : "text-[var(--text-muted)] italic"
                                                )}
                                                style={{ fontFamily: 'var(--font-body)' }}
                                                title={notesExists ? notesText : undefined}
                                            >
                                                {notesExists ? notesText : '-'}
                                            </span>
                                        </div>

                                        {/* Amount */}
                                        <div className="flex items-center justify-end">
                                            <span className="text-sm font-semibold text-[var(--accent)] tracking-tight tabular-nums font-sans" style={{ fontFamily: 'var(--font-body)' }}>
                                                {rupiah(totalAmount)}
                                            </span>
                                        </div>

                                        {/* Actions */}
                                        <div className="relative flex items-center justify-center gap-1.5">
                                            <Link
                                                to="/invoices/$invoiceId"
                                                params={{ invoiceId: String(id) }}
                                                className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)]/40 transition-colors"
                                                title="View"
                                            >
                                                <Eye size={14} />
                                            </Link>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    handleDownloadInvoice(id, invoiceNo)
                                                }}
                                                disabled={!canDownload || downloadingId !== null}
                                                className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)]/40 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                                                title={canDownload ? 'Download PDF' : 'No download access'}
                                                aria-label={`Download ${invoiceNo} PDF`}
                                            >
                                                {downloadingId === id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    setOpenRowMenuId(prev => (prev === id ? null : id))
                                                }}
                                                className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:border-[var(--accent)]/40 transition-colors"
                                                title="More actions"
                                            >
                                                <MoreHorizontal size={16} />
                                            </button>
                                            {canDelete && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        setOpenRowMenuId(null)
                                                        setInvoiceToDelete({ id, invoiceNo })
                                                    }}
                                                    className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-rose-500/20 bg-rose-500/5 text-rose-500 transition-colors hover:bg-rose-500 hover:text-white"
                                                    title="Delete invoice"
                                                    aria-label={`Delete ${invoiceNo}`}
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}

                                            <div
                                                onClick={(e) => e.stopPropagation()}
                                                className={clsx(
                                                    "absolute right-0 top-full mt-1 z-[70] min-w-[156px] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-1.5 origin-top-right transition-all duration-200",
                                                    openRowMenuId === id ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none"
                                                )}
                                            >
                                                <button
                                                    onClick={() => {
                                                        if (!canEditHistory) return
                                                        setOpenRowMenuId(null)
                                                        navigate({ to: '/create', search: { editId: id } })
                                                    }}
                                                    disabled={!canEditHistory}
                                                    className={clsx(
                                                        "w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors",
                                                        canEditHistory
                                                            ? "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                                                            : "text-[var(--text-muted)]/50 cursor-not-allowed"
                                                    )}
                                                >
                                                    <Pencil size={14} />
                                                    {canEditHistory ? 'Edit' : 'Edit (No Access)'}
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        if (!isArchived && !canArchive) return
                                                        setOpenRowMenuId(null)
                                                        archiveMutation.mutate({ id, isArchived: !isArchived })
                                                    }}
                                                    disabled={archiveMutation.isPending || (!isArchived && !canArchive)}
                                                    className={clsx(
                                                        "w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors whitespace-nowrap",
                                                        (!isArchived && !canArchive)
                                                            ? "text-[var(--text-muted)]/50 cursor-not-allowed"
                                                            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                                                    )}
                                                    title={!isArchived && !canArchive ? 'Only paid invoices can be archived' : isArchived ? 'Restore invoice' : 'Archive invoice'}
                                                >
                                                    {isArchived ? <RotateCcw size={14} /> : <Archive size={14} />}
                                                    {isArchived ? 'Unarchive' : 'Archive'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                    </div>

                {/* Pagination */}
                {!listLoading && totalInvoices > 0 && (
                    <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
                        <span className="inline-flex items-center gap-2 text-[10px] font-medium text-[var(--text-muted)] font-sans" style={{ fontFamily: 'var(--font-body)' }}>
                            {hasRefineFilters && `${visibleInvoices.length} matching on this page / `}
                            Showing {(currentPage - 1) * limit + 1}-{Math.min(currentPage * limit, totalInvoices)} of {totalInvoices} invoices
                            {listFetching && <Loader2 size={11} className="animate-spin text-[var(--accent)]" />}
                        </span>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => changePage(currentPage - 1)}
                                disabled={currentPage <= 1 || listFetching}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <ChevronLeft size={13} />
                                Previous
                            </button>
                            <span className="min-w-[78px] text-center text-[10px] font-semibold tabular-nums text-[var(--text-muted)]">
                                Page {currentPage} / {totalPages}
                            </span>
                            <button
                                type="button"
                                onClick={() => changePage(currentPage + 1)}
                                disabled={currentPage >= totalPages || listFetching}
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Next
                                <ChevronRight size={13} />
                            </button>
                        </div>
                    </div>
                )}
                </section>
            </div>

            {/* Delete Selected Confirmation Dialog */}
            {showDeleteConfirm && (
                <>
                    <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(false)} />
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] shadow-2xl max-w-sm w-full p-6 space-y-4">
                            <div className="flex items-center gap-3 text-rose-500">
                                <div className="p-2 bg-rose-500/10 rounded-xl">
                                    <Trash2 size={20} />
                                </div>
                                <h3 className="text-lg font-semibold text-[var(--text-primary)] font-serif font-display">
                                    Delete {selected.size} Invoice{selected.size !== 1 ? 's' : ''}?
                                </h3>
                            </div>
                            <p className="text-sm text-[var(--text-muted)] font-sans" style={{ fontFamily: 'var(--font-body)' }}>
                                This action cannot be undone. The selected invoices and all their data will be permanently removed.
                            </p>
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={() => setShowDeleteConfirm(false)}
                                    className="flex-1 px-4 py-2.5 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors font-sans"
                                    style={{ fontFamily: 'var(--font-body)' }}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleDeleteSelected}
                                    disabled={isDeleting}
                                    className="flex-1 px-4 py-2.5 bg-rose-500 text-white rounded-lg text-sm font-bold hover:bg-rose-600 transition-colors flex items-center justify-center gap-2 font-sans"
                                    style={{ fontFamily: 'var(--font-body)' }}
                                >
                                    {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                    {isDeleting ? 'Deleting...' : 'Yes, Delete'}
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {invoiceToDelete && (
                <>
                    <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={() => setInvoiceToDelete(null)} />
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="w-full max-w-sm space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-2xl">
                            <div className="flex items-center gap-3 text-rose-500">
                                <div className="rounded-xl bg-rose-500/10 p-2">
                                    <Trash2 size={20} />
                                </div>
                                <div>
                                    <h3 className="text-lg font-semibold text-[var(--text-primary)] font-display">
                                        Delete Invoice?
                                    </h3>
                                    <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                                        {invoiceToDelete.invoiceNo}
                                    </p>
                                </div>
                            </div>
                            <p className="text-sm leading-relaxed text-[var(--text-muted)]">
                                This permanently removes the invoice and cannot be undone.
                            </p>
                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setInvoiceToDelete(null)}
                                    disabled={deleteInvoiceMutation.isPending}
                                    className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-2.5 text-sm text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={() => deleteInvoiceMutation.mutate(invoiceToDelete.id)}
                                    disabled={deleteInvoiceMutation.isPending}
                                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-rose-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-rose-600 disabled:opacity-60"
                                >
                                    {deleteInvoiceMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                    {deleteInvoiceMutation.isPending ? 'Deleting...' : 'Delete'}
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
