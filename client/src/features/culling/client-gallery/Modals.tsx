import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react';
import { AlertCircle, Check, CheckSquare, ChevronLeft, ChevronRight, Images, ImageOff, Loader2, MessageCircle, MoveHorizontal, QrCode, ScanFace, Send, X } from 'lucide-react';
import clsx from 'clsx';

import { calculateAddonQuote, cullingTutorialImageUrl, createQrisPayment, type QrisPaymentResponse } from '../culling.public';
import type { DiscountRule } from '../culling.types';

import { idrFormat } from './constants';
import { QrisModal } from './QrisModal';

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
                        {clearsSelection ? 'This removes all previously submitted photos. You can select and submit them again later.' : 'Orbit will receive these filenames. You can revise your choices and submit again later.'}
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
    const mediaSlotRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const touchStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
    const [position, setPosition] = useState(50);
    const [failedAssets, setFailedAssets] = useState({ before: false, after: false });
    const [loadedAssets, setLoadedAssets] = useState({ before: false, after: false });
    const [placeholderUrl, setPlaceholderUrl] = useState('');
    const [sourceAspectRatio, setSourceAspectRatio] = useState(4 / 3);
    const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null);
    const beforeUrl = cullingTutorialImageUrl(galleryId, token, slot, 'before');
    const afterUrl = cullingTutorialImageUrl(galleryId, token, slot, 'after');
    const pairReady = loadedAssets.before && loadedAssets.after;

    useLayoutEffect(() => {
        const mediaSlot = mediaSlotRef.current;
        if (!mediaSlot) return;

        const fitStageToSlot = () => {
            const bounds = mediaSlot.getBoundingClientRect();
            if (bounds.width <= 0 || bounds.height <= 0) return;
            const width = Math.min(bounds.width, bounds.height * sourceAspectRatio);
            setStageSize({ width, height: width / sourceAspectRatio });
        };

        fitStageToSlot();
        const observer = new ResizeObserver(fitStageToSlot);
        observer.observe(mediaSlot);
        return () => observer.disconnect();
    }, [sourceAspectRatio]);

    const handleAssetLoad = (asset: 'before' | 'after', event: SyntheticEvent<HTMLImageElement>) => {
        const image = event.currentTarget;
        const { naturalWidth, naturalHeight } = image;
        if (naturalWidth > 0 && naturalHeight > 0) setSourceAspectRatio(naturalWidth / naturalHeight);
        setPlaceholderUrl((current) => current || image.currentSrc || image.src);

        const markDecoded = () => setLoadedAssets((current) => ({ ...current, [asset]: true }));
        if (typeof image.decode !== 'function') {
            markDecoded();
            return;
        }
        void image.decode().catch(() => undefined).finally(markDecoded);
    };

    const updatePosition = (clientX: number) => {
        const bounds = stageRef.current?.getBoundingClientRect();
        if (!bounds || bounds.width <= 0) return;
        setPosition(Math.min(100, Math.max(0, ((clientX - bounds.left) / bounds.width) * 100)));
    };

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.pointerType === 'mouse') {
            event.currentTarget.setPointerCapture(event.pointerId);
            updatePosition(event.clientX);
            return;
        }

        touchStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    };

    const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            updatePosition(event.clientX);
            return;
        }

        const start = touchStartRef.current;
        if (!start || start.pointerId !== event.pointerId) return;
        const deltaX = Math.abs(event.clientX - start.x);
        const deltaY = Math.abs(event.clientY - start.y);
        if (deltaX < 6 || deltaX <= deltaY) return;

        event.currentTarget.setPointerCapture(event.pointerId);
        updatePosition(event.clientX);
    };

    const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (touchStartRef.current?.pointerId === event.pointerId) touchStartRef.current = null;
    };

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        const step = event.shiftKey ? 10 : 5;
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            setPosition((current) => Math.max(0, current - step));
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            setPosition((current) => Math.min(100, current + step));
        } else if (event.key === 'Home') {
            event.preventDefault();
            setPosition(0);
        } else if (event.key === 'End') {
            event.preventDefault();
            setPosition(100);
        }
    };

    return (
        <div>
            <div ref={mediaSlotRef} data-testid="tutorial-media-slot" className="relative flex h-[clamp(20rem,58dvh,31rem)] w-full items-center justify-center overflow-hidden bg-black md:h-[min(60dvh,34rem)]">
                <div
                    ref={stageRef}
                    data-testid="tutorial-before-after-slider"
                    className="relative shrink-0 touch-pan-y overflow-hidden bg-black"
                    style={stageSize ? { width: stageSize.width, height: stageSize.height } : { width: '100%', aspectRatio: sourceAspectRatio }}
                    aria-busy={!pairReady && !failedAssets.before && !failedAssets.after}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={finishPointer}
                    onPointerCancel={finishPointer}
                >
                    {!failedAssets.after && (
                        <img
                            src={afterUrl}
                            alt="Edited result sample"
                            loading="eager"
                            decoding="async"
                            fetchPriority="high"
                            className={clsx('absolute inset-0 h-full w-full object-cover transition-opacity duration-150 ease-out motion-reduce:transition-none', pairReady ? 'opacity-100' : 'opacity-0')}
                            onLoad={(event) => handleAssetLoad('after', event)}
                            onError={() => setFailedAssets((current) => ({ ...current, after: true }))}
                        />
                    )}
                    {!failedAssets.before && (
                        <img
                            src={beforeUrl}
                            alt="Before editing sample"
                            loading="eager"
                            decoding="async"
                            fetchPriority="high"
                            className={clsx('absolute inset-0 h-full w-full object-cover transition-opacity duration-150 ease-out motion-reduce:transition-none', pairReady ? 'opacity-100' : 'opacity-0')}
                            style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
                            onLoad={(event) => handleAssetLoad('before', event)}
                            onError={() => setFailedAssets((current) => ({ ...current, before: true }))}
                        />
                    )}

                    {!failedAssets.before && !failedAssets.after && !pairReady && (
                        <div data-testid="tutorial-image-loading" className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center overflow-hidden bg-black text-white/75" aria-label="Loading comparison photos">
                            {placeholderUrl && <img data-testid="tutorial-image-placeholder" aria-hidden="true" src={placeholderUrl} alt="" className="absolute inset-0 h-full w-full scale-[1.04] object-cover opacity-70 blur-[12px]" />}
                            <span className="absolute inset-0 bg-black/25" />
                            <Loader2 size={20} className="relative animate-spin motion-reduce:animate-none" />
                        </div>
                    )}

                    {(failedAssets.before || failedAssets.after) && (
                        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[var(--bg-elevated)] px-6 text-center text-[var(--text-muted)]">
                            <ImageOff size={24} className="mb-2 opacity-65" />
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em]">Tutorial photos unavailable</p>
                            <p className="mt-1 max-w-xs text-[10px] leading-4">Set both sample files in this gallery&apos;s admin settings and share them with the Drive service account.</p>
                        </div>
                    )}

                    {pairReady && (
                        <>
                            <span className="pointer-events-none absolute left-2 top-2 z-10 border border-white/10 bg-black/75 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-white shadow-sm backdrop-blur-md">Before</span>
                            <span className="pointer-events-none absolute right-2 top-2 z-10 border border-white/10 bg-black/75 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-white shadow-sm backdrop-blur-md">Edited</span>
                            <span data-testid="tutorial-slider-divider" className="pointer-events-none absolute top-[calc(50%_-_3.25rem)] z-10 h-7 w-px bg-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.18)]" style={{ left: `${position}%` }} />
                            <span data-testid="tutorial-slider-divider" className="pointer-events-none absolute bottom-[calc(50%_-_3.25rem)] z-10 h-7 w-px bg-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.18)]" style={{ left: `${position}%` }} />
                            <button
                                type="button"
                                data-testid="tutorial-slider-handle"
                                role="slider"
                                aria-label="Compare before and edited photo"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={Math.round(position)}
                                onKeyDown={handleKeyDown}
                                className="absolute top-1/2 z-20 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/75 bg-black/60 text-white shadow-[0_4px_18px_rgb(0_0_0/0.28)] backdrop-blur-md transition-[transform,background-color] duration-150 ease-out hover:scale-105 hover:bg-black/75 active:scale-[0.96] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none"
                                style={{ left: `${position}%` }}
                            >
                                <MoveHorizontal size={17} strokeWidth={1.8} />
                            </button>
                        </>
                    )}
                </div>
            </div>
            <p className="mt-2 text-center text-[10px] text-[var(--text-muted)]">Drag to compare.</p>
        </div>
    );
}

export function TutorialModal({ galleryId, token, tutorialSampleSlots, onClose }: { galleryId: string; token: string; tutorialSampleSlots: number[]; onClose: () => void }) {
    const hasSamples = tutorialSampleSlots.length > 0;
    const [stepIndex, setStepIndex] = useState(0);
    const [sampleIndex, setSampleIndex] = useState(0);
    const scrollAreaRef = useRef<HTMLDivElement>(null);

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

    const goToStep = (nextIndex: number) => {
        setStepIndex(Math.min(wizardSteps.length - 1, Math.max(0, nextIndex)));
    };

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center overscroll-contain bg-black/70 px-2 py-2 sm:px-4 sm:py-4" role="dialog" aria-modal="true" aria-label="How photo selection works" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <section data-testid="tutorial-panel" className="flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-full max-w-lg flex-col overflow-hidden border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-2xl sm:h-[min(56rem,calc(100dvh-2rem))] sm:max-h-[calc(100dvh-2rem)] md:max-w-2xl">
                <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border)] px-4 py-3.5 sm:px-5 sm:py-4">
                    <div>
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">ORBIT GUIDE</p>
                        <h2 className="mt-1 font-display text-xl">{stepTitle}</h2>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close tutorial" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--border)] transition-[transform,border-color] duration-150 ease-out hover:border-[var(--accent)] active:scale-[0.97] motion-reduce:transition-none"><X size={15} /></button>
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
                        <div data-testid="tutorial-submit-step">
                            <p className="mx-auto max-w-md text-center text-sm leading-6 text-[var(--text-secondary)]">Choose at your own pace. These five steps take you from the full gallery to a reviewed selection.</p>
                            <ol data-testid="tutorial-submit-steps" className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]">
                                {[
                                    { icon: <Images size={15} />, title: 'Browse the Gallery', text: 'Scroll through the gallery and open any photo for a closer look.' },
                                    { icon: <ScanFace size={15} />, title: 'Filter by Selfie', text: 'Use a clear selfie to find your photos. Tap All Photos to return to the full gallery.' },
                                    { icon: <Check size={15} />, title: 'Choose Favorites', text: 'Tap the check button on every photo you want to keep.' },
                                    { icon: <CheckSquare size={15} />, title: 'Review Picked', text: 'Open Picked to compare your choices and remove anything before finalizing.' },
                                    { icon: <Send size={15} />, title: 'Submit Your Selection', text: 'Confirm the final count. You can revise and submit again later.' },
                                ].map((item, index) => (
                                    <li key={item.title} className="flex gap-3 py-3.5 sm:py-4">
                                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--text-primary)]">{item.icon}</span>
                                        <div className="min-w-0"><p className="text-xs font-semibold"><span className="mr-1.5 text-[var(--text-muted)]">{index + 1}.</span>{item.title}</p><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{item.text}</p></div>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}

                    {activeStep.id === 'ready' && (
                        <div data-testid="tutorial-ready-step" className="flex min-h-full flex-col justify-center py-3 text-center">
                            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[var(--accent)] text-[var(--accent)]"><Check size={24} /></div>
                            <p className="mt-5 font-display text-2xl">Ready When You Are</p>
                            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[var(--text-secondary)]">Take your time and trust your eye. There is no pressure to finish everything in one visit.</p>
                            <div data-testid="tutorial-ready-checklist" className="mx-auto mt-7 w-full max-w-sm divide-y divide-[var(--border)] border-y border-[var(--border)] text-left">
                                {[
                                    ['Choose What Feels Meaningful', 'Keep the moments that tell your story, not only the technically perfect frames.'],
                                    ['Review Before Submitting', 'Use Picked to see your selection together and check the final count.'],
                                    ['Revise Whenever Needed', 'Your latest submission can be updated later while the gallery remains open.'],
                                ].map(([title, text]) => (
                                    <div key={title} className="flex gap-3 py-3.5">
                                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[var(--bg-deep)]"><Check size={13} strokeWidth={2.5} /></span>
                                        <div><p className="text-xs font-semibold text-[var(--text-primary)]">{title}</p><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{text}</p></div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <footer data-testid="tutorial-footer" className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--bg-card)] p-3.5 sm:p-4">
                    <button type="button" disabled={activeStep.id === 'confidence' ? sampleIndex === 0 : safeStepIndex === 0} onClick={() => activeStep.id === 'confidence' ? setSampleIndex((current) => Math.max(0, current - 1)) : goToStep(safeStepIndex - 1)} className="flex h-10 items-center gap-1 rounded-md border border-[var(--border)] px-3 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-transform duration-150 ease-out active:scale-[0.97] disabled:invisible motion-reduce:transition-none"><ChevronLeft size={14} /> {activeStep.id === 'confidence' ? 'Previous' : 'Back'}</button>
                    {activeStep.id === 'confidence' ? (
                        <button type="button" onClick={() => sampleIndex < tutorialSampleSlots.length - 1 ? setSampleIndex((current) => current + 1) : goToStep(safeStepIndex + 1)} className="flex h-10 items-center gap-1 rounded-md bg-[var(--accent)] px-3 text-[10px] font-black uppercase tracking-[0.1em] text-[var(--bg-deep)] transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none">{sampleIndex < tutorialSampleSlots.length - 1 ? 'Next sample' : 'How to submit'} <ChevronRight size={14} /></button>
                    ) : activeStep.id === 'ready' ? (
                        <button type="button" onClick={onClose} className="flex h-10 flex-1 items-center justify-center rounded-md bg-[var(--accent)] text-[10px] font-black uppercase tracking-[0.12em] text-[var(--bg-deep)] transition-[transform,opacity] duration-150 ease-out hover:opacity-85 active:scale-[0.98] motion-reduce:transition-none">Start selecting</button>
                    ) : activeStep.id === 'submit' ? (
                        <button type="button" onClick={() => goToStep(safeStepIndex + 1)} className="flex h-10 items-center gap-1 rounded-md bg-[var(--accent)] px-3 text-[10px] font-black uppercase tracking-[0.1em] text-[var(--bg-deep)] transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none">Ready To Choose <ChevronRight size={14} /></button>
                    ) : null}
                </footer>
            </section>
        </div>
    );
}
