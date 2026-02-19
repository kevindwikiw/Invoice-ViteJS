import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { fetchWithAuth, useAuth } from '../context/auth'
import { useToast } from '../context/ToastContext'
import {
    Search, FileClock, Eye, Pencil, Trash2, Loader2,
    CheckCircle2, Clock, AlertCircle, DollarSign
} from 'lucide-react'
import clsx from 'clsx'

// ─── Helpers ─────────────────────────────────────────────────

const rupiah = (val: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val)

type PaymentTerm = { id?: string; label?: string; amount?: number }

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
    LUNAS: { label: 'LUNAS', bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30' },
    DP: { label: 'DP', bg: 'bg-sky-500/15', text: 'text-sky-400', border: 'border-sky-500/30' },
    'DP+TERMIN': { label: 'DP+TERMIN', bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' },
    UNPAID: { label: 'UNPAID', bg: 'bg-zinc-500/15', text: 'text-zinc-400', border: 'border-zinc-500/30' },
}

// ─── Component ───────────────────────────────────────────────

export default function InvoiceHistory() {
    const [search, setSearch] = useState('')
    const [limit, setLimit] = useState(25)
    const [selected, setSelected] = useState<Set<number>>(new Set())
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    const { addToast } = useToast()
    const { hasPermission } = useAuth()

    const canDelete = hasPermission('delete_history')

    const { data: stats, isLoading: statsLoading } = useQuery({
        queryKey: ['invoices', 'stats'],
        queryFn: async () => {
            const res = await fetchWithAuth('/invoices/stats')
            if (!res.ok) throw new Error('Failed to fetch stats')
            return res.json()
        },
        staleTime: 30_000,
    })

    const { data: invoices = [], isLoading: listLoading } = useQuery({
        queryKey: ['invoices', search, limit],
        queryFn: async () => {
            const params = new URLSearchParams()
            if (search) params.set('search', search)
            params.set('limit', String(limit))
            const res = await fetchWithAuth(`/invoices?${params}`)
            if (!res.ok) throw new Error('Failed to fetch invoices')
            return res.json()
        },
        staleTime: 15_000,
    })

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
        if (selected.size === invoices.length) {
            setSelected(new Set())
        } else {
            setSelected(new Set(invoices.map((inv: any) => inv.id)))
        }
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
        } catch (err: any) {
            addToast(err.message || 'Failed to delete', 'error')
        } finally {
            setIsDeleting(false)
            setShowDeleteConfirm(false)
        }
    }

    const allSelected = invoices.length > 0 && selected.size === invoices.length
    const someSelected = selected.size > 0

    return (
        <div className="min-h-screen bg-[var(--bg-deep)] p-4 md:p-8">
            <div className="max-w-7xl mx-auto space-y-6">

                {/* Header */}
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2.5 bg-[var(--accent-muted)] rounded-xl">
                        <FileClock className="h-8 w-8 text-[var(--accent)]" />
                    </div>
                    <div>
                        <h1 className="text-4xl text-[var(--text-primary)] mb-1" style={{ fontFamily: 'var(--font-display)' }}>
                            Invoice History
                        </h1>
                        <p className="text-sm text-[var(--text-muted)]">View and manage your saved invoices</p>
                    </div>
                </div>

                {/* KPI Stats Bar */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <StatCard
                        icon={<DollarSign size={18} />}
                        label="Revenue (Shown)"
                        value={statsLoading ? '...' : rupiah(stats?.totalRevenue || 0)}
                        accent="text-emerald-400"
                        colSpan
                    />
                    <StatCard
                        icon={<FileClock size={18} />}
                        label="Total Invoices"
                        value={statsLoading ? '...' : String(stats?.total || 0)}
                        accent="text-[var(--text-primary)]"
                    />
                    <StatCard
                        icon={<CheckCircle2 size={18} />}
                        label="LUNAS"
                        value={statsLoading ? '...' : String(stats?.lunas || 0)}
                        accent="text-emerald-400"
                    />
                    <StatCard
                        icon={<Clock size={18} />}
                        label="DP / CICIL"
                        value={statsLoading ? '...' : String(stats?.dp || 0)}
                        accent="text-sky-400"
                    />
                    <StatCard
                        icon={<AlertCircle size={18} />}
                        label="UNPAID"
                        value={statsLoading ? '...' : String(stats?.unpaid || 0)}
                        accent="text-zinc-400"
                    />
                </div>

                {/* Search + Limit + Batch Actions */}
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1 relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                        <input
                            type="text"
                            placeholder="Search by invoice no or client name..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)] transition-all"
                        />
                    </div>
                    <select
                        value={limit}
                        onChange={e => setLimit(Number(e.target.value))}
                        className="px-3 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                    >
                        <option value={10}>Show 10</option>
                        <option value={25}>Show 25</option>
                        <option value={50}>Show 50</option>
                        <option value={100}>Show 100</option>
                    </select>
                </div>

                {/* Selection Actions Bar */}
                {someSelected && canDelete && (
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-lg animate-in fade-in slide-in-from-top-2">
                        <span className="text-sm text-red-400 font-medium">
                            {selected.size} selected
                        </span>
                        <div className="flex-1" />
                        <button
                            onClick={() => setSelected(new Set())}
                            className="px-3 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                        >
                            Clear
                        </button>
                        <button
                            onClick={() => setShowDeleteConfirm(true)}
                            className="px-4 py-1.5 bg-red-500 text-white text-xs font-bold rounded-md hover:bg-red-600 transition-colors flex items-center gap-1.5"
                        >
                            <Trash2 size={13} />
                            Delete Selected
                        </button>
                    </div>
                )}

                {/* Table */}
                <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-hidden shadow-lg">
                    {/* Table Header */}
                    <div className="hidden md:grid grid-cols-[auto_2fr_1.5fr_1fr_1fr_1.2fr_auto] gap-4 px-5 py-3 bg-[var(--bg-elevated)] border-b border-[var(--border)]">
                        {/* Checkbox header */}
                        {canDelete ? (
                            <div className="flex items-center">
                                <input
                                    type="checkbox"
                                    checked={allSelected}
                                    onChange={toggleSelectAll}
                                    className="w-4 h-4 rounded border-[var(--border)] accent-[var(--accent)] cursor-pointer"
                                />
                            </div>
                        ) : <div />}
                        {['Invoice No', 'Client', 'Status', 'Date', 'Amount', 'Actions'].map(h => (
                            <div key={h} className={clsx(
                                "text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]",
                                h === 'Amount' && 'text-right',
                                h === 'Actions' && 'text-center'
                            )}>
                                {h}
                            </div>
                        ))}
                    </div>

                    {/* Rows */}
                    {listLoading ? (
                        <div className="flex items-center justify-center py-20 gap-3">
                            <Loader2 size={20} className="animate-spin text-[var(--accent)]" />
                            <span className="text-sm text-[var(--text-muted)]">Loading invoices...</span>
                        </div>
                    ) : invoices.length === 0 ? (
                        <div className="text-center py-20 text-[var(--text-muted)]">
                            <FileClock className="mx-auto mb-3 opacity-30" size={40} />
                            <p className="text-sm">No invoices found</p>
                            <p className="text-xs mt-1">Create your first invoice to get started!</p>
                        </div>
                    ) : (
                        <div>
                            {invoices.map((inv: any) => {
                                const status = deriveStatus(inv.invoiceData || inv.invoice_data)
                                const sc = statusConfig[status]
                                const totalAmount = inv.totalAmount ?? inv.total_amount ?? 0
                                const invoiceNo = inv.invoiceNo ?? inv.invoice_no ?? '-'
                                const clientName = inv.clientName ?? inv.client_name ?? '-'
                                const date = inv.date ?? '-'
                                const id = inv.id
                                const isChecked = selected.has(id)

                                return (
                                    <div
                                        key={id}
                                        className={clsx(
                                            "grid grid-cols-1 md:grid-cols-[auto_2fr_1.5fr_1fr_1fr_1.2fr_auto] gap-2 md:gap-4 px-5 py-3.5 border-b border-[var(--border)] last:border-b-0 transition-colors group",
                                            isChecked ? "bg-red-500/5" : "hover:bg-[var(--bg-hover)]"
                                        )}
                                    >
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
                                        <div className="flex items-center gap-2">
                                            <Link
                                                to="/invoices/$invoiceId"
                                                params={{ invoiceId: String(id) }}
                                                className="font-bold text-sm text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors truncate"
                                            >
                                                {invoiceNo}
                                            </Link>
                                        </div>

                                        {/* Client */}
                                        <div className="flex items-center">
                                            <span className="text-sm text-[var(--text-secondary)] truncate">{clientName}</span>
                                        </div>

                                        {/* Status */}
                                        <div className="flex items-center">
                                            <span className={clsx(
                                                "inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border",
                                                sc.bg, sc.text, sc.border
                                            )}>
                                                {sc.label}
                                            </span>
                                        </div>

                                        {/* Date */}
                                        <div className="flex items-center">
                                            <span className="text-sm text-[var(--text-muted)] font-mono">{date}</span>
                                        </div>

                                        {/* Amount */}
                                        <div className="flex items-center md:justify-end">
                                            <span className="text-sm font-bold text-[var(--text-primary)] tracking-tight">
                                                {rupiah(totalAmount)}
                                            </span>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-1">
                                            <Link
                                                to="/invoices/$invoiceId"
                                                params={{ invoiceId: String(id) }}
                                                className="p-1.5 rounded-md hover:bg-[var(--accent-muted)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                                                title="View"
                                            >
                                                <Eye size={15} />
                                            </Link>
                                            <button
                                                onClick={() => navigate({ to: '/create', search: { editId: id } })}
                                                className="p-1.5 rounded-md hover:bg-blue-500/10 text-[var(--text-muted)] hover:text-blue-400 transition-colors"
                                                title="Edit"
                                            >
                                                <Pencil size={15} />
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>

                {/* Row count */}
                {!listLoading && invoices.length > 0 && (
                    <p className="text-xs text-[var(--text-muted)] text-right">
                        Showing {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
                    </p>
                )}
            </div>

            {/* Delete Selected Confirmation Dialog */}
            {showDeleteConfirm && (
                <>
                    <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(false)} />
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] shadow-2xl max-w-sm w-full p-6 space-y-4">
                            <div className="flex items-center gap-3 text-red-400">
                                <div className="p-2 bg-red-500/10 rounded-xl">
                                    <Trash2 size={20} />
                                </div>
                                <h3 className="text-lg font-bold text-[var(--text-primary)]">
                                    Delete {selected.size} Invoice{selected.size !== 1 ? 's' : ''}?
                                </h3>
                            </div>
                            <p className="text-sm text-[var(--text-muted)]">
                                This action cannot be undone. The selected invoices and all their data will be permanently removed.
                            </p>
                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={() => setShowDeleteConfirm(false)}
                                    className="flex-1 px-4 py-2.5 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleDeleteSelected}
                                    disabled={isDeleting}
                                    className="flex-1 px-4 py-2.5 bg-red-500 text-white rounded-lg text-sm font-bold hover:bg-red-600 transition-colors flex items-center justify-center gap-2"
                                >
                                    {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                    {isDeleting ? 'Deleting...' : 'Yes, Delete'}
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}

// ─── Sub Components ──────────────────────────────────────────

function StatCard({ icon, label, value, accent, colSpan }: {
    icon: React.ReactNode
    label: string
    value: string
    accent: string
    colSpan?: boolean
}) {
    return (
        <div className={clsx(
            "bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 flex flex-col gap-1.5 hover:border-[var(--accent)]/30 transition-colors",
            colSpan && "col-span-2 md:col-span-1"
        )}>
            <div className="flex items-center gap-2 text-[var(--text-muted)]">
                {icon}
                <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
            </div>
            <span className={clsx("text-xl font-black tracking-tight", accent)}>
                {value}
            </span>
        </div>
    )
}
