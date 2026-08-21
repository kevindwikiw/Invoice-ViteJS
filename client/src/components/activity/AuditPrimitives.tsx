import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Filter, Loader2, Search } from 'lucide-react';
import clsx from 'clsx';

export interface AuditFilterOption {
    value: string;
    label: string;
}

interface AuditToolbarProps {
    actions: AuditFilterOption[];
    activeAction: string;
    search: string;
    searchPlaceholder?: string;
    onActionChange: (value: string) => void;
    onSearchChange: (value: string) => void;
    trailing?: ReactNode;
    leading?: ReactNode;
}

export function AuditToolbar({
    actions,
    activeAction,
    search,
    searchPlaceholder = 'Search activity...',
    onActionChange,
    onSearchChange,
    trailing,
    leading,
}: AuditToolbarProps) {
    return (
        <div className="relative z-[80] flex flex-col gap-4 border-b border-[var(--border)] pb-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 items-center gap-1 overflow-x-auto no-scrollbar">
                {leading}
                {actions.map((action) => (
                    <button
                        key={action.value}
                        type="button"
                        onClick={() => onActionChange(action.value)}
                        className={clsx(
                            'shrink-0 rounded-md px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors',
                            activeAction === action.value
                                ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]'
                                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
                        )}
                    >
                        {action.label}
                    </button>
                ))}
            </div>
            <div className="flex w-full items-center gap-3 xl:w-auto xl:flex-1 xl:justify-end">
                {trailing}
                <div className="relative min-w-0 flex-1 xl:w-[280px] xl:flex-none">
                    <label className="sr-only" htmlFor="audit-search">Search activity</label>
                    <Search
                        size={14}
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                    />
                    <input
                        id="audit-search"
                        type="search"
                        value={search}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder={searchPlaceholder}
                        className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-deep)] px-4 py-2.5 text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
                        style={{ height: '40px', paddingLeft: '2.5rem' }}
                    />
                </div>
            </div>
        </div>
    );
}

interface AuditActionBadgeProps {
    children: ReactNode;
    tone?: 'neutral' | 'positive' | 'warning' | 'danger';
}

export function AuditActionBadge({
    children,
    tone = 'neutral',
}: AuditActionBadgeProps) {
    const tones = {
        neutral: 'border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]',
        positive: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
        warning: 'border-amber-500/25 bg-amber-500/10 text-amber-400',
        danger: 'border-rose-500/25 bg-rose-500/10 text-rose-400',
    };

    return (
        <span className={clsx(
            'inline-flex rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em]',
            tones[tone],
        )}>
            {children}
        </span>
    );
}

interface AuditDataStateProps {
    loading?: boolean;
    error?: boolean;
    empty?: boolean;
    emptyTitle?: string;
    emptyDescription?: string;
    children: ReactNode;
}

export function AuditDataState({
    loading,
    error,
    empty,
    emptyTitle = 'No activity found',
    emptyDescription = 'Try changing the search or filter.',
    children,
}: AuditDataStateProps) {
    if (loading) {
        return (
            <div className="flex items-center justify-center gap-3 py-20 text-[var(--text-muted)]">
                <Loader2 size={18} className="animate-spin text-[var(--accent)]" />
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">Loading activity</span>
            </div>
        );
    }
    if (error) {
        return (
            <div className="py-20 text-center">
                <p className="text-sm font-medium text-rose-400">Unable to load activity.</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">Refresh the page to try again.</p>
            </div>
        );
    }
    if (empty) {
        return (
            <div className="py-20 text-center">
                <p className="text-sm font-medium text-[var(--text-primary)]">{emptyTitle}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{emptyDescription}</p>
            </div>
        );
    }
    return <>{children}</>;
}


interface AuditPaginationProps {
    page: number;
    totalPages: number;
    total: number;
    limit: number;
    fetching?: boolean;
    onPageChange: (page: number) => void;
}

export function AuditPagination({
    page,
    totalPages,
    total,
    limit,
    fetching,
    onPageChange,
}: AuditPaginationProps) {
    if (total <= 0) return null;
    const firstItem = (page - 1) * limit + 1;
    const lastItem = Math.min(page * limit, total);

    return (
        <div className="flex flex-col gap-3 border-t border-[var(--border)] px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="inline-flex items-center gap-2 text-[10px] font-medium text-[var(--text-muted)]">
                Showing {firstItem}-{lastItem} of {total} logs
                {fetching && <Loader2 size={11} className="animate-spin text-[var(--accent)]" />}
            </span>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => onPageChange(page - 1)}
                    disabled={page <= 1 || fetching}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                    <ChevronLeft size={13} />
                    Previous
                </button>
                <span className="min-w-[78px] text-center text-[10px] font-semibold tabular-nums text-[var(--text-muted)]">
                    Page {page} / {totalPages}
                </span>
                <button
                    type="button"
                    onClick={() => onPageChange(page + 1)}
                    disabled={page >= totalPages || fetching}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                    Next
                    <ChevronRight size={13} />
                </button>
            </div>
        </div>
    );
}

export function AuditRefine({
    limit,
    onLimitChange,
    actions = [],
    activeAction,
    onActionChange,
}: {
    limit: number;
    onLimitChange: (limit: number) => void;
    actions?: AuditFilterOption[];
    activeAction?: string;
    onActionChange?: (value: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const refineRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const close = (event: MouseEvent) => {
            if (refineRef.current && !refineRef.current.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, []);

    return (
        <div className="relative shrink-0" ref={refineRef}>
            <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-4 label-xs text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)]/40">
                <Filter size={13} />
                Refine
            </button>
            <div className={clsx('absolute left-0 top-full z-[999] mt-2 w-[min(calc(100vw-3rem),18rem)] rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3 origin-top-left shadow-xl transition-all duration-200', open ? 'pointer-events-auto scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0')}>
                <div className="space-y-3">
                    {actions.length > 0 && activeAction && onActionChange && (
                        <label className="block text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">
                            Log type
                            <select value={activeAction} onChange={(event) => onActionChange(event.target.value)} className="mt-1 w-full appearance-none rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2 pr-8 text-xs text-[var(--text-secondary)] outline-none transition-colors focus:border-[var(--accent)]">
                                {actions.map((action) => <option key={action.value} value={action.value}>{action.label}</option>)}
                            </select>
                        </label>
                    )}
                    <label className="block text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">
                        Rows
                        <select aria-label="Rows per page" value={limit} onChange={(event) => onLimitChange(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none">
                            {[10, 25, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                    </label>
                    <button type="button" onClick={() => { onActionChange?.('ALL'); onLimitChange(25); }} className="w-full py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text-primary)]">Reset Refine</button>
                </div>
            </div>
        </div>
    );
}
