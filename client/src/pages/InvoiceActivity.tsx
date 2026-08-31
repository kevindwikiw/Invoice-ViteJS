import { memo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useAuth } from '../context/auth'
import { fetchWithAuth } from '../lib/api'
import clsx from 'clsx'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import {
    AuditActionBadge,
    AuditDataState,
    AuditPagination,
    AuditRefine,
    AuditToolbar,
} from '../components/activity/AuditPrimitives'
import { UserAuditPanel } from '../components/activity/UserAuditPanel'
import { SectionHeading } from '../components/SectionHeading'
import { PAGE_SHELL_CLASS, SEGMENT_BUTTON_ACTIVE_CLASS, SEGMENT_BUTTON_BASE_CLASS, SEGMENT_BUTTON_INACTIVE_CLASS, SEGMENT_GROUP_CLASS } from '../constants/uiContract'
import { PANEL_CARD_CLASS } from '../constants/invoice'

type InvoiceActivityEntry = {
    id: number
    invoiceId: number
    invoiceNo?: string | null
    clientName?: string | null
    action: string
    actorId?: number | null
    actorEmail?: string | null
    actorName?: string | null
    actorRole?: string | null
    details?: string | null
    ipAddress?: string | null
    createdAt?: string | null
}

type ActivityStats = {
    total: number
    created: number
    updated: number
    proofs: number
}

type InvoiceActivityPage = {
    items: InvoiceActivityEntry[]
    page: number
    limit: number
    total: number
    totalPages: number
    stats: ActivityStats
}

type InvoiceActivityApiResponse = InvoiceActivityPage | InvoiceActivityEntry[]

const EMPTY_ACTIVITY: InvoiceActivityEntry[] = []

const ACTION_OPTIONS = ['ALL', 'CREATED', 'UPDATED', 'DELETED', 'BATCH_DELETED', 'PROOF_UPLOADED', 'PROOF_DELETED'] as const

const ACTION_LABELS: Record<string, string> = {
    ALL: 'All Logs',
    CREATED: 'Created',
    UPDATED: 'Updated',
    DELETED: 'Deleted',
    BATCH_DELETED: 'Batch Deleted',
    PROOF_UPLOADED: 'Proof Uploaded',
    PROOF_DELETED: 'Proof Deleted',
}

const INVOICE_AUDIT_FILTERS = ACTION_OPTIONS.map((value) => ({
    value,
    label: ACTION_LABELS[value],
}))

const ACTIVITY_TIME_FORMATTER = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta'
})

function formatActivityTime(value?: string | null): string {
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    const formatted = ACTIVITY_TIME_FORMATTER.format(date)
    return `${formatted} WIB`
}

function titleCase(value?: string | null): string {
    if (!value) return '-'
    return value
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
}

function formatDetailKey(value: string): string {
    const normalized = value
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
        .toLowerCase()

    const labels: Record<string, string> = {
        'invoiceno': 'Invoice No',
        'clientname': 'Client Name',
        'totalamount': 'Total Amount',
        'archivestatus': 'Archive Status',
    }

    const compact = normalized.replace(/\s+/g, '')
    if (labels[compact]) return labels[compact]

    return normalized
        .split(' ')
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
}

function truncateValue(value: string, max = 140): string {
    if (value.length <= max) return value
    return `${value.slice(0, max).trimEnd()}...`
}

type ParsedDetail =
    | { type: 'empty' }
    | { type: 'text'; value: string }
    | { type: 'pairs'; value: Array<{ key: string; value: string }> }

function parseDetails(details?: string | null): ParsedDetail {
    if (!details) return { type: 'empty' }
    try {
        const parsed = JSON.parse(details) as Record<string, unknown>
        if (!parsed || typeof parsed !== 'object') return { type: 'text', value: details }
        const entries = Object.entries(parsed).map(([key, value]) => ({
            key: key.replace(/_/g, ' '),
            value: Array.isArray(value) ? value.join(', ') : String(value ?? '-')
        }))
        if (entries.length === 0) return { type: 'empty' }
        return { type: 'pairs', value: entries }
    } catch {
        return { type: 'text', value: details }
    }
}

const ActivityRow = memo(function ActivityRow({ item, index }: { item: InvoiceActivityEntry; index: number }) {
    const invoiceNo = item.invoiceNo || `#${item.invoiceId}`
    const actor = item.actorName || item.actorEmail || 'System'
    const parsed = parseDetails(item.details)

    return (
        <div
            className={clsx(
                "group relative grid grid-cols-1 md:grid-cols-[1.35fr_.95fr_.95fr_1.05fr_2.2fr] gap-3 md:gap-4 px-6 py-4 md:py-5 transition-colors md:items-start",
                index % 2 === 0 ? "bg-transparent" : "bg-[var(--bg-elevated)]/15",
                "hover:bg-[var(--bg-elevated)]/35"
            )}
        >
            <span className="pointer-events-none absolute left-0 top-0 h-full w-[2px] bg-[var(--accent)] opacity-0 group-hover:opacity-70 transition-opacity" />
            <div className="min-w-0">
                <p className="md:hidden text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)] mb-1">Invoice</p>
                <Link
                    to="/invoices/$invoiceId"
                    params={{ invoiceId: String(item.invoiceId) }}
                    className="text-sm font-semibold text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors uppercase tracking-tight"
                >
                    {invoiceNo}
                </Link>
                <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                    {titleCase(item.clientName)}
                </p>
            </div>

            <div className="flex items-center md:items-start pt-0.5">
                <p className="md:hidden text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)] mr-2">Type</p>
                <AuditActionBadge>
                    {(ACTION_LABELS[item.action] || item.action.replaceAll('_', ' ')).toUpperCase()}
                </AuditActionBadge>
            </div>

            <div className="flex items-center text-sm text-[var(--text-secondary)] pt-0.5">
                <p className="md:hidden text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)] mr-2">Actor</p>
                {actor}
            </div>

            <div className="flex items-center text-xs text-[var(--text-muted)] pt-0.5">
                <p className="md:hidden text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)] mr-2">Time</p>
                {formatActivityTime(item.createdAt)}
            </div>

            <div className="text-xs leading-relaxed break-words md:border-l-2 md:border-[var(--border)] md:pl-3">
                <p className="md:hidden text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)] mb-1">Log Details</p>
                {parsed.type === 'empty' && <span className="text-[var(--text-muted)]">-</span>}
                {parsed.type === 'text' && (
                    <span className="text-xs font-medium text-[var(--text-primary)] break-all">
                        {truncateValue(parsed.value)}
                    </span>
                )}
                {parsed.type === 'pairs' && (
                    <div>
                        {parsed.value.map((entry, entryIndex) => {
                            const detailLabel = formatDetailKey(entry.key)
                            return (
                                <div key={`${entry.key}-${entryIndex}`} className="flex items-baseline gap-2 mb-1.5">
                                    <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)] w-28 shrink-0 whitespace-nowrap">
                                        {detailLabel}
                                    </span>
                                    {detailLabel === 'Archive Status' ? (
                                        <span className={clsx(
                                            'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-[0.12em] border whitespace-nowrap',
                                            String(entry.value).toUpperCase() === 'ARCHIVED'
                                                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border-[var(--border)]'
                                                : 'bg-sky-500/10 text-sky-600 border-sky-500/25'
                                        )}>
                                            {String(entry.value).toUpperCase()}
                                        </span>
                                    ) : (
                                        <span className="text-xs font-medium text-[var(--text-primary)] break-all">
                                            {truncateValue(entry.value)}
                                        </span>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
})

export default function InvoiceActivity() {
    const { user } = useAuth()
    const canViewUserAudit = user?.role === 'admin' || user?.role === 'superadmin'
    const [scope, setScope] = useState<'invoice' | 'user'>('invoice')
    const [search, setSearch] = useState('')
    const debouncedSearch = useDebouncedValue(search)
    const [action, setAction] = useState<(typeof ACTION_OPTIONS)[number]>('ALL')
    const [limit, setLimit] = useState(10)
    const [page, setPage] = useState(1)

    const query = useQuery<InvoiceActivityApiResponse>({
        queryKey: ['invoice-activity-list', debouncedSearch, action, limit, page],
        queryFn: async () => {
            const params = new URLSearchParams()
            params.set('limit', String(limit))
            params.set('page', String(page))
            if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
            if (action !== 'ALL') params.set('action', action)

            const res = await fetchWithAuth(`/invoices/activity?${params.toString()}`)
            if (!res.ok) throw new Error('Failed to fetch invoice activity')
            return res.json()
        },
        enabled: scope === 'invoice',
        staleTime: 15_000,
        placeholderData: keepPreviousData,
    })

    const activityResponse = query.data
    const activity = Array.isArray(activityResponse) ? activityResponse : activityResponse?.items ?? EMPTY_ACTIVITY
    const currentPage = Array.isArray(activityResponse) ? 1 : activityResponse?.page ?? page
    const totalPages = Array.isArray(activityResponse) ? 1 : activityResponse?.totalPages ?? 1
    const totalLogs = Array.isArray(activityResponse) ? activity.length : activityResponse?.total ?? 0
    const scopeTabs = (
        <div className={SEGMENT_GROUP_CLASS}>
            <button
                type="button"
                onClick={() => setScope('invoice')}
                className={clsx(SEGMENT_BUTTON_BASE_CLASS, 'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]', scope === 'invoice' ? SEGMENT_BUTTON_ACTIVE_CLASS : SEGMENT_BUTTON_INACTIVE_CLASS)}
            >
                Invoice activity
            </button>
            {canViewUserAudit && (
                <button
                    type="button"
                    onClick={() => setScope('user')}
                    className={clsx(SEGMENT_BUTTON_BASE_CLASS, 'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]', scope === 'user' ? SEGMENT_BUTTON_ACTIVE_CLASS : SEGMENT_BUTTON_INACTIVE_CLASS)}
                >
                    User activity
                </button>
            )}
        </div>
    )

    return (
        <div className={PAGE_SHELL_CLASS}>
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <h1 className="mb-2 font-display text-2xl font-medium tracking-tight text-[var(--text-primary)] sm:text-3xl md:text-4xl">
                            Audit Logs
                        </h1>
                        <p className="label-xs font-sans text-[var(--text-muted)]">
                            STANDARD OPERATING PROCEDURE: INVOICE &amp; USER ACTIVITY AUDIT TRAIL
                        </p>
                    </div>
                </header>

                <section className={`${PANEL_CARD_CLASS} space-y-6 overflow-visible`}>
                    {scope === 'invoice' ? <>
                    <AuditToolbar
                        leading={scopeTabs}
                        actions={[]}
                        activeAction={action}
                        search={search}
                        searchPlaceholder="Search invoice activity..."
                        onActionChange={(value) => {
                            setAction(value as (typeof ACTION_OPTIONS)[number])
                            setPage(1)
                        }}
                        onSearchChange={(value) => {
                            setSearch(value)
                            setPage(1)
                        }}
                        trailing={(
                            <AuditRefine
                                limit={limit}
                                actions={INVOICE_AUDIT_FILTERS}
                                activeAction={action}
                                onActionChange={(value) => {
                                    setAction(value as (typeof ACTION_OPTIONS)[number])
                                    setPage(1)
                                }}
                                onLimitChange={(value) => {
                                    setLimit(value)
                                    setPage(1)
                                }}
                            />
                        )}
                    />

                    <SectionHeading
                        title="All Invoice Activity"
                        subtitle={`INVOICE AUDIT RECORDS (${activity.length} SHOWN / ${totalLogs} TOTAL)`}
                    />

                    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/10 md:overflow-x-auto">
                        <div className="md:min-w-[980px]">
                            <div className="hidden md:grid grid-cols-[1.35fr_.95fr_.95fr_1.05fr_2.2fr] gap-4 px-6 py-3.5 border-b border-[var(--border)] bg-[var(--bg-elevated)]/30">
                                {['Invoice', 'Log Type', 'Actor', 'Timestamp', 'Log Details'].map((header) => (
                                    <div
                                        key={header}
                                        className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]"
                                    >
                                        {header}
                                    </div>
                                ))}
                            </div>

                            <AuditDataState
                                loading={query.isLoading}
                                error={query.isError}
                                empty={activity.length === 0}
                                emptyTitle="No invoice activity"
                                emptyDescription="Try changing the search or activity filter."
                            >
                                <div className="divide-y divide-[var(--border)]/60">
                                    {activity.map((item, index) => (
                                        <ActivityRow key={item.id} item={item} index={index} />
                                    ))}
                                </div>
                            </AuditDataState>
                        </div>
                    </div>

                    <AuditPagination
                        page={currentPage}
                        totalPages={totalPages}
                        total={totalLogs}
                        limit={limit}
                        fetching={query.isFetching}
                        onPageChange={setPage}
                    />
                    </> : (
                        <UserAuditPanel enabled={scope === 'user' && canViewUserAudit} leading={scopeTabs} />
                    )}
                </section>
            </div>
        </div>
    )
}
