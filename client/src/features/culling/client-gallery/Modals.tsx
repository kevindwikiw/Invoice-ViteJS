import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, Check, CheckSquare, ChevronLeft, ChevronRight, Clock3, Images, Loader2, MessageCircle, QrCode, ScanFace, Send, X } from 'lucide-react';
import clsx from 'clsx';

import { calculateAddonQuote, cullingTutorialImageUrl, createQrisPayment, type QrisPaymentResponse } from '../culling.public';
import type { DiscountRule } from '../culling.types';

import { idrFormat } from './constants';
import { QrisModal } from './QrisModal';
import { BeforeAfterSlider as ComparisonSlider } from './BeforeAfterSlider';
import type { GalleryTheme } from './types';

const pendingTutorialImagePreloads = new Set<HTMLImageElement>();

function preloadTutorialImage(url: string, priority: 'high' | 'low'): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const image = new Image();
        pendingTutorialImagePreloads.add(image);
        image.decoding = 'async';
        image.fetchPriority = priority;
        image.onload = () => {
            pendingTutorialImagePreloads.delete(image);
            if (typeof image.decode !== 'function') {
                resolve();
                return;
            }
            void image.decode().catch(() => undefined).finally(resolve);
        };
        image.onerror = () => {
            pendingTutorialImagePreloads.delete(image);
            reject(new Error('Unable to preload tutorial image.'));
        };
        image.src = url;
    });
}

export function RequestMoreModal({
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

    const handlePayQris = async () => {
        if (!galleryId) return;
        try {
            setQrisLoading(true);
            setQrisError(null);
            const res = await createQrisPayment(galleryId, requestedCount);
            setQrisPayment(res);
        } catch (err: unknown) {
            setQrisError(err instanceof Error ? err.message : 'Gagal memproses pembayaran QRIS');
        } finally {
            setQrisLoading(false);
        }
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true" aria-label="Request more edited photos" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <section className="w-full max-w-sm border border-[var(--border)] bg-[var(--bg-card)] p-5 text-[var(--text-primary)] shadow-2xl">
                <header className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">EDITING ADD-ON</p>
                        <h2 className="mt-1 font-display text-xl">Keep More Favorites</h2>
                        <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Choose how many additional photos you want Orbit to edit.</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close request more dialog" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] hover:border-[var(--accent)]"><X size={14} /></button>
                </header>

                <div className="mt-5 grid grid-cols-3 gap-2">
                    {[5, 10, 20].map((count) => {
                        const packageQuote = calculateAddonQuote(count, unitPrice, discountRules);
                        const selected = requestedCount === count;
                        const hasDiscount = packageQuote.discountPercent > 0;
                        return (
                            <button key={count} type="button" onClick={() => onChange(count)} className={clsx('relative flex min-h-[86px] flex-col items-center justify-center rounded-lg border px-1.5 py-2 text-center transition-[border-color,background-color,color,transform] hover:-translate-y-0.5', selected ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]' : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)]')}>
                                {count === 10 && <span className={clsx('mb-1 text-[8px] font-black uppercase tracking-[0.1em]', selected ? 'text-[var(--bg-deep)]/65' : 'text-[var(--text-primary)]')}>Popular</span>}
                                {count === 20 && <span className={clsx('mb-1 text-[8px] font-black uppercase tracking-[0.1em]', selected ? 'text-[var(--bg-deep)]/65' : 'text-[var(--text-primary)]')}>Best value</span>}
                                <strong className="text-xs">+{count} photos</strong>
                                {hasDiscount && (
                                    <span className={clsx('mt-1 rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.08em]', selected ? 'bg-[var(--bg-deep)]/10 text-[var(--bg-deep)]/70' : 'bg-emerald-500/10 text-emerald-400')}>
                                        Save {packageQuote.discountPercent}%
                                    </span>
                                )}
                                <span className="mt-1 flex min-h-[24px] flex-col items-center justify-center leading-tight">
                                    {hasDiscount && <span className={clsx('text-[8px] tabular-nums line-through', selected ? 'text-[var(--bg-deep)]/45' : 'text-[var(--text-muted)]')}>{idrFormat.format(packageQuote.normalTotal)}</span>}
                                    <span className="text-[9px] font-bold tabular-nums">{idrFormat.format(packageQuote.total)}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>

                <label className="mt-3 block">
                    <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Custom amount</span>
                    <input type="number" min="1" max="500" value={requestedCount} onChange={(event) => onChange(Math.min(500, Math.max(1, Number(event.currentTarget.value) || 1)))} className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] px-3 text-sm outline-none focus:border-[var(--accent)]" />
                </label>

                <dl className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)] text-xs">
                    <div className="flex items-center justify-between py-3"><dt className="text-[var(--text-muted)]">Current selection</dt><dd className="font-semibold">{selectedCount} photos</dd></div>
                    <div className="flex items-center justify-between py-3"><dt className="text-[var(--text-muted)]">Price per photo</dt><dd className="font-semibold tabular-nums">{idrFormat.format(unitPrice)}</dd></div>
                    {quote.discountPercent > 0 && <div className="flex items-center justify-between py-3"><dt className="text-[var(--text-primary)]">Bundle discount</dt><dd className="font-semibold text-[var(--text-primary)]">Save {quote.discountPercent}% ({idrFormat.format(quote.savings)})</dd></div>}
                    <div className="flex items-center justify-between py-3"><dt className="text-[var(--text-muted)]">Estimated total</dt><dd className="flex items-center gap-2 font-bold tabular-nums">{quote.discountPercent > 0 && <span className="font-normal text-[var(--text-muted)] line-through">{idrFormat.format(quote.normalTotal)}</span>}{idrFormat.format(quote.total)}</dd></div>
                </dl>

                {galleryId && qrisEnabled ? (
                    <button
                        type="button"
                        disabled={qrisLoading}
                        onClick={handlePayQris}
                        className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] text-xs font-black uppercase tracking-wider text-[var(--bg-deep)] transition-all hover:opacity-90 shadow-md active:scale-[0.99] disabled:opacity-50"
                    >
                        {qrisLoading ? <Loader2 size={15} className="animate-spin" /> : <QrCode size={16} />}
                        <span>Bayar Instan via QRIS</span>
                    </button>
                ) : null}

                {qrisError && (
                    <p className="mt-2 text-center text-xs text-rose-400">{qrisError}</p>
                )}

                <a
                    href={requestUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={onClose}
                    className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-white"
                >
                    <MessageCircle size={13} /> Pesan Manual via WhatsApp
                </a>
                <p className="mt-2.5 text-center text-[10px] leading-4 text-[var(--text-muted)]">
                    {qrisEnabled ? 'Pembayaran via QRIS otomatis membuka kuota seketika tanpa perlu konfirmasi manual.' : 'QRIS belum aktif untuk gallery ini, jadi request tambahan dikirim manual via WhatsApp.'}
                </p>
            </section>

            {qrisPayment && (
                <QrisModal
                    payment={qrisPayment}
                    onPaymentSuccess={() => {
                        onPaymentSuccess?.();
                        onClose();
                    }}
                    onClose={() => setQrisPayment(null)}
                />
            )}
        </div>
    );
}

export function SubmitConfirmationModal({
    selectedCount,
    pending,
    error,
    onConfirm,
    onClose,
}: {
    selectedCount: number;
    pending: boolean;
    error?: string;
    onConfirm: () => void;
    onClose: () => void;
}) {
    const clearsSelection = selectedCount === 0;

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !pending) onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose, pending]);

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true" aria-label={clearsSelection ? 'Clear submitted selection' : 'Submit selected photos'} onMouseDown={(event) => { if (!pending && event.target === event.currentTarget) onClose(); }}>
            <section className="w-full max-w-sm border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-2xl">
                <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
                    <div>
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">FINAL CHECK</p>
                        <h2 className="mt-1 font-display text-xl">{clearsSelection ? 'Clear selection?' : 'Submit your selection?'}</h2>
                    </div>
                    <button type="button" disabled={pending} onClick={onClose} aria-label="Close submit confirmation" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] transition-colors hover:border-[var(--accent)] disabled:opacity-40"><X size={14} /></button>
                </header>

                <div className="px-5 py-6 text-center">
                    <p className="font-display text-5xl tabular-nums text-[var(--text-primary)]">{selectedCount}</p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">{selectedCount === 1 ? 'Photo selected' : 'Photos selected'}</p>
                    <p className="mx-auto mt-5 max-w-xs text-xs leading-5 text-[var(--text-secondary)]">
                        {clearsSelection ? 'This removes all previously submitted photos. You can select and submit them again later.' : 'Are you sure these are the photos you want to submit? Orbit will receive the selected filenames.'}
                    </p>
                    {error && <div className="mt-4 flex items-start gap-2 border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-left text-xs leading-5 text-rose-300"><AlertCircle size={14} className="mt-0.5 shrink-0" />{error}</div>}
                </div>

                <footer className="grid grid-cols-2 gap-2 border-t border-[var(--border)] p-4">
                    <button type="button" disabled={pending} onClick={onClose} className="h-10 rounded-lg border border-[var(--border)] text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)] disabled:opacity-40">Cancel</button>
                    <button type="button" autoFocus disabled={pending} onClick={onConfirm} className="flex h-10 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] text-[10px] font-black uppercase tracking-[0.12em] text-[var(--bg-deep)] transition-opacity hover:opacity-85 disabled:opacity-45">
                        {pending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                        {pending ? 'Submitting' : clearsSelection ? 'Clear selection' : `Submit ${selectedCount}`}
                    </button>
                </footer>
            </section>
        </div>
    );
}

function BeforeAfterSlider({ galleryId, token, slot }: { galleryId: string; token: string; slot: number }) {
    return <ComparisonSlider key={`${galleryId}-${slot}`} beforeUrl={cullingTutorialImageUrl(galleryId, token, slot, 'before')} afterUrl={cullingTutorialImageUrl(galleryId, token, slot, 'after')} />;
}

type TutorialIntroPhase = 'loading' | 'handoff' | 'ready';

function TutorialIntro({ theme, onHandoffStart, onComplete, onClose }: { theme: GalleryTheme; onHandoffStart: () => void; onComplete: () => void; onClose: () => void }) {
    const [logoFailed, setLogoFailed] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const logoRef = useRef<HTMLDivElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);
    const progressFillRef = useRef<HTMLDivElement>(null);
    const percentageRef = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        const root = rootRef.current;
        const logo = logoRef.current;
        if (!root || !logo || typeof root.animate !== 'function') return;
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const animations = [root.animate([{ opacity: 1 }, { opacity: 0 }], {
            delay: 3800, duration: 200, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards',
        })];
        if (!reducedMotion.matches) {
            animations.push(logo.animate([
                { opacity: 0, transform: 'scale(0.96)' },
                { opacity: 1, transform: 'scale(1)' },
            ], { duration: 350, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }));
            animations.push(logo.animate([
                { transform: 'scale(1)' },
                { transform: 'scale(1.025)' },
                { transform: 'scale(1)' },
            ], { delay: 350, duration: 1725, iterations: 2, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' }));
        }
        const cancelAnimations = () => animations.forEach((animation) => animation.cancel());
        reducedMotion.addEventListener('change', cancelAnimations);
        return () => {
            cancelAnimations();
            reducedMotion.removeEventListener('change', cancelAnimations);
        };
    }, []);

    useEffect(() => {
        const startedAt = performance.now();
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        let previousPercent = -1;
        let frame = 0;
        const renderProgress = (percent: number, progress: number) => {
            if (percent !== previousPercent) {
                if (percentageRef.current) percentageRef.current.textContent = `${percent}%`;
                progressRef.current?.setAttribute('aria-valuenow', String(percent));
                previousPercent = percent;
            }
            if (progressFillRef.current) {
                progressFillRef.current.style.transform = `scaleX(${reducedMotion.matches ? percent / 100 : progress})`;
            }
        };
        const updateProgress = () => {
            const progress = Math.min(1, (performance.now() - startedAt) / 3800);
            const percent = Math.floor(progress * 100);
            renderProgress(percent, progress);
            if (progress < 1) frame = requestAnimationFrame(updateProgress);
        };
        frame = requestAnimationFrame(updateProgress);
        const handoffTimeout = setTimeout(() => {
            renderProgress(100, 1);
            onHandoffStart();
        }, 3_800);
        const completeTimeout = setTimeout(onComplete, 4_000);
        return () => {
            cancelAnimationFrame(frame);
            clearTimeout(handoffTimeout);
            clearTimeout(completeTimeout);
        };
    }, [onComplete, onHandoffStart]);

    return (
        <div ref={rootRef} data-testid="tutorial-intro" className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg-deep)] px-6 text-[var(--text-primary)]">
            <button type="button" autoFocus onClick={onClose} aria-label="Close tutorial" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-md border border-[var(--border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"><X size={15} /></button>
            <div className="w-full max-w-sm text-center">
                <div ref={logoRef} data-testid="tutorial-intro-logo" className="mx-auto mb-8 aspect-[791/296] w-60 max-w-full origin-center sm:w-80">
                    <img src="/logo.png" alt="The Orbit Photo" width={791} height={296} fetchPriority="high" decoding="async" onError={() => setLogoFailed(true)} className={clsx('h-full w-full object-contain', logoFailed && 'invisible')} style={{ filter: theme === 'black' ? 'brightness(0) invert(1)' : 'brightness(0)' }} />
                </div>
                <h2 className="font-display text-2xl">Your Gallery Awaits</h2>
                <div className="mx-auto mt-5 flex max-w-xs items-center justify-between text-xs text-[var(--text-muted)]">
                    <span>Opening Your Guide</span>
                    <span ref={percentageRef} aria-hidden="true" className="w-10 text-right tabular-nums">0%</span>
                </div>
                <div ref={progressRef} role="progressbar" aria-label="Opening your guide" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} className="mx-auto mt-3 h-1 max-w-xs overflow-hidden bg-[var(--border)]">
                    <div ref={progressFillRef} className="h-full origin-left bg-[var(--accent)]" style={{ transform: 'scaleX(0)' }} />
                </div>
            </div>
        </div>
    );
}

export function TutorialModal({ galleryId, token, tutorialSampleSlots, theme, showIntro = false, onClose }: { galleryId: string; token: string; tutorialSampleSlots: number[]; theme: GalleryTheme; showIntro?: boolean; onClose: () => void }) {
    const [introPhase, setIntroPhase] = useState<TutorialIntroPhase>(showIntro ? 'loading' : 'ready');
    const startIntroHandoff = useCallback(() => setIntroPhase((current) => current === 'loading' ? 'handoff' : current), []);
    const finishIntro = useCallback(() => setIntroPhase('ready'), []);
    const hasSamples = tutorialSampleSlots.length > 0;
    const [stepIndex, setStepIndex] = useState(0);
    const [sampleIndex, setSampleIndex] = useState(0);
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLElement>(null);
    const panelCloseButtonRef = useRef<HTMLButtonElement>(null);
    const readyContentRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (introPhase !== 'handoff' || !panel || typeof panel.animate !== 'function') return;
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const animation = panel.animate(reducedMotion
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [
                { opacity: 0, transform: 'translateY(8px) scale(0.985)' },
                { opacity: 1, transform: 'translateY(0) scale(1)' },
            ], {
            duration: 200,
            easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
            fill: 'both',
        });
        return () => animation.cancel();
    }, [introPhase]);

    useEffect(() => {
        if (showIntro && introPhase === 'ready') panelCloseButtonRef.current?.focus();
    }, [introPhase, showIntro]);

    useEffect(() => {
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
    }, [onClose]);

    useEffect(() => {
        const urls = tutorialSampleSlots.flatMap((slot) => [
            cullingTutorialImageUrl(galleryId, token, slot, 'after'),
            cullingTutorialImageUrl(galleryId, token, slot, 'before'),
        ]);
        urls.forEach((url, index) => {
            void preloadTutorialImage(url, index < 2 ? 'high' : 'low').catch(() => undefined);
        });
    }, [galleryId, token, tutorialSampleSlots]);

    const wizardSteps = [
        ...(hasSamples ? [{ id: 'confidence', label: 'Choose' }] : []),
        { id: 'submit', label: 'Submit' },
        { id: 'ready', label: 'Ready' },
    ] as const;
    const safeStepIndex = Math.min(stepIndex, wizardSteps.length - 1);
    const activeStep = wizardSteps[safeStepIndex];
    const activeSampleSlot = tutorialSampleSlots[sampleIndex] || tutorialSampleSlots[0];
    const stepTitle = activeStep.id === 'confidence' ? 'Choose With Confidence' : activeStep.id === 'submit' ? 'How to Submit' : 'Ready to Choose';

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
        <div className="fixed inset-0 z-[130] flex items-center justify-center overscroll-contain bg-black/70 px-2 py-2 sm:px-4 sm:py-4" role="dialog" aria-modal="true" aria-label="How photo selection works" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            {introPhase !== 'loading' && <section ref={panelRef} data-testid="tutorial-panel" inert={introPhase === 'handoff'} aria-hidden={introPhase === 'handoff' ? true : undefined} className={clsx('flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] origin-center flex-col overflow-hidden border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-2xl sm:h-[min(56rem,calc(100dvh-2rem))] sm:max-h-[calc(100dvh-2rem)] sm:w-[67vw] sm:max-w-2xl', introPhase === 'handoff' && 'pointer-events-none')}>
                <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border)] px-4 py-3.5 sm:px-5 sm:py-4">
                    <div>
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">ORBIT GUIDE</p>
                        <h2 className="mt-1 font-display text-xl">{stepTitle}</h2>
                    </div>
                    <button ref={panelCloseButtonRef} type="button" onClick={onClose} aria-label="Close tutorial" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--border)] transition-[transform,border-color] duration-150 ease-out hover:border-[var(--accent)] active:scale-[0.97] motion-reduce:transition-none"><X size={15} /></button>
                </header>

                <nav aria-label="Tutorial progress" className="grid shrink-0 border-b border-[var(--border)] px-3 py-2.5 sm:px-5 sm:py-3" style={{ gridTemplateColumns: `repeat(${wizardSteps.length}, minmax(0, 1fr))` }}>
                    {wizardSteps.map((step, index) => (
                        <button
                            key={step.id}
                            type="button"
                            onClick={() => goToStep(index)}
                            aria-current={safeStepIndex === index ? 'step' : undefined}
                            className={clsx('flex min-w-0 items-center justify-center gap-1.5 text-[8px] font-bold uppercase tracking-[0.08em] transition-[transform,color] duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none sm:text-[9px] sm:tracking-[0.1em]', safeStepIndex === index ? 'text-[var(--text-primary)]' : index < safeStepIndex ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]')}
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
                                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">Sample {String(sampleIndex + 1).padStart(2, '0')} / {String(tutorialSampleSlots.length).padStart(2, '0')}</p>
                                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Before / Edited</p>
                            </div>
                            <div className="mt-2">
                                <BeforeAfterSlider key={activeSampleSlot} galleryId={galleryId} token={token} slot={activeSampleSlot} />
                            </div>
                            <p className="mx-auto mt-3 max-w-md text-center text-xs leading-5 text-[var(--text-muted)]">Pick the moments that mean the most. We’ll take care of making them into something lasting.</p>
                            {tutorialSampleSlots.length > 1 && (
                                <div className="mt-4 flex items-center justify-center gap-2" aria-label="Tutorial samples">
                                    {tutorialSampleSlots.map((slot, index) => (
                                        <button key={slot} type="button" onClick={() => setSampleIndex(index)} aria-label={`View sample ${index + 1}`} aria-current={sampleIndex === index ? 'true' : undefined} className={clsx('h-2 rounded-full transition-[width,background-color] motion-reduce:transition-none', sampleIndex === index ? 'w-6 bg-[var(--accent)]' : 'w-2 bg-[var(--border)] hover:bg-[var(--text-muted)]')} />
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
                                        <div className="min-w-0 pt-0.5"><p className="text-xs font-semibold"><span className="mr-1.5 text-[var(--text-muted)]">{index + 1}.</span>{item.title}</p><p className="mt-0.5 text-[11px] leading-4 text-[var(--text-muted)]">{item.text}</p></div>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}

                    {activeStep.id === 'ready' && (
                        <div data-testid="tutorial-ready-step" className="flex min-h-full items-center justify-center py-6 text-center">
                            <div ref={readyContentRef} className="flex w-full flex-col items-center">
                                <div className="flex h-20 w-20 items-center justify-center rounded-full border border-[var(--accent)] text-[var(--accent)]"><Check size={34} /></div>
                                <p className="mt-7 font-display text-2xl sm:text-3xl">Ready When You Are</p>
                                <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-[var(--text-secondary)] sm:text-base sm:leading-7">Choose the moments that matter, review them in Picked, then submit when you're ready.</p>
                            </div>
                        </div>
                    )}
                </div>

                <footer data-testid="tutorial-footer" className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--bg-card)] p-3.5 sm:p-4">
                    <button type="button" disabled={activeStep.id === 'confidence' ? sampleIndex === 0 : safeStepIndex === 0} onClick={() => activeStep.id === 'confidence' ? setSampleIndex((current) => Math.max(0, current - 1)) : goToStep(safeStepIndex - 1)} className="flex h-10 items-center gap-1 rounded-md border border-[var(--border)] px-3 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-transform duration-150 ease-out active:scale-[0.97] disabled:invisible motion-reduce:transition-none"><ChevronLeft size={14} /> {activeStep.id === 'confidence' ? 'Previous' : 'Back'}</button>
                    {activeStep.id === 'confidence' ? (
                        <button type="button" onClick={() => sampleIndex < tutorialSampleSlots.length - 1 ? setSampleIndex((current) => current + 1) : goToStep(safeStepIndex + 1)} className="flex h-10 items-center gap-1 rounded-md bg-[var(--accent)] px-3 text-[10px] font-black uppercase tracking-[0.1em] text-[var(--bg-deep)] transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none">{sampleIndex < tutorialSampleSlots.length - 1 ? 'Next sample' : 'How to Submit'} <ChevronRight size={14} /></button>
                    ) : activeStep.id === 'ready' ? (
                        <button type="button" onClick={onClose} className="flex h-10 flex-1 items-center justify-center rounded-md bg-[var(--accent)] text-[10px] font-black uppercase tracking-[0.12em] text-[var(--bg-deep)] transition-[transform,opacity] duration-150 ease-out hover:opacity-85 active:scale-[0.98] motion-reduce:transition-none">Start selecting</button>
                    ) : activeStep.id === 'submit' ? (
                        <button type="button" onClick={() => goToStep(safeStepIndex + 1)} className="flex h-10 items-center gap-1 rounded-md bg-[var(--accent)] px-3 text-[10px] font-black uppercase tracking-[0.1em] text-[var(--bg-deep)] transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none">Ready To Choose <ChevronRight size={14} /></button>
                    ) : null}
                </footer>
            </section>}
            {introPhase !== 'ready' && <TutorialIntro theme={theme} onHandoffStart={startIntroHandoff} onComplete={finishIntro} onClose={onClose} />}
        </div>
    );
}
