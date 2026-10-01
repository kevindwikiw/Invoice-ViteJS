import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from 'react';
import { ImageOff, Loader2, MoveHorizontal } from 'lucide-react';
import clsx from 'clsx';

export function BeforeAfterSlider({ beforeUrl, afterUrl, testId = 'tutorial', frameClass = 'h-[clamp(20rem,58dvh,31rem)] md:h-[min(60dvh,34rem)]', aspectRatio, fallbackUrl }: {
    beforeUrl: string; afterUrl: string; testId?: 'tutorial' | 'delivery'; frameClass?: string; aspectRatio?: number; fallbackUrl?: string;
}) {
    const mediaSlotRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const touchStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
    const [position, setPosition] = useState(50);
    const [failedAssets, setFailedAssets] = useState({ before: false, after: false });
    const [loadedAssets, setLoadedAssets] = useState({ before: false, after: false });
    const [placeholderUrl, setPlaceholderUrl] = useState('');
    const [sourceAspectRatio, setSourceAspectRatio] = useState(aspectRatio || 4 / 3);
    const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null);
    const [attempt, setAttempt] = useState(0);
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
        if (asset === 'after' && !aspectRatio && naturalWidth > 0 && naturalHeight > 0) setSourceAspectRatio(naturalWidth / naturalHeight);
        setPlaceholderUrl((current) => current || image.currentSrc || image.src);

        const markDecoded = () => { if (image.isConnected) setLoadedAssets((current) => ({ ...current, [asset]: true })); };
        if (typeof image.decode !== 'function') {
            markDecoded();
            return;
        }
        void image.decode().then(markDecoded).catch(() => { if (image.isConnected) setFailedAssets((current) => ({ ...current, [asset]: true })); });
    };

    const updatePosition = (clientX: number) => {
        const bounds = stageRef.current?.getBoundingClientRect();
        if (!bounds || bounds.width <= 0) return;
        setPosition(Math.min(100, Math.max(0, ((clientX - bounds.left) / bounds.width) * 100)));
    };

    const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.stopPropagation();
        if (event.target instanceof Element && event.target.closest('button:not([role="slider"]), input, a')) return;
        if (event.pointerType === 'mouse') {
            event.currentTarget.setPointerCapture(event.pointerId);
            updatePosition(event.clientX);
            return;
        }

        touchStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    };

    const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.stopPropagation();
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
        event.stopPropagation();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (touchStartRef.current?.pointerId === event.pointerId) touchStartRef.current = null;
    };

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) event.stopPropagation();
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
        <div className={testId === 'delivery' ? 'h-full w-full' : undefined}>
            <div ref={mediaSlotRef} data-testid={`${testId}-media-slot`} className={clsx('relative flex w-full items-center justify-center overflow-hidden bg-black', frameClass)}>
                <div
                    ref={stageRef}
                    data-testid={`${testId}-before-after-slider`}
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
                            key={`after-${attempt}`}
                            src={afterUrl}
                            alt="Edited result sample"
                            loading="eager"
                            decoding="async"
                            fetchPriority="high"
                            className={clsx('absolute inset-0 h-full w-full object-contain transition-opacity duration-150 ease-out motion-reduce:transition-none', pairReady ? 'opacity-100' : 'opacity-0')}
                            onLoad={(event) => handleAssetLoad('after', event)}
                            onError={() => setFailedAssets((current) => ({ ...current, after: true }))}
                        />
                    )}
                    {!failedAssets.before && (
                        <img
                            key={`before-${attempt}`}
                            src={beforeUrl}
                            alt="Before editing sample"
                            loading="eager"
                            decoding="async"
                            fetchPriority="high"
                            className={clsx('absolute inset-0 h-full w-full object-contain transition-opacity duration-150 ease-out motion-reduce:transition-none', pairReady ? 'opacity-100' : 'opacity-0')}
                            style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
                            onLoad={(event) => handleAssetLoad('before', event)}
                            onError={() => setFailedAssets((current) => ({ ...current, before: true }))}
                        />
                    )}

                    {!failedAssets.before && !failedAssets.after && !pairReady && (
                        <div data-testid={`${testId}-image-loading`} className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center overflow-hidden bg-black text-white/75" aria-label="Loading comparison photos">
                            {fallbackUrl && <span className="absolute bottom-2 z-10 bg-black/80 px-3 py-2 text-xs text-white">Loading Comparison...</span>}
                            {(fallbackUrl || placeholderUrl) && <img data-testid={`${testId}-image-placeholder`} aria-hidden="true" src={fallbackUrl || placeholderUrl} alt="" className={clsx("absolute inset-0 h-full w-full object-contain", !fallbackUrl && "opacity-70 blur-[12px]")} />}
                            <span className="absolute inset-0 bg-black/25" />
                            <Loader2 size={20} className="relative animate-spin motion-reduce:animate-none" />
                        </div>
                    )}

                    {(failedAssets.before || failedAssets.after) && (
                        <div className="absolute inset-0 z-30 flex items-end justify-center pb-4">
                            {fallbackUrl && <img src={fallbackUrl} alt="Edited photo" className="absolute inset-0 h-full w-full object-contain" />}
                            <div role="alert" className="relative flex flex-wrap items-center justify-center gap-2 bg-black/85 px-3 py-2 text-xs text-white">
                                <ImageOff size={16} /> Comparison Unavailable
                                <button type="button" className="min-h-11 px-3 font-semibold underline" onClick={() => { setFailedAssets({ before: false, after: false }); setLoadedAssets({ before: false, after: false }); setAttempt((value) => value + 1); }}>Retry</button>
                            </div>
                        </div>
                    )}

                    {pairReady && (
                        <>
                            <span className="pointer-events-none absolute left-2 top-2 z-10 border border-white/10 bg-black/75 px-2 py-1 text-xs font-semibold text-white shadow-sm backdrop-blur-md">Before</span>
                            <span className="pointer-events-none absolute right-2 top-2 z-10 border border-white/10 bg-black/75 px-2 py-1 text-xs font-semibold text-white shadow-sm backdrop-blur-md">Edited</span>
                            <span data-testid={`${testId}-slider-divider`} className="pointer-events-none absolute top-[calc(50%_-_3.25rem)] z-10 h-7 w-px bg-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.18)]" style={{ left: `${position}%` }} />
                            <span data-testid={`${testId}-slider-divider`} className="pointer-events-none absolute bottom-[calc(50%_-_3.25rem)] z-10 h-7 w-px bg-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.18)]" style={{ left: `${position}%` }} />
                            <button
                                type="button"
                                data-testid={`${testId}-slider-handle`}
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

        </div>
    );
}
