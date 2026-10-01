import { useCallback, useEffect, useRef, useState, memo } from 'react';
import { Check, ChevronLeft, ChevronRight, Download, ImageOff, X } from 'lucide-react';
import clsx from 'clsx';

import { galleryPreviewUrl, galleryThumbnailUrl } from '../culling.public';
import type { GalleryDisplayPhoto } from '../culling.types';

import { displayPhotoLabel, photoDisplayIndex } from './photo-labels';
import { canPrefetchPreview, isPreviewImageReady, preloadPreviewImage } from './preview-cache';
import { BeforeAfterSlider } from './BeforeAfterSlider';

function LightboxView<T extends GalleryDisplayPhoto>({
    galleryId,
    token,
    photos,
    displayStartIndex,
    currentPhotoId,
    selectedIds,
    mode = 'selection',
    getPreviewUrl,
    getThumbnailUrl,
    getDownloadUrl,
    getComparison,
    hasPreviousPage = false,
    hasNextPage = false,
    totalCount,
    onClose,
    onMove,
    onPreviousPage,
    onNextPage,
    onToggle,
}: {
    galleryId: string;
    token: string;
    photos: T[];
    displayStartIndex: number;
    currentPhotoId: string | null;
    selectedIds?: Set<string>;
    mode?: 'selection' | 'delivery';
    getPreviewUrl?: (photo: T) => string;
    getThumbnailUrl?: (photo: T) => string;
    getDownloadUrl?: (photo: T) => string;
    getComparison?: (photo: T) => { thumbnailUrl: string; previewUrl: string } | null | undefined;
    hasPreviousPage?: boolean;
    hasNextPage?: boolean;
    totalCount?: number;
    onClose: () => void;
    onMove: (driveFileId: string) => void;
    onPreviousPage?: () => void;
    onNextPage?: () => void;
    onToggle?: (photo: T) => void;
}) {
    const currentIndex = currentPhotoId ? photos.findIndex((item) => item.driveFileId === currentPhotoId) : -1;
    const photo = currentIndex >= 0 ? photos[currentIndex] : null;
    const selected = photo ? selectedIds?.has(photo.driveFileId) : false;
    const previewUrlFor = useCallback((item: T) => getPreviewUrl ? getPreviewUrl(item) : galleryPreviewUrl(galleryId, item.driveFileId, token, item.photoToken), [galleryId, token, getPreviewUrl]);
    const currentUrl = photo ? previewUrlFor(photo) : '';
    const placeholderUrl = photo ? (getThumbnailUrl ? getThumbnailUrl(photo) : galleryThumbnailUrl(galleryId, photo.driveFileId, token, photo.photoToken)) : '';
    const displayLabel = photo ? displayPhotoLabel(photo, photoDisplayIndex(photo, displayStartIndex + currentIndex)) : '';
    const [loadedUrl, setLoadedUrl] = useState('');
    const [failedUrl, setFailedUrl] = useState('');
    const [comparisonEnabled, setComparisonEnabled] = useState(false);
    const comparison = photo && mode === 'delivery' ? getComparison?.(photo) : null;
    useEffect(() => {
        // Also reset when a tab change closes the lightbox from its parent.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (!currentPhotoId) setComparisonEnabled(false);
    }, [currentPhotoId]);
    const moveRequestRef = useRef(0);
    const swipeStartXRef = useRef<number | null>(null);
    const currentImageReady = Boolean(currentUrl) && (loadedUrl === currentUrl || isPreviewImageReady(currentUrl));
    const canMovePrevious = currentIndex > 0 || hasPreviousPage;
    const canMoveNext = currentIndex >= 0 && (currentIndex < photos.length - 1 || hasNextPage);
    const displayPosition = displayStartIndex + currentIndex + 1;
    const displayTotal = totalCount || photos.length;

    const closeLightbox = useCallback(() => {
        setComparisonEnabled(false);
        moveRequestRef.current += 1;
        onClose();
    }, [onClose]);

    const requestMove = useCallback((nextIndex: number) => {
        if (currentIndex < 0 || nextIndex === currentIndex) return;

        if (nextIndex < 0) {
            if (hasPreviousPage) {
                moveRequestRef.current += 1;
                onPreviousPage?.();
            }
            return;
        }

        if (nextIndex >= photos.length) {
            if (hasNextPage) {
                moveRequestRef.current += 1;
                onNextPage?.();
            }
            return;
        }

        const nextPhoto = photos[nextIndex];
        if (!nextPhoto) return;
        const nextUrl = previewUrlFor(nextPhoto);
        moveRequestRef.current += 1;
        onMove(nextPhoto.driveFileId);
        void preloadPreviewImage(nextUrl, 'high').catch(() => undefined);
    }, [currentIndex, previewUrlFor, hasNextPage, hasPreviousPage, onMove, onNextPage, onPreviousPage, photos]);

    useEffect(() => {
        if (!currentUrl || isPreviewImageReady(currentUrl)) return;

        let active = true;
        void preloadPreviewImage(currentUrl, 'high')
            .then(() => {
                if (active) setLoadedUrl(currentUrl);
            })
            .catch(() => {
                if (active) setFailedUrl(currentUrl);
            });

        return () => {
            active = false;
        };
    }, [currentUrl]);

    useEffect(() => {
        if (currentIndex < 0 || !canPrefetchPreview()) return;

        const neighborOffsets = [1, 2, 3, 4, 5, -1, -2];
        const timers: number[] = [];

        neighborOffsets.forEach((offset, index) => {
            const neighborIndex = currentIndex + offset;
            const neighbor = photos[neighborIndex];
            if (!neighbor) return;
            const neighborUrl = previewUrlFor(neighbor);
            if (isPreviewImageReady(neighborUrl)) return;

            const timer = window.setTimeout(() => {
                if (canPrefetchPreview()) void preloadPreviewImage(neighborUrl, 'low').catch(() => undefined);
            }, index * 60);
            timers.push(timer);
        });

        return () => timers.forEach((timer) => window.clearTimeout(timer));
    }, [currentIndex, previewUrlFor, photos]);

    useEffect(() => {
        if (!photo || currentIndex < 0) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                closeLightbox();
                return;
            }

            const target = event.target;
            if (event.defaultPrevented || (target instanceof Element && target.closest('[role="slider"]'))) return;
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;

            if (event.key === 'ArrowLeft') requestMove(currentIndex - 1);
            if (event.key === 'ArrowRight') requestMove(currentIndex + 1);
            if (event.key === ' ' && mode === 'selection') {
                event.preventDefault();
                onToggle?.(photo);
            }
        };
        
        document.addEventListener('keydown', handleKey);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKey);
        };
    }, [closeLightbox, currentIndex, onToggle, photo, requestMove, mode]);

    if (!photo || currentIndex < 0) return null;

    return (
        <div className="fixed inset-0 z-[120] bg-black/95 text-white">
            <button type="button" aria-label="Close photo preview" onClick={closeLightbox} className="absolute right-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur transition-colors hover:border-[var(--accent)] sm:right-4 sm:top-4 sm:h-10 sm:w-10">
                <X size={16} />
            </button>

            <div className="grid h-dvh grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
                <div
                    data-testid="gallery-lightbox-stage"
                    className="relative flex min-h-0 touch-pan-y select-none items-center justify-center px-10 py-2 [-webkit-touch-callout:none] sm:px-16 sm:py-5"
                    onContextMenu={(event) => event.preventDefault()}
                    onPointerDown={(event) => {
                        if (event.pointerType === 'touch') swipeStartXRef.current = event.clientX;
                    }}
                    onPointerCancel={() => { swipeStartXRef.current = null; }}
                    onPointerUp={(event) => {
                        if (event.pointerType !== 'touch' || swipeStartXRef.current == null) return;
                        const distance = event.clientX - swipeStartXRef.current;
                        swipeStartXRef.current = null;
                        if (Math.abs(distance) < 48) return;
                        requestMove(distance < 0 ? currentIndex + 1 : currentIndex - 1);
                    }}
                >
                    {placeholderUrl && (
                        <img
                            key={`thumb-${placeholderUrl}`}
                            aria-hidden="true"
                            src={placeholderUrl}
                            alt=""
                            draggable={false}
                            className={clsx(
                                'pointer-events-none absolute z-0 block h-auto max-h-full w-auto max-w-full scale-[1.02] object-contain blur-[10px] transition-opacity duration-300',
                                currentImageReady && failedUrl !== currentUrl ? 'opacity-0' : 'opacity-80'
                            )}
                        />
                    )}
                    <button type="button" disabled={!canMovePrevious} aria-label="Previous photo" onClick={() => requestMove(currentIndex - 1)} className="absolute left-1.5 top-1/2 z-30 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur transition-opacity disabled:opacity-25 sm:left-4 sm:h-10 sm:w-10">
                        <ChevronLeft size={18} />
                    </button>
                    <button type="button" disabled={!canMoveNext} aria-label="Next photo" onClick={() => requestMove(currentIndex + 1)} className="absolute right-1.5 top-1/2 z-30 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur transition-opacity disabled:opacity-25 sm:right-4 sm:h-10 sm:w-10">
                        <ChevronRight size={18} />
                    </button>
                    {failedUrl === currentUrl && (
                        <div className="absolute flex flex-col items-center text-white/60">
                            <ImageOff size={26} />
                            <span className="mt-2 text-[10px] font-bold uppercase tracking-[0.14em]">Failed to load preview</span>
                        </div>
                    )}
                    {comparisonEnabled && comparison && <div className="absolute inset-y-2 left-10 right-10 z-20 sm:inset-y-5 sm:left-16 sm:right-16">
                        <BeforeAfterSlider key={`${photo.driveFileId}-${comparison.previewUrl}`} testId="delivery" beforeUrl={comparison.previewUrl} afterUrl={currentUrl} fallbackUrl={currentUrl} frameClass="h-full" aspectRatio={photo.width && photo.height ? photo.width / photo.height : undefined} />
                    </div>}
                    <img 
                        data-testid="gallery-lightbox-image"
                        key={currentUrl}
                        src={currentUrl}
                        alt={photo.filename}
                        draggable={false}
                        decoding="async"
                        fetchPriority="high"
                        className={clsx('z-10 block h-auto max-h-full w-auto max-w-full object-contain transition-opacity duration-150', currentImageReady && failedUrl !== currentUrl ? 'opacity-100' : 'opacity-0')}
                        onLoad={() => {
                            setFailedUrl('');
                            setLoadedUrl(currentUrl);
                        }}
                        onDragStart={(event) => event.preventDefault()}
                        onError={() => setFailedUrl(currentUrl)}
                    />
                </div>
                
                <footer data-testid="gallery-lightbox-footer" className="relative z-20 flex shrink-0 flex-col gap-2 border-t border-white/10 bg-black/80 px-3 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5 sm:py-4">
                    <div className="min-w-0">
                        <p title={displayLabel} className="truncate text-xs font-semibold sm:text-sm">{displayLabel}</p>
                        <p className="mt-0.5 text-[9px] uppercase tracking-[0.14em] text-white/50 sm:mt-1 sm:text-[10px]">{displayPosition} / {displayTotal}</p>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[220px]">
                        {comparison && <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium"><input type="checkbox" checked={comparisonEnabled} onChange={(event) => setComparisonEnabled(event.target.checked)} style={{ width: 16, height: 16, padding: 0, flexShrink: 0 }} className="accent-white" /> <span>Before / After</span></label>}
                        {mode === 'delivery' ? (
                            <a href={getDownloadUrl?.(photo)} target="_blank" rel="noreferrer" referrerPolicy="no-referrer" className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black">
                                <Download size={14} /> Download Original
                            </a>
                        ) : <button type="button" onClick={() => onToggle?.(photo)} className={clsx('flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-[10px] font-black uppercase tracking-[0.12em] transition-colors sm:h-10 sm:px-5 sm:tracking-[0.14em]', selected ? 'bg-white text-black' : 'border border-white/30 bg-black/30 text-white hover:border-white/60 hover:bg-white/10')}>
                            {selected ? <X size={14} /> : <Check size={14} />}
                            {selected ? 'Remove selection' : 'Select photo'}
                        </button>}
                    </div>
                </footer>
            </div>
        </div>
    );
}

export const Lightbox = memo(LightboxView) as typeof LightboxView;
