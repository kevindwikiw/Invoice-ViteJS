import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { AlertCircle, ArrowUpRight, Check, ChevronLeft, ChevronRight, ImageIcon, Loader2, RotateCcw, Search, Star, X } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../context/auth';
import { useToast } from '../context/ToastContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { PANEL_CARD_CLASS } from '../constants/invoice';
import { PAGE_SHELL_CLASS, SEGMENT_BUTTON_ACTIVE_CLASS, SEGMENT_BUTTON_BASE_CLASS, SEGMENT_BUTTON_INACTIVE_CLASS, SEGMENT_GROUP_CLASS } from '../constants/uiContract';
import { SectionHeading } from '../components/SectionHeading';
import { fetchFeedbackPhoto, useFeedbackQuery, useUpdateFeedbackStatusMutation, type FeedbackItem, type FeedbackStatus } from '../features/feedback/data';

const PAGE_SIZE = 10;
const TABLE_COLUMNS = 'minmax(190px,1.1fr) 120px minmax(340px,2fr) 120px 170px';
const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const RATING_LABELS = ['Very poor', 'Needs improvement', 'Good', 'Great', 'Excellent'] as const;

function feedbackTags(item: FeedbackItem): string[] {
    return Array.isArray(item.tags) ? item.tags : [];
}

function ratingTone(rating: number): string {
    if (rating <= 2) return 'border-rose-500/25 bg-rose-500/10 text-rose-400';
    if (rating === 3) return 'border-amber-500/25 bg-amber-500/10 text-amber-500';
    return 'border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]';
}

function RatingBadge({ rating, detailed = false }: { rating: number; detailed?: boolean }) {
    const label = RATING_LABELS[Math.min(5, Math.max(1, rating)) - 1];
    return (
        <span className={clsx('inline-flex w-fit items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-semibold', ratingTone(rating))}>
            <Star size={12} fill="currentColor" />
            {rating}/5{detailed ? ` · ${label}` : ''}
        </span>
    );
}

function FeedbackSummary({ summary }: { summary: NonNullable<ReturnType<typeof useFeedbackQuery>['data']>['summary'] | undefined }) {
    const safe = summary ?? { total: 0, newCount: 0, averageRating: 0, ratingCounts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    return (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-[var(--border)] px-5 py-3.5 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)] md:px-7">
            <span><strong className="mr-1.5 text-sm font-semibold tracking-normal text-[var(--text-primary)]">{safe.total}</strong>responses</span>
            <span><strong className="mr-1.5 text-sm font-semibold tracking-normal text-sky-400">{safe.newCount}</strong>new</span>
            <span><strong className="mr-1.5 text-sm font-semibold tracking-normal text-[var(--accent)]">{safe.averageRating ? safe.averageRating.toFixed(1) : '—'}</strong>average</span>
            <span className="flex flex-wrap items-center gap-2" aria-label="Rating distribution">
                {[5, 4, 3, 2, 1].map((rating) => (
                    <span key={rating} className="inline-flex items-center gap-1 tracking-normal">
                        <span className={clsx('h-1.5 w-1.5 rounded-full', rating >= 4 ? 'bg-[var(--accent)]' : rating === 3 ? 'bg-amber-500' : 'bg-rose-400')} />
                        {rating}★ {safe.ratingCounts[rating as 1 | 2 | 3 | 4 | 5]}
                    </span>
                ))}
            </span>
        </div>
    );
}

function FeedbackPhoto({ item }: { item: FeedbackItem }) {
    const [photoUrl, setPhotoUrl] = useState('');
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        let objectUrl = '';
        void fetchFeedbackPhoto(item.id)
            .then((blob) => {
                if (cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                setPhotoUrl(objectUrl);
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [item.id]);

    if (failed) return <p className="mt-3 text-xs text-rose-400">Unable to load the private photo.</p>;
    if (!photoUrl) return <div className="mt-3 flex h-40 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)]"><Loader2 size={18} className="animate-spin" /></div>;
    return <img src={photoUrl} alt={`Photo shared by ${item.clientName || 'an anonymous client'}`} className="mt-3 max-h-[420px] w-full rounded-xl border border-[var(--border)] object-contain" />;
}

type DrawerProps = {
    item: FeedbackItem | null;
    pending: boolean;
    closeButtonRef: React.RefObject<HTMLButtonElement | null>;
    drawerRef: React.RefObject<HTMLElement | null>;
    onClose: () => void;
    onToggleStatus: (item: FeedbackItem) => void;
};

function FeedbackDrawer({ item, pending, closeButtonRef, drawerRef, onClose, onToggleStatus }: DrawerProps) {
    const hasWrittenNote = item?.message && item.message !== 'Rating and highlights only' && item.message !== 'Rating only';
    const tags = item ? feedbackTags(item) : [];
    return (
        <div className={clsx('fixed inset-0 z-[90]', item ? 'pointer-events-auto' : 'pointer-events-none')} aria-hidden={!item}>
            <button type="button" tabIndex={item ? 0 : -1} aria-label="Close feedback details" onClick={onClose} className={clsx('absolute inset-0 bg-black/55 transition-opacity duration-200', item ? 'opacity-100' : 'opacity-0')} />
            <aside ref={drawerRef} role={item ? 'dialog' : undefined} aria-modal={item ? 'true' : undefined} aria-labelledby={item ? 'feedback-drawer-title' : undefined} className={clsx('absolute inset-y-0 right-0 flex w-full flex-col border-l border-[var(--border)] bg-[var(--bg-deep)] shadow-2xl transition-transform duration-200 ease-out sm:w-[440px]', item ? 'translate-x-0' : 'translate-x-full')}>
                {item && (
                    <>
                        <header className="flex items-start justify-between gap-6 border-b border-[var(--border)] px-6 py-6">
                            <div>
                                <p className="label-xs text-[var(--accent)]">CLIENT RESPONSE</p>
                                <h2 id="feedback-drawer-title" className="mt-2 font-display text-2xl font-medium text-[var(--text-primary)]">{item?.clientName || 'Anonymous response'}</h2>
                            </div>
                            <button ref={closeButtonRef} type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:border-[var(--accent)]/40 hover:text-[var(--text-primary)]" aria-label="Close feedback detail"><X size={17} /></button>
                        </header>

                        <div className="flex-1 overflow-y-auto px-6 py-7">
                            <div className="flex flex-wrap items-center gap-2">
                                <RatingBadge rating={item.rating} detailed />
                                <span className={clsx('rounded-md border px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-[0.14em]', item.status === 'new' ? 'border-sky-500/25 bg-sky-500/10 text-sky-400' : 'border-[var(--border)] text-[var(--text-muted)]')}>{item.status}</span>
                            </div>

                            {tags.length > 0 && (
                                <div className="mt-8">
                                    <p className="label-xs text-[var(--text-muted)]">HIGHLIGHTS</p>
                                    <div className="mt-3 flex flex-wrap gap-2">{tags.map((tag) => <span key={tag} className="rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-1.5 text-[10px] font-semibold text-[var(--accent)]">{tag}</span>)}</div>
                                </div>
                            )}

                            {hasWrittenNote && (
                                <div className="mt-8 border-l-2 border-[var(--accent)] pl-5">
                                    <p className="label-xs text-[var(--text-muted)]">NOTE</p>
                                    <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-[var(--text-primary)]">{item.message}</p>
                                </div>
                            )}

                            {item.hasPhoto && (
                                <div className="mt-8">
                                    <p className="flex items-center gap-2 label-xs text-[var(--text-muted)]"><ImageIcon size={13} />PRIVATE PHOTO</p>
                                    <FeedbackPhoto key={item.id} item={item} />
                                </div>
                            )}

                            <dl className="mt-9 divide-y divide-[var(--border)] border-y border-[var(--border)]">
                                <div className="grid grid-cols-[110px_1fr] gap-4 py-4">
                                    <dt className="label-xs text-[var(--text-muted)]">Submitted</dt>
                                    <dd className="text-right text-xs text-[var(--text-secondary)]">{DATE_FORMATTER.format(new Date(item.createdAt))}</dd>
                                </div>
                                {item.invoiceId && (
                                    <div className="grid grid-cols-[110px_1fr] gap-4 py-4">
                                        <dt className="label-xs text-[var(--text-muted)]">Invoice</dt>
                                        <dd className="min-w-0 text-right">
                                            <Link to="/invoices/$invoiceId" params={{ invoiceId: String(item.invoiceId) }} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)] hover:underline">
                                                <span className="truncate">{item.invoiceNo}</span><ArrowUpRight size={13} />
                                            </Link>
                                        </dd>
                                    </div>
                                )}
                                {item.reviewedAt && (
                                    <div className="grid grid-cols-[110px_1fr] gap-4 py-4">
                                        <dt className="label-xs text-[var(--text-muted)]">Reviewed</dt>
                                        <dd className="text-right text-xs text-[var(--text-secondary)]">{DATE_FORMATTER.format(new Date(item.reviewedAt))}</dd>
                                    </div>
                                )}
                            </dl>
                        </div>

                        <footer className="border-t border-[var(--border)] bg-[var(--bg-card)] px-6 py-5">
                            <button type="button" disabled={pending} onClick={() => onToggleStatus(item)} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--bg-deep)] transition-opacity hover:opacity-90 disabled:opacity-45">
                                {pending ? <Loader2 size={14} className="animate-spin" /> : item.status === 'new' ? <Check size={14} /> : <RotateCcw size={14} />}
                                {item.status === 'new' ? 'Mark reviewed' : 'Reopen feedback'}
                            </button>
                        </footer>
                    </>
                )}
            </aside>
        </div>
    );
}

export default function FeedbackInbox() {
    const { user } = useAuth();
    const { addToast } = useToast();
    const canView = user?.role === 'admin' || user?.role === 'superadmin';
    const [status, setStatus] = useState<'all' | FeedbackStatus>('new');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(null);
    const drawerRef = useRef<HTMLElement | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement | null>(null);
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const debouncedSearch = useDebouncedValue(search);
    const filters = useMemo(() => ({ status, search: debouncedSearch, page, limit: PAGE_SIZE }), [debouncedSearch, page, status]);
    const feedbackQuery = useFeedbackQuery(filters, canView);
    const statusMutation = useUpdateFeedbackStatusMutation();
    const total = feedbackQuery.data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    useEffect(() => {
        if (!selectedFeedback) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        closeButtonRef.current?.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setSelectedFeedback(null);
                return;
            }
            if (event.key !== 'Tab' || !drawerRef.current) return;
            const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'));
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKeyDown);
            returnFocusRef.current?.focus();
        };
    }, [selectedFeedback]);

    if (!canView || !user) {
        return (
            <div className={PAGE_SHELL_CLASS}>
                <div className="mx-auto max-w-7xl border border-[var(--border)] bg-[var(--bg-card)] px-6 py-20 text-center">
                    <AlertCircle size={32} className="mx-auto mb-4 text-rose-400" />
                    <h1 className="font-display text-xl font-semibold text-[var(--text-primary)]">Access denied</h1>
                    <p className="mt-2 text-sm text-[var(--text-muted)]">Only administrators can review client feedback.</p>
                </div>
            </div>
        );
    }

    const openDrawer = (item: FeedbackItem, trigger: HTMLElement) => {
        returnFocusRef.current = trigger;
        setSelectedFeedback(item);
    };

    const updateStatus = (item: FeedbackItem) => {
        const nextStatus: FeedbackStatus = item.status === 'new' ? 'reviewed' : 'new';
        statusMutation.mutate({ id: item.id, status: nextStatus }, {
            onSuccess: () => {
                setSelectedFeedback(null);
                addToast(nextStatus === 'reviewed' ? 'Feedback marked as reviewed.' : 'Feedback returned to New.', 'success');
            },
            onError: (mutationError) => addToast(mutationError instanceof Error ? mutationError.message : 'Unable to update feedback.', 'error'),
        });
    };

    const handleRowKey = (event: React.KeyboardEvent<HTMLElement>, item: FeedbackItem) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openDrawer(item, event.currentTarget);
    };

    return (
        <div className={PAGE_SHELL_CLASS}>
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="mb-10">
                    <h1 className="mb-2 font-display text-2xl font-medium tracking-tight text-[var(--text-primary)] sm:text-3xl md:text-4xl">Feedback Inbox</h1>
                    <p className="label-xs font-sans text-[var(--text-muted)]">STANDARD OPERATING PROCEDURE: CLIENT EXPERIENCE REVIEW</p>
                </header>

                <section className={`${PANEL_CARD_CLASS} overflow-hidden !p-0`}>
                    <div className="flex flex-col gap-4 border-b border-[var(--border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-7">
                        <div className={SEGMENT_GROUP_CLASS}>
                            {(['all', 'new', 'reviewed'] as const).map((option) => (
                                <button key={option} type="button" onClick={() => { setStatus(option); setPage(1); }} className={clsx(SEGMENT_BUTTON_BASE_CLASS, status === option ? SEGMENT_BUTTON_ACTIVE_CLASS : SEGMENT_BUTTON_INACTIVE_CLASS)}>
                                    {option === 'all' ? 'All' : option === 'new' ? `New${feedbackQuery.data?.summary.newCount ? ` ${feedbackQuery.data.summary.newCount}` : ''}` : 'Reviewed'}
                                </button>
                            ))}
                        </div>
                        <div className="relative w-full sm:max-w-xs">
                            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                            <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search names, tags, or notes..." aria-label="Search feedback" className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-deep)] text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]" style={{ paddingLeft: '2.75rem', paddingRight: '1rem' }} />
                        </div>
                    </div>

                    <div className="border-b border-[var(--border)] px-5 py-6 md:px-7">
                        <SectionHeading title="Client Feedback" subtitle={`${feedbackQuery.data?.items.length ?? 0} SHOWN / ${total} MATCHING`} />
                    </div>
                    <FeedbackSummary summary={feedbackQuery.data?.summary} />

                    {feedbackQuery.isLoading ? (
                        <div className="py-20 text-center text-xs text-[var(--text-muted)]">Loading feedback...</div>
                    ) : feedbackQuery.isError ? (
                        <div className="py-20 text-center text-sm text-rose-400">Unable to load feedback.</div>
                    ) : !feedbackQuery.data?.items.length ? (
                        <div className="py-20 text-center"><p className="font-display text-xl text-[var(--text-primary)]">No feedback found</p><p className="mt-2 text-xs text-[var(--text-muted)]">Try another filter or search term.</p></div>
                    ) : (
                        <>
                            <div className="hidden overflow-x-auto lg:block">
                                <div className="min-w-[980px]">
                                    <div className="grid border-b border-[var(--border)] px-7 py-3.5 text-center text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]" style={{ gridTemplateColumns: TABLE_COLUMNS }}>
                                        <span className="text-left">Client</span><span>Rating</span><span className="text-left">Highlights &amp; Note</span><span>Status</span><span>Submitted</span>
                                    </div>
                                    {feedbackQuery.data.items.map((item) => (
                                        <div key={item.id} role="button" tabIndex={0} aria-label={`Open feedback for ${item.clientName || 'Anonymous'}`} onClick={(event) => openDrawer(item, event.currentTarget)} onKeyDown={(event) => handleRowKey(event, item)} className={clsx('grid cursor-pointer items-center border-b border-[var(--border)] px-7 py-5 text-center transition-colors last:border-b-0 hover:bg-[var(--bg-elevated)] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--accent)]', item.status === 'new' && 'border-l-2 border-l-sky-400/60')} style={{ gridTemplateColumns: TABLE_COLUMNS }}>
                                            <span className="min-w-0 pr-4 text-left"><span className="block truncate text-sm font-semibold text-[var(--text-primary)]" title={item.clientName || 'Anonymous'}>{item.clientName || 'Anonymous'}</span>{item.hasPhoto && <span className="mt-1 inline-flex items-center gap-1 text-[9px] text-[var(--text-muted)]"><ImageIcon size={11} />Photo attached</span>}</span>
                                            <span className="flex justify-center"><RatingBadge rating={item.rating} /></span>
                                            <div className="min-w-0 px-5 text-left"><div className="flex flex-wrap gap-1.5">{feedbackTags(item).slice(0, 2).map((tag) => <span key={tag} className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[9px] text-[var(--text-secondary)]">{tag}</span>)}{feedbackTags(item).length > 2 && <span className="text-[9px] text-[var(--text-muted)]">+{feedbackTags(item).length - 2}</span>}</div><p className="mt-1.5 line-clamp-1 text-xs leading-5 text-[var(--text-secondary)]">{item.message}</p></div>
                                            <span className={clsx('mx-auto inline-flex w-fit rounded border px-2 py-1 text-[9px] font-bold uppercase tracking-wider', item.status === 'new' ? 'border-sky-500/25 bg-sky-500/10 text-sky-400' : 'border-[var(--border)] text-[var(--text-muted)]')}>{item.status}</span>
                                            <span className="text-[10px] leading-4 text-[var(--text-muted)]">{DATE_FORMATTER.format(new Date(item.createdAt))}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="divide-y divide-[var(--border)] lg:hidden">
                                {feedbackQuery.data.items.map((item) => (
                                    <article key={item.id} role="button" tabIndex={0} aria-label={`Open feedback for ${item.clientName || 'Anonymous'}`} onClick={(event) => openDrawer(item, event.currentTarget)} onKeyDown={(event) => handleRowKey(event, item)} className={clsx('cursor-pointer space-y-4 px-5 py-5 transition-colors hover:bg-[var(--bg-elevated)] focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--accent)]', item.status === 'new' && 'border-l-2 border-l-sky-400/60')}>
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="min-w-0"><p className="truncate text-sm font-semibold text-[var(--text-primary)]">{item.clientName || 'Anonymous'}</p><p className="mt-1 text-[10px] text-[var(--text-muted)]">{DATE_FORMATTER.format(new Date(item.createdAt))}</p></div>
                                            <RatingBadge rating={item.rating} />
                                        </div>
                                        {feedbackTags(item).length > 0 && <div className="flex flex-wrap gap-1.5">{feedbackTags(item).map((tag) => <span key={tag} className="rounded-full border border-[var(--border)] px-2 py-1 text-[9px] text-[var(--text-secondary)]">{tag}</span>)}</div>}
                                        <p className="line-clamp-3 text-xs leading-6 text-[var(--text-secondary)]">{item.message}</p>
                                        <div className="flex flex-wrap gap-2">{item.hasPhoto && <span className="inline-flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[9px] text-[var(--text-muted)]"><ImageIcon size={11} />Photo</span>}<span className="rounded border border-[var(--border)] px-2 py-1 text-[9px] font-bold uppercase text-[var(--text-muted)]">{item.status}</span></div>
                                    </article>
                                ))}
                            </div>
                        </>
                    )}

                    <footer className="flex flex-col gap-3 border-t border-[var(--border)] px-5 py-4 text-[10px] text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between md:px-7">
                        <span>{total ? `Showing ${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, total)} of ${total}` : 'Showing 0 feedback'}</span>
                        <div className="flex items-center gap-3">
                            <button type="button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="flex h-9 items-center gap-1 rounded-lg border border-[var(--border)] px-3 font-semibold uppercase tracking-wider disabled:opacity-35"><ChevronLeft size={13} />Previous</button>
                            <span className="font-semibold">Page {Math.min(page, totalPages)} / {totalPages}</span>
                            <button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} className="flex h-9 items-center gap-1 rounded-lg border border-[var(--border)] px-3 font-semibold uppercase tracking-wider disabled:opacity-35">Next<ChevronRight size={13} /></button>
                        </div>
                    </footer>
                </section>
            </div>

            <FeedbackDrawer item={selectedFeedback} pending={statusMutation.isPending} closeButtonRef={closeButtonRef} drawerRef={drawerRef} onClose={() => setSelectedFeedback(null)} onToggleStatus={updateStatus} />
        </div>
    );
}
