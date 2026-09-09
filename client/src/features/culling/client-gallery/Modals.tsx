import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react';
import { AlertCircle, Check, CheckSquare, ChevronLeft, ChevronRight, GripVertical, ImageOff, Loader2, MessageCircle, Send, X } from 'lucide-react';
import clsx from 'clsx';

import { calculateAddonQuote, cullingTutorialImageUrl } from '../culling.public';
import type { DiscountRule } from '../culling.types';

import { idrFormat } from './constants';

export function RequestMoreModal({
    requestedCount,
    selectedCount,
    unitPrice,
    discountRules,
    requestUrl,
    onChange,
    onClose,
}: {
    requestedCount: number;
    selectedCount: number;
    unitPrice: number;
    discountRules?: DiscountRule[];
    requestUrl: string;
    onChange: (count: number) => void;
    onClose: () => void;
}) {
    const quote = calculateAddonQuote(requestedCount, unitPrice, discountRules);

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

                <a href={requestUrl} target="_blank" rel="noreferrer" onClick={onClose} className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] text-[10px] font-black uppercase tracking-[0.12em] text-[var(--bg-deep)] transition-opacity hover:opacity-85">
                    <MessageCircle size={14} /> Request via WhatsApp
                </a>
                <p className="mt-3 text-center text-[10px] leading-4 text-[var(--text-muted)]">The additional quota becomes active after Orbit confirms payment.</p>
            </section>
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
    const stageRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState(50);
    const [aspectRatio, setAspectRatio] = useState('4 / 3');
    const [failedAssets, setFailedAssets] = useState({ before: false, after: false });

    const updatePosition = (clientX: number) => {
        const bounds = stageRef.current?.getBoundingClientRect();
        if (!bounds || bounds.width <= 0) return;
        setPosition(Math.min(100, Math.max(0, ((clientX - bounds.left) / bounds.width) * 100)));
    };

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        updatePosition(event.clientX);
    };

    const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) updatePosition(event.clientX);
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

    const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
        const image = event.currentTarget;
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
            setAspectRatio(`${image.naturalWidth} / ${image.naturalHeight}`);
        }
    };

    return (
        <div>
            <div
                ref={stageRef}
                data-testid="tutorial-before-after-slider"
                className="relative mx-auto w-full max-w-[680px] touch-none overflow-hidden bg-black/15"
                style={{ aspectRatio }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
                onPointerCancel={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
            >
                {!failedAssets.after && (
                    <img
                        src={cullingTutorialImageUrl(galleryId, token, slot, 'after')}
                        alt="Edited result sample"
                        className="absolute inset-0 h-full w-full object-contain"
                        onLoad={handleImageLoad}
                        onError={() => setFailedAssets((current) => ({ ...current, after: true }))}
                    />
                )}
                {!failedAssets.before && (
                    <img
                        src={cullingTutorialImageUrl(galleryId, token, slot, 'before')}
                        alt="Before editing sample"
                        className="absolute inset-0 h-full w-full object-contain"
                        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
                        onLoad={handleImageLoad}
                        onError={() => setFailedAssets((current) => ({ ...current, before: true }))}
                    />
                )}

                {(failedAssets.before || failedAssets.after) && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--bg-elevated)] px-6 text-center text-[var(--text-muted)]">
                        <ImageOff size={24} className="mb-2 opacity-65" />
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em]">Tutorial photos unavailable</p>
                        <p className="mt-1 max-w-xs text-[10px] leading-4">Set both sample files in this gallery&apos;s admin settings and share them with the Drive service account.</p>
                    </div>
                )}

                <span className="pointer-events-none absolute left-2 top-2 z-10 bg-black/60 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-white backdrop-blur">Before</span>
                <span className="pointer-events-none absolute right-2 top-2 z-10 bg-black/60 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-white backdrop-blur">Edited</span>
                <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.22)]" style={{ left: `${position}%` }} />
                <button
                    type="button"
                    data-testid="tutorial-slider-handle"
                    role="slider"
                    aria-label="Compare before and edited photo"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(position)}
                    onKeyDown={handleKeyDown}
                    className="absolute top-1/2 z-20 flex h-10 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center border border-white/70 bg-black/55 text-white shadow-lg backdrop-blur transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
                    style={{ left: `${position}%` }}
                >
                    <GripVertical size={16} />
                </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-[var(--text-muted)]">Drag the handle or use the arrow keys to compare.</p>
        </div>
    );
}

export function TutorialModal({ galleryId, token, tutorialSampleSlots, onClose }: { galleryId: string; token: string; tutorialSampleSlots: number[]; onClose: () => void }) {
    const hasSamples = tutorialSampleSlots.length > 0;
    const [stepIndex, setStepIndex] = useState(0);
    const [sampleIndex, setSampleIndex] = useState(0);

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    const wizardSteps = [
        ...(hasSamples ? [{ id: 'confidence', label: 'Choose' }] : []),
        { id: 'submit', label: 'Submit' },
        { id: 'ready', label: 'Ready' },
    ] as const;
    const safeStepIndex = Math.min(stepIndex, wizardSteps.length - 1);
    const activeStep = wizardSteps[safeStepIndex];
    const activeSampleSlot = tutorialSampleSlots[sampleIndex] || tutorialSampleSlots[0];
    const stepTitle = activeStep.id === 'confidence' ? 'Choose with confidence' : activeStep.id === 'submit' ? 'How to submit' : 'Ready to choose';

    const goToStep = (nextIndex: number) => {
        setStepIndex(Math.min(wizardSteps.length - 1, Math.max(0, nextIndex)));
    };

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 px-4 py-4" role="dialog" aria-modal="true" aria-label="How photo selection works" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <section className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-2xl">
                <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
                    <div>
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">ORBIT GUIDE</p>
                        <h2 className="mt-1 font-display text-xl">{stepTitle}</h2>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close tutorial" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] transition-colors hover:border-[var(--accent)]"><X size={14} /></button>
                </header>

                <nav aria-label="Tutorial progress" className="grid border-b border-[var(--border)] px-5 py-3" style={{ gridTemplateColumns: `repeat(${wizardSteps.length}, minmax(0, 1fr))` }}>
                    {wizardSteps.map((step, index) => (
                        <button
                            key={step.id}
                            type="button"
                            onClick={() => goToStep(index)}
                            aria-current={safeStepIndex === index ? 'step' : undefined}
                            className={clsx('flex items-center justify-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.1em] transition-colors motion-reduce:transition-none', safeStepIndex === index ? 'text-[var(--text-primary)]' : index < safeStepIndex ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]')}
                        >
                            <span className={clsx('flex h-5 w-5 items-center justify-center rounded-full border text-[9px]', safeStepIndex === index ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]' : 'border-[var(--border)]')}>{index + 1}</span>
                            <span className="hidden sm:inline">{step.label}</span>
                        </button>
                    ))}
                </nav>

                <div className="min-h-0 overflow-y-auto px-5 py-5">
                    {activeStep.id === 'confidence' && (
                        <div data-testid="tutorial-confidence-step">
                            <div className="flex items-center justify-between gap-3">
                                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-[var(--text-muted)]">Sample {String(sampleIndex + 1).padStart(2, '0')} / {String(tutorialSampleSlots.length).padStart(2, '0')}</p>
                                <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Before / Edited</p>
                            </div>
                            <div className="mt-2">
                                <BeforeAfterSlider key={activeSampleSlot} galleryId={galleryId} token={token} slot={activeSampleSlot} />
                            </div>
                            <p className="mx-auto mt-4 max-w-md text-center text-xs leading-5 text-[var(--text-muted)]">Look for the feeling, connection, and story you want to keep. The edit is there to polish the moment, not change why it matters.</p>
                            {tutorialSampleSlots.length > 1 && (
                                <div className="mt-4 flex items-center justify-center gap-2" aria-label="Tutorial samples">
                                    {tutorialSampleSlots.map((slot, index) => (
                                        <button key={slot} type="button" onClick={() => setSampleIndex(index)} aria-label={`View sample ${index + 1}`} aria-current={sampleIndex === index ? 'true' : undefined} className={clsx('h-2 rounded-full transition-[width,background-color] motion-reduce:transition-none', sampleIndex === index ? 'w-6 bg-[var(--accent)]' : 'w-2 bg-[var(--border)] hover:bg-[var(--text-muted)]')} />
                                    ))}
                                </div>
                            )}
                            <div className="mt-4 flex items-center justify-between gap-2">
                                <button type="button" disabled={sampleIndex === 0} onClick={() => setSampleIndex((current) => Math.max(0, current - 1))} aria-label="Previous sample" className="flex h-9 items-center gap-1 rounded-md border border-[var(--border)] px-3 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)] disabled:opacity-35"><ChevronLeft size={14} /> Previous</button>
                                <button type="button" onClick={() => sampleIndex < tutorialSampleSlots.length - 1 ? setSampleIndex((current) => current + 1) : goToStep(safeStepIndex + 1)} className="flex h-9 items-center gap-1 rounded-md bg-[var(--accent)] px-3 text-[10px] font-black uppercase tracking-[0.1em] text-[var(--bg-deep)]">{sampleIndex < tutorialSampleSlots.length - 1 ? 'Next sample' : 'How to submit'} <ChevronRight size={14} /></button>
                            </div>
                        </div>
                    )}

                    {activeStep.id === 'submit' && (
                        <div data-testid="tutorial-submit-step">
                            <p className="mx-auto max-w-md text-center text-sm leading-6 text-[var(--text-secondary)]">Your job is to choose the moments. Orbit receives the filenames and prepares the final edited delivery.</p>
                            <ol className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">
                                {[
                                    { icon: <Check size={15} />, title: 'Choose favorites', text: 'Tap the check button on the photos you love.' },
                                    { icon: <CheckSquare size={15} />, title: 'Review Picked', text: 'Open Picked to see your current choices together.' },
                                    { icon: <Send size={15} />, title: 'Submit when ready', text: 'Confirm the final count. You can revise and submit again later.' },
                                ].map((item, index) => (
                                    <li key={item.title} className="flex gap-3 py-3.5">
                                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--text-primary)]">{item.icon}</span>
                                        <div className="min-w-0"><p className="text-xs font-semibold"><span className="mr-1.5 text-[var(--text-muted)]">{index + 1}.</span>{item.title}</p><p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{item.text}</p></div>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}

                    {activeStep.id === 'ready' && (
                        <div data-testid="tutorial-ready-step" className="py-4 text-center">
                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-[var(--accent)] text-[var(--accent)]"><Check size={22} /></div>
                            <p className="mt-5 font-display text-2xl">Ready when you are.</p>
                            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[var(--text-secondary)]">Take your time, trust your eye, and pick the moments you want Orbit to finish beautifully.</p>
                        </div>
                    )}
                </div>

                <footer className="flex items-center justify-between gap-2 border-t border-[var(--border)] p-4">
                    <button type="button" disabled={safeStepIndex === 0} onClick={() => goToStep(safeStepIndex - 1)} className="flex h-10 items-center gap-1 rounded-md border border-[var(--border)] px-3 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)] disabled:invisible"><ChevronLeft size={14} /> Back</button>
                    {activeStep.id === 'ready' ? (
                        <button type="button" onClick={onClose} className="flex h-10 flex-1 items-center justify-center rounded-md bg-[var(--accent)] text-[10px] font-black uppercase tracking-[0.12em] text-[var(--bg-deep)] transition-opacity hover:opacity-85">Start selecting</button>
                    ) : activeStep.id === 'submit' ? (
                        <button type="button" onClick={() => goToStep(safeStepIndex + 1)} className="flex h-10 items-center gap-1 rounded-md bg-[var(--accent)] px-3 text-[10px] font-black uppercase tracking-[0.1em] text-[var(--bg-deep)]">Ready to choose <ChevronRight size={14} /></button>
                    ) : null}
                </footer>
            </section>
        </div>
    );
}
