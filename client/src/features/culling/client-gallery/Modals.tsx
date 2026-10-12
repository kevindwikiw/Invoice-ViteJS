import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, Check, CheckSquare, ChevronLeft, ChevronRight, Clock3, Images, Loader2, MessageCircle, QrCode, ScanFace, Send, X } from 'lucide-react';
import clsx from 'clsx';
import { GalleryModal } from '../../../components/GalleryModal';

import { calculateAddonQuote, cullingTutorialImageUrl, createQrisPayment, galleryThumbnailUrl, type QrisPaymentResponse } from '../culling.public';
import type { DiscountRule, GalleryPhoto } from '../culling.types';

import { BLACK_THEME, WHITE_THEME, idrFormat } from './constants';
import { QrisModal } from './QrisModal';
import { BeforeAfterSlider as ComparisonSlider } from './BeforeAfterSlider';
import type { GalleryTheme } from './types';

export function RequestMoreModal({
    theme,
    galleryId,
    requestedCount,
    selectedCount,
    unitPrice,
    discountRules,
    qrisEnabled,
    requestUrl,
    onChange,
    onClose,
    onPaymentSuccess,
}: {
    theme: GalleryTheme;
    galleryId?: string | number;
    requestedCount: number;
    selectedCount: number;
    unitPrice: number;
    discountRules?: DiscountRule[];
    qrisEnabled?: boolean;
    requestUrl: string;
    onChange: (count: number) => void;
    onClose: () => void;
    onPaymentSuccess?: () => void;
}) {
    const quote = calculateAddonQuote(requestedCount, unitPrice, discountRules);
    const [qrisLoading, setQrisLoading] = useState(false);
    const [qrisError, setQrisError] = useState<string | null>(null);
    const [qrisPayment, setQrisPayment] = useState<QrisPaymentResponse | null>(null);
    const [customAmountDraft, setCustomAmountDraft] = useState(String(requestedCount));

    useEffect(() => setCustomAmountDraft(String(requestedCount)), [requestedCount]);

    const handlePayQris = async () => {
        if (!galleryId) return;
        try {
            setQrisLoading(true);
            setQrisError(null);
            const res = await createQrisPayment(galleryId, requestedCount);
            setQrisPayment(res);
        } catch (err: unknown) {
            setQrisError(err instanceof Error ? err.message : 'Unable to process the QRIS payment. Please try again.');
        } finally {
            setQrisLoading(false);
        }
    };

    return (
        <>
            {!qrisPayment && <GalleryModal title="Request More Photos" close={onClose} busy={qrisLoading} style={theme === 'black' ? BLACK_THEME : WHITE_THEME} widthClass="max-w-sm" layerClass="z-[130]">
                <div className="text-[var(--text-primary)]">
                    <p className="text-sm leading-5 text-[var(--text-secondary)]">Add editing slots to this gallery. Choose a package or enter a custom amount.</p>

                <div role="group" aria-label="Additional photo packages" className="mt-5 grid grid-cols-3 gap-2">
                    {[5, 10, 20].map((count) => {
                        const packageQuote = calculateAddonQuote(count, unitPrice, discountRules);
                        const selected = requestedCount === count;
                        const hasDiscount = packageQuote.discountPercent > 0;
                        const savingsTone = selected
                            ? theme === 'black' ? 'text-[#086c61]' : 'text-[#9be4d6]'
                            : theme === 'black' ? 'text-[#9be4d6]' : 'text-[#086c61]';
                        return (
                            <button key={count} type="button" disabled={qrisLoading} aria-pressed={selected} onClick={() => onChange(count)} className={clsx('relative flex h-24 min-w-0 flex-col items-center justify-center rounded-md border px-1.5 py-2 text-center transition-[border-color,background-color,color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-wait', selected ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]' : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:bg-[var(--bg-hover)]')}>
                                {hasDiscount && <span className={clsx('absolute right-1.5 top-1.5 text-[10px] font-semibold', savingsTone)}>Save {packageQuote.discountPercent}%</span>}
                                <strong className="text-lg leading-5">+{count}</strong>
                                <span className="text-[11px]">photos</span>
                                <span className="mt-1 max-w-full text-xs font-bold tabular-nums">{idrFormat.format(packageQuote.total)}</span>
                            </button>
                        );
                    })}
                </div>

                <label className="mt-3 block">
                    <span className="text-xs font-medium text-[var(--text-secondary)]">Custom amount</span>
                    <input type="number" name="additional-photo-count" autoComplete="off" inputMode="numeric" min="1" max="500" step="1" disabled={qrisLoading} value={customAmountDraft} onChange={(event) => {
                        const next = event.currentTarget.value;
                        setCustomAmountDraft(next);
                        const count = Number(next);
                        if (next !== '' && Number.isFinite(count)) onChange(Math.min(500, Math.max(1, Math.trunc(count))));
                    }} onBlur={() => setCustomAmountDraft(String(requestedCount))} className="mt-1.5 h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-3 text-sm text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-wait" />
                </label>

                <dl className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)] text-xs">
                    <div className="flex items-center justify-between py-3"><dt className="text-[var(--text-muted)]">Current selection</dt><dd className="font-semibold">{selectedCount} {selectedCount === 1 ? 'photo' : 'photos'}</dd></div>
                    <div className="flex items-center justify-between py-3"><dt className="text-[var(--text-muted)]">Price per photo</dt><dd className="font-semibold tabular-nums">{idrFormat.format(unitPrice)}</dd></div>
                    <div className="flex items-center justify-between gap-3 py-3"><dt className="text-[var(--text-secondary)]">Bundle discount</dt><dd className="flex items-center gap-1.5 text-right tabular-nums">{quote.discountPercent > 0 ? <><span className="text-[var(--text-muted)]">{quote.discountPercent}%</span><strong className={theme === 'black' ? 'text-[#9be4d6]' : 'text-[#086c61]'}>-{idrFormat.format(quote.savings)}</strong></> : <span className="text-[var(--text-muted)]">None</span>}</dd></div>
                    <div className="flex items-center justify-between gap-3 py-3"><dt className="text-[var(--text-secondary)]">Estimated total</dt><dd className="flex flex-wrap items-baseline justify-end gap-x-2 text-right font-bold tabular-nums">{quote.discountPercent > 0 && <s className="text-[11px] font-medium text-[var(--text-muted)] decoration-2">{idrFormat.format(quote.normalTotal)}</s>}<span className="text-sm text-[var(--text-primary)]">{idrFormat.format(quote.total)}</span></dd></div>
                </dl>

                {galleryId && qrisEnabled ? (
                    <button
                        type="button"
                        disabled={qrisLoading}
                        onClick={handlePayQris}
                        className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[var(--accent)] text-sm font-semibold text-[var(--bg-deep)] transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-50 motion-reduce:transition-none"
                    >
                        {qrisLoading ? <Loader2 size={15} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <QrCode size={16} aria-hidden="true" />}
                        <span>{qrisLoading ? 'Preparing QRIS…' : 'Pay via QRIS'}</span>
                    </button>
                ) : null}

                {qrisError && (
                    <p role="alert" className="mt-2 text-xs leading-5 text-[var(--text-primary)]">{qrisError} You can retry or request via WhatsApp.</p>
                )}

                <a
                    href={requestUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={onClose}
                    className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] text-sm font-medium text-[var(--text-primary)] transition-[background-color,border-color] hover:border-[var(--accent)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                >
                    <MessageCircle size={16} aria-hidden="true" /> Request via WhatsApp
                </a>
                <p className="mt-2.5 text-center text-xs leading-5 text-[var(--text-secondary)]">
                    {qrisEnabled ? 'Your photo limit updates automatically after payment.' : 'QRIS is unavailable for this gallery. Request more photos through WhatsApp.'}
                </p>
                </div>
            </GalleryModal>}

            {qrisPayment && (
                <QrisModal
                    theme={theme}
                    payment={qrisPayment}
                    onPaymentSuccess={() => {
                        onPaymentSuccess?.();
                        onClose();
                    }}
                    onClose={() => setQrisPayment(null)}
                />
            )}
        </>
    );
}

export function SubmitConfirmationModal({
    theme,
    selectedCount,
    photos,
    galleryId,
    token,
    pending,
    error,
    onConfirm,
    onClose,
}: {
    theme: GalleryTheme;
    selectedCount: number;
    photos: GalleryPhoto[];
    galleryId: string;
    token: string;
    pending: boolean;
    error?: string;
    onConfirm: () => void;
    onClose: () => void;
}) {
    const clearsSelection = selectedCount === 0;
    const [reviewPage, setReviewPage] = useState(1);
    const reviewPageSize = 10;
    const reviewPageCount = Math.ceil(photos.length / reviewPageSize);
    const visiblePhotos = photos.slice((reviewPage - 1) * reviewPageSize, reviewPage * reviewPageSize);
    const reviewScrollRef = useRef<HTMLDivElement>(null);
    const errorRef = useRef<HTMLDivElement>(null);
    const changeReviewPage = (page: number) => {
        setReviewPage(page);
        reviewScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
    };

    useEffect(() => {
        if (error) errorRef.current?.focus();
    }, [error]);

    return (
        <GalleryModal title={clearsSelection ? 'Review Selection Changes' : 'Review Selection'} close={onClose} busy={pending} style={theme === 'black' ? BLACK_THEME : WHITE_THEME} scrollRef={reviewScrollRef} widthClass="max-w-2xl" layerClass="z-[130]" footer={<div className="w-full">
            {reviewPageCount > 1 && <nav aria-label="Review pages" className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
                <button type="button" aria-label="Previous review page" title="Previous page" disabled={reviewPage === 1 || pending} onClick={() => changeReviewPage(reviewPage - 1)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-35"><ChevronLeft size={18} aria-hidden="true" /></button>
                <span role="status" aria-live="polite" className="min-w-0 text-center text-xs tabular-nums text-[var(--text-secondary)]">{(reviewPage - 1) * reviewPageSize + 1}–{Math.min(reviewPage * reviewPageSize, photos.length)} of {photos.length}</span>
                <button type="button" aria-label="Next review page" title="Next page" disabled={reviewPage === reviewPageCount || pending} onClick={() => changeReviewPage(reviewPage + 1)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-35"><ChevronRight size={18} aria-hidden="true" /></button>
            </nav>}
            <div className={clsx('flex items-center justify-end gap-2', reviewPageCount > 1 && 'pt-2')}>
                <button type="button" disabled={pending} onClick={onClose} className="h-11 w-20 shrink-0 rounded-md border border-[var(--border)] text-sm font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-40 sm:w-auto sm:px-6">Back</button>
                <button type="button" disabled={pending} onClick={onConfirm} className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-[var(--accent)] px-3 text-sm font-semibold text-[var(--bg-deep)] transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-45 sm:flex-none sm:px-6">
                    {pending ? <Loader2 size={13} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Send size={13} aria-hidden="true" />}
                    {pending ? 'Submitting…' : clearsSelection ? 'Clear Selection' : 'Submit for Editing'}
                </button>
            </div>
        </div>}>
            <div className="text-[var(--text-primary)]">
                <p className="text-lg font-semibold tabular-nums">{selectedCount} {selectedCount === 1 ? 'photo' : 'photos'} selected</p>
                <p className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">{clearsSelection ? 'This removes the previous submission. Go back to keep it.' : 'Check your selection before submitting it for editing.'}</p>
                {!clearsSelection && <div className="mt-5 grid grid-cols-2 gap-x-2 gap-y-4 sm:grid-cols-3 sm:gap-x-3 md:grid-cols-4" aria-label="Selected photos">
                    {visiblePhotos.map((photo, index) => <figure key={photo.driveFileId} className="min-w-0">
                        <img src={galleryThumbnailUrl(galleryId, photo.driveFileId, token, photo.photoToken)} alt={photo.filename} width={240} height={240} loading={index < 4 ? 'eager' : 'lazy'} decoding="async" className="aspect-square w-full border border-[var(--border)] bg-[var(--bg-elevated)] object-cover" />
                        <figcaption className="mt-1.5 flex min-w-0 items-baseline justify-between gap-2 text-[11px] text-[var(--text-secondary)]"><span className="min-w-0 truncate" title={photo.filename}>{photo.filename}</span><span className="shrink-0 tabular-nums text-[var(--text-muted)]">#{String((reviewPage - 1) * reviewPageSize + index + 1).padStart(2, '0')}</span></figcaption>
                    </figure>)}
                </div>}
                {error && <div ref={errorRef} role="alert" tabIndex={-1} className="mt-4 flex items-start gap-2 border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-left text-sm leading-5 text-[var(--text-primary)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{error}</div>}
            </div>
        </GalleryModal>
    );
}

function DelayedSampleLoading() {
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const timer = window.setTimeout(() => setVisible(true), 200);
        return () => window.clearTimeout(timer);
    }, []);

    if (!visible) return null;
    return <div data-testid="tutorial-image-loading" role="status" aria-live="polite" className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
        <div className="flex items-center gap-2 rounded-md bg-black/75 px-3 py-2 text-xs font-medium text-white shadow-sm">
            <Loader2 size={17} strokeWidth={1.8} aria-hidden="true" className="animate-[spin_700ms_linear_infinite] motion-reduce:[animation-duration:1.6s]" />
            <span>Loading sample photos…</span>
        </div>
    </div>;
}

function TutorialSamplePreview({ galleryId, token, slot, version, onSettled }: { galleryId: string; token: string; slot: number; version?: string | null; onSettled?: (result: 'ready' | 'failed') => void }) {
    const [visibleSlot, setVisibleSlot] = useState(slot);
    const [visibleSettled, setVisibleSettled] = useState(false);
    const [settledSlot, setSettledSlot] = useState<number | null>(null);
    const switching = slot !== visibleSlot;
    const incomingSettled = switching && settledSlot === slot;

    useEffect(() => {
        if (switching) return;
        setSettledSlot(null);
    }, [switching]);

    useEffect(() => {
        if (!incomingSettled) return;
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const timer = window.setTimeout(() => {
            setVisibleSlot(slot);
            setVisibleSettled(true);
            setSettledSlot(null);
        }, reducedMotion ? 0 : 180);
        return () => window.clearTimeout(timer);
    }, [incomingSettled, slot]);

    return <div className="relative">
        {[visibleSlot, ...(switching ? [slot] : [])].map((sampleSlot) => {
            const incoming = switching && sampleSlot === slot;
            return <div
                key={sampleSlot}
                aria-hidden={incoming ? !incomingSettled : switching}
                inert={incoming ? !incomingSettled : switching}
                className={clsx(incoming ? 'absolute inset-0 z-10' : 'relative', 'transition-opacity duration-[180ms] ease-out motion-reduce:transition-none', incoming && !incomingSettled ? 'opacity-0' : 'opacity-100')}
            >
                <ComparisonSlider
                    beforeUrl={cullingTutorialImageUrl(galleryId, token, sampleSlot, 'before', version)}
                    afterUrl={cullingTutorialImageUrl(galleryId, token, sampleSlot, 'after', version)}
                    frameClass="max-sm:h-[min(56dvh,28rem)] sm:h-[min(52dvh,28rem)]"
                    onLoading={incoming ? () => setSettledSlot(null) : () => setVisibleSettled(false)}
                    onSettled={incoming ? () => setSettledSlot((current) => current === sampleSlot ? current : sampleSlot) : (result) => { setVisibleSettled(true); onSettled?.(result); }}
                />
            </div>;
        })}
        {(switching ? !incomingSettled : !visibleSettled) && <DelayedSampleLoading key={switching ? `switch:${visibleSlot}:${slot}` : `initial:${visibleSlot}`} />}
    </div>;
}


export function TutorialModal({ galleryId, token, tutorialSampleSlots, tutorialSampleVersion, onClose, active = true, textOnly = false, onInitialMediaSettled }: { galleryId: string; token: string; tutorialSampleSlots: number[]; tutorialSampleVersion?: string | null; onClose: () => void; active?: boolean; textOnly?: boolean; onInitialMediaSettled?: (result: 'ready' | 'failed') => void }) {
    const hasSamples = tutorialSampleSlots.length > 0;
    const [stepIndex, setStepIndex] = useState<number | null>(null);
    const [sampleIndex, setSampleIndex] = useState(0);
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const panelCloseButtonRef = useRef<HTMLButtonElement>(null);
    const readyContentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!active) return;
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        panelCloseButtonRef.current?.focus();
        return () => previouslyFocused?.focus();
    }, [active]);

    useEffect(() => {
        if (!active) return;
        const body = document.body;
        const scrollY = window.scrollY;
        const previous = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow };
        body.style.position = 'fixed';
        body.style.top = `-${scrollY}px`;
        body.style.width = '100%';
        body.style.overflow = 'hidden';
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            Object.assign(body.style, previous);
            window.scrollTo(0, scrollY);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose, active]);

    const wizardSteps = [
        ...(hasSamples ? [{ id: 'confidence', label: 'Choose' }] : []),
        { id: 'submit', label: 'Submit' },
        { id: 'ready', label: 'Ready' },
    ] as const;
    const safeStepIndex = Math.min(stepIndex ?? (textOnly && hasSamples ? 1 : 0), wizardSteps.length - 1);
    const activeStep = wizardSteps[safeStepIndex];
    const activeSampleSlot = tutorialSampleSlots[sampleIndex] || tutorialSampleSlots[0];
    const stepTitle = activeStep.id === 'confidence' ? 'Choose with Confidence' : activeStep.id === 'submit' ? 'How to Submit' : 'Ready to Choose';

    useEffect(() => {
        scrollAreaRef.current?.scrollTo({ top: 0 });
    }, [safeStepIndex]);

    useLayoutEffect(() => {
        if (activeStep.id !== 'ready' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const animation = readyContentRef.current?.animate([
            { opacity: 0, transform: 'translateY(8px)' },
            { opacity: 1, transform: 'translateY(0)' },
        ], { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
        return () => animation?.cancel();
    }, [activeStep.id]);

    const goToStep = (nextIndex: number) => {
        setStepIndex(Math.min(wizardSteps.length - 1, Math.max(0, nextIndex)));
    };

    return (
        <div inert={!active} aria-hidden={!active} style={{ visibility: active ? 'visible' : 'hidden' }} className="fixed inset-0 z-[130] flex items-center justify-center overscroll-contain bg-black/70 px-2 py-2 sm:px-4 sm:py-4" role="dialog" aria-modal={active ? true : undefined} aria-label="How photo selection works" onMouseDown={(event) => { if (active && event.target === event.currentTarget) onClose(); }}>
            <section data-testid="tutorial-panel" className="flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] origin-center flex-col overflow-hidden border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-2xl sm:h-[min(56rem,calc(100dvh-2rem))] sm:max-h-[calc(100dvh-2rem)] sm:w-[67vw] sm:max-w-2xl">
                <header className="flex shrink-0 items-start justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5 sm:gap-4 sm:px-5 sm:py-4">
                    <div>
                        <p className="text-xs font-medium text-[var(--text-muted)]">Photo selection guide</p>
                        <h2 className="mt-1 font-sans text-lg font-semibold leading-tight text-balance sm:text-xl">{stepTitle}</h2>
                    </div>
                    <button ref={panelCloseButtonRef} type="button" onClick={onClose} aria-label="Close tutorial" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[var(--border)] transition-[transform,border-color] duration-150 ease-out hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] active:scale-[0.97] motion-reduce:transition-none"><X size={16} aria-hidden="true" /></button>
                </header>

                <nav aria-label="Tutorial progress" className="grid shrink-0 border-b border-[var(--border)] px-3 py-2.5 sm:px-5 sm:py-3" style={{ gridTemplateColumns: `repeat(${wizardSteps.length}, minmax(0, 1fr))` }}>
                    {wizardSteps.map((step, index) => (
                        <button
                            key={step.id}
                            type="button"
                            onClick={() => goToStep(index)}
                            aria-current={safeStepIndex === index ? 'step' : undefined}
                            className={clsx('flex min-h-11 min-w-0 items-center justify-center gap-1.5 text-[13px] font-medium transition-colors duration-150 hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]', safeStepIndex === index ? 'text-[var(--text-primary)]' : index < safeStepIndex ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]')}
                        >
                            <span className={clsx('flex h-5 w-5 items-center justify-center rounded-full border text-[9px]', safeStepIndex === index ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]' : 'border-[var(--border)]')}>{index + 1}</span>
                            <span className="truncate">{step.label}</span>
                        </button>
                    ))}
                </nav>

                <div ref={scrollAreaRef} data-testid="tutorial-scroll-area" className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-3 py-4 [-webkit-overflow-scrolling:touch] sm:px-5 sm:py-5">
                    {activeStep.id === 'confidence' && (
                        <div data-testid="tutorial-confidence-step">
                            <div className="flex items-center justify-between gap-3">
                                <p className="text-[13px] font-medium text-[var(--text-secondary)]">Sample {sampleIndex + 1} of {tutorialSampleSlots.length}</p>
                            </div>
                            <div className="mt-2">
                                <TutorialSamplePreview galleryId={galleryId} token={token} slot={activeSampleSlot} version={tutorialSampleVersion} onSettled={onInitialMediaSettled} />
                            </div>
                            <p className="mx-auto mt-3 max-w-md text-center text-[13px] leading-5 text-[var(--text-secondary)]">The photos you submit become your edited gallery.</p>
                            {tutorialSampleSlots.length > 1 && (
                                <div className="mt-2 flex items-center justify-center" aria-label="Tutorial samples">
                                    {tutorialSampleSlots.map((slot, index) => (
                                        <button key={slot} type="button" onClick={() => setSampleIndex(index)} aria-label={`View sample ${index + 1}`} aria-current={sampleIndex === index ? 'true' : undefined} className="flex h-11 w-11 items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><span aria-hidden="true" className={clsx('h-1.5 rounded-full transition-[width,background-color] motion-reduce:transition-none', sampleIndex === index ? 'w-5 bg-[var(--accent)]' : 'w-1.5 bg-[var(--border)] hover:bg-[var(--text-muted)]')} /></button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {activeStep.id === 'submit' && (
                        <div data-testid="tutorial-submit-step" className="flex min-h-full flex-col">
                            <p className="mx-auto max-w-md text-center text-[13px] leading-6 text-[var(--text-secondary)]">Choose at your own pace. These six steps take you from the full gallery to your edited photos.</p>
                            <ol data-testid="tutorial-submit-steps" className="mt-3 divide-y divide-[var(--border)] border-y border-[var(--border)] sm:mt-4">
                                {[
                                    { icon: <Images size={18} />, title: 'Browse the Gallery', text: 'Scroll through the gallery and open any photo for a closer look.' },
                                    { icon: <ScanFace size={18} />, title: 'Find and Choose Favorites', text: 'Use a clear selfie to find matching photos, then tap the check button on the ones you want to keep.' },
                                    { icon: <CheckSquare size={18} />, title: 'Review Picked', text: 'Use All Photos, Picked, or Submitted to move between views.' },
                                    { icon: <Send size={18} />, title: 'Submit Your Selection', text: 'Confirm the final count. You can revise and submit again later.' },
                                    { icon: <Images size={18} />, title: 'Review Edited Photos', text: 'Open Edited Photos to compare your final images with Before / After.' },
                                    { icon: <Clock3 size={18} />, title: 'Keep An Eye On Time', text: 'The countdown shows how long your gallery remains available.' },
                                ].map((item, index) => (
                                    <li key={item.title} className="flex items-center gap-3 py-2.5 sm:py-3">
                                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--text-primary)]">{item.icon}</span>
                                        <div className="min-w-0 pt-0.5"><p className="text-[13px] font-semibold"><span className="mr-1.5 text-[var(--text-muted)]">{index + 1}.</span>{item.title}</p><p className="mt-0.5 text-xs leading-5 text-[var(--text-muted)]">{item.text}</p></div>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}

                    {activeStep.id === 'ready' && (
                        <div data-testid="tutorial-ready-step" className="flex min-h-full items-center justify-center py-6 text-center">
                            <div ref={readyContentRef} className="flex w-full flex-col items-center">
                                <div className="flex h-20 w-20 items-center justify-center rounded-full border border-[var(--accent)] text-[var(--accent)]"><Check size={34} /></div>
                                <p className="mt-7 font-sans text-2xl font-semibold sm:text-[26px]">Choose Your Photos</p>
                                <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-[var(--text-secondary)] sm:text-base sm:leading-7">Mark the photos you want edited, review them in Picked, then submit.</p>
                            </div>
                        </div>
                    )}
                </div>

                <footer data-testid="tutorial-footer" className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--bg-card)] p-3.5 sm:p-4">
                    <button type="button" disabled={activeStep.id === 'confidence' ? sampleIndex === 0 : safeStepIndex === 0} onClick={() => activeStep.id === 'confidence' ? setSampleIndex((current) => Math.max(0, current - 1)) : goToStep(safeStepIndex - 1)} className="flex h-11 items-center gap-1 rounded-md border border-[var(--border)] px-3 text-[13px] font-semibold text-[var(--text-secondary)] transition-transform duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] active:scale-[0.97] disabled:invisible motion-reduce:transition-none"><ChevronLeft size={15} aria-hidden="true" /> {activeStep.id === 'confidence' ? 'Previous' : 'Back'}</button>
                    {activeStep.id === 'confidence' ? (
                        <button type="button" onClick={() => sampleIndex < tutorialSampleSlots.length - 1 ? setSampleIndex((current) => current + 1) : goToStep(safeStepIndex + 1)} className="flex h-11 items-center gap-1 rounded-md bg-[var(--accent)] px-3 text-[13px] font-semibold text-[var(--bg-deep)] transition-transform duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] active:scale-[0.97] motion-reduce:transition-none">{sampleIndex < tutorialSampleSlots.length - 1 ? 'Next sample' : 'How to Submit'} <ChevronRight size={15} aria-hidden="true" /></button>
                    ) : activeStep.id === 'ready' ? (
                        <button type="button" onClick={onClose} className="flex h-11 flex-1 items-center justify-center rounded-md bg-[var(--accent)] text-[13px] font-semibold text-[var(--bg-deep)] transition-[transform,opacity] duration-150 ease-out hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] active:scale-[0.98] motion-reduce:transition-none">Start selecting</button>
                    ) : activeStep.id === 'submit' ? (
                        <button type="button" onClick={() => goToStep(safeStepIndex + 1)} className="flex h-11 items-center gap-1 rounded-md bg-[var(--accent)] px-3 text-[13px] font-semibold text-[var(--bg-deep)] transition-transform duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] active:scale-[0.97] motion-reduce:transition-none">Ready To Choose <ChevronRight size={15} aria-hidden="true" /></button>
                    ) : null}
                </footer>
            </section>
        </div>
    );
}
