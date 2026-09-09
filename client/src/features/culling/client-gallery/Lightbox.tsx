import { useCallback, useEffect, useRef, useState, memo } from 'react';
import { Check, ChevronLeft, ChevronRight, ImageOff, X } from 'lucide-react';
import clsx from 'clsx';

import { galleryPreviewUrl, galleryThumbnailUrl } from '../culling.public';
import type { GalleryPhoto } from '../culling.types';

import { displayPhotoLabel, photoDisplayIndex } from './photo-labels';
import { isPreviewImageReady, preloadPreviewImage } from './preview-cache';

export const Lightbox = memo(function Lightbox({
    galleryId,
    galleryTitle,
    token,
    photos,
    displayStartIndex,
    currentPhotoId,
    selectedIds,
    onClose,
    onMove,
    onToggle,
}: {
    galleryId: string;
    galleryTitle?: string | null;
    token: string;
    photos: GalleryPhoto[];
    displayStartIndex: number;
    currentPhotoId: string | null;
    selectedIds: Set<string>;
    onClose: () => void;
    onMove: (driveFileId: string) => void;
    onToggle: (photo: GalleryPhoto) => void;
}) {
    const currentIndex = currentPhotoId ? photos.findIndex((item) => item.driveFileId === currentPhotoId) : -1;
    const photo = currentIndex >= 0 ? photos[currentIndex] : null;
    const selected = photo ? selectedIds.has(photo.driveFileId) : false;
    const currentUrl = photo ? galleryPreviewUrl(galleryId, photo.driveFileId, token, photo.photoToken) : '';
    const placeholderUrl = photo ? galleryThumbnailUrl(galleryId, photo.driveFileId, token, photo.photoToken) : '';
    const displayLabel = photo ? displayPhotoLabel(galleryTitle, photoDisplayIndex(photo, displayStartIndex + currentIndex)) : '';
    const [loadedUrl, setLoadedUrl] = useState('');
    const [failedUrl, setFailedUrl] = useState('');
    const moveRequestRef = useRef(0);
    const swipeStartXRef = useRef<number | null>(null);
    const currentImageReady = Boolean(currentUrl) && (loadedUrl === currentUrl || isPreviewImageReady(currentUrl));

    const closeLightbox = useCallback(() => {
        moveRequestRef.current += 1;
        onClose();
    }, [onClose]);

    const requestMove = useCallback((nextIndex: number) => {
        if (currentIndex < 0 || nextIndex < 0 || nextIndex >= photos.length || nextIndex === currentIndex) return;

        const nextPhoto = photos[nextIndex];
        if (!nextPhoto) return;
        const nextUrl = galleryPreviewUrl(galleryId, nextPhoto.driveFileId, token, nextPhoto.photoToken);
        moveRequestRef.current += 1;
        onMove(nextPhoto.driveFileId);
        void preloadPreviewImage(nextUrl, 'high').catch(() => undefined);
    }, [currentIndex, galleryId, onMove, photos, token]);

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
        if (currentIndex < 0) return;

        const neighborOffsets = [1, 2, 3, 4, 5, -1, -2];
        const timers: number[] = [];

        neighborOffsets.forEach((offset, index) => {
            const neighborIndex = currentIndex + offset;
            const neighbor = photos[neighborIndex];
            if (!neighbor) return;
            const neighborUrl = galleryPreviewUrl(galleryId, neighbor.driveFileId, token, neighbor.photoToken);
            if (isPreviewImageReady(neighborUrl)) return;

            const timer = window.setTimeout(() => {
                void preloadPreviewImage(neighborUrl, 'low').catch(() => undefined);
            }, index * 60);
            timers.push(timer);
        });

        return () => timers.forEach((timer) => window.clearTimeout(timer));
    }, [currentIndex, galleryId, photos, token]);

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
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return;

            if (event.key === 'ArrowLeft') requestMove(currentIndex - 1);
            if (event.key === 'ArrowRight') requestMove(currentIndex + 1);
            if (event.key === ' ') {
                event.preventDefault();
                onToggle(photo);
            }
        };
        
        document.addEventListener('keydown', handleKey);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKey);
        };
    }, [closeLightbox, currentIndex, onToggle, photo, requestMove]);

    if (!photo || currentIndex < 0) return null;

    return (
        <div className="fixed inset-0 z-[120] bg-black/95 text-white">
            <button type="button" aria-label="Close photo preview" onClick={closeLightbox} className="absolute right-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur transition-colors hover:border-[var(--accent)] sm:right-4 sm:top-4 sm:h-10 sm:w-10">
                <X size={16} />
            </button>

            <div className="grid h-dvh grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
                <div
                    data-testid="gallery-lightbox-stage"
                    className="relative flex min-h-0 touch-pan-y items-center justify-center px-10 py-2 sm:px-16 sm:py-5"
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
                            className={clsx(
                                'pointer-events-none absolute z-0 block h-auto max-h-full w-auto max-w-full scale-[1.02] object-contain blur-[10px] transition-opacity duration-300',
                                currentImageReady && failedUrl !== currentUrl ? 'opacity-0' : 'opacity-80'
                            )}
                        />
                    )}
                    <button type="button" disabled={currentIndex === 0} aria-label="Previous photo" onClick={() => requestMove(currentIndex - 1)} className="absolute left-1.5 top-1/2 z-30 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur transition-opacity disabled:opacity-25 sm:left-4 sm:h-10 sm:w-10">
                        <ChevronLeft size={18} />
                    </button>
                    <button type="button" disabled={currentIndex === photos.length - 1} aria-label="Next photo" onClick={() => requestMove(currentIndex + 1)} className="absolute right-1.5 top-1/2 z-30 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur transition-opacity disabled:opacity-25 sm:right-4 sm:h-10 sm:w-10">
                        <ChevronRight size={18} />
                    </button>
                    {failedUrl === currentUrl && (
                        <div className="absolute flex flex-col items-center text-white/60">
                            <ImageOff size={26} />
                            <span className="mt-2 text-[10px] font-bold uppercase tracking-[0.14em]">Failed to load preview</span>
                        </div>
                    )}
                    <img 
                        data-testid="gallery-lightbox-image"
                        key={currentUrl}
                        src={currentUrl}
                        alt={photo.filename}
                        decoding="async"
                        fetchPriority="high"
                        className={clsx('z-10 block h-auto max-h-full w-auto max-w-full object-contain transition-opacity duration-150', currentImageReady && failedUrl !== currentUrl ? 'opacity-100' : 'opacity-0')}
                        onLoad={() => {
                            setFailedUrl('');
                            setLoadedUrl(currentUrl);
                        }}
                        onError={() => setFailedUrl(currentUrl)}
                    />
                </div>
                
                <footer data-testid="gallery-lightbox-footer" className="relative z-20 flex shrink-0 flex-col gap-2 border-t border-white/10 bg-black/80 px-3 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5 sm:py-4">
                    <div className="min-w-0">
                        <p title={photo.filename} className="truncate text-xs font-semibold sm:text-sm">{displayLabel}</p>
                        <p className="mt-0.5 text-[9px] uppercase tracking-[0.14em] text-white/50 sm:mt-1 sm:text-[10px]">{currentIndex + 1} / {photos.length}</p>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[220px]">
                        <button type="button" onClick={() => onToggle(photo)} className={clsx('flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-[10px] font-black uppercase tracking-[0.12em] transition-colors sm:h-10 sm:px-5 sm:tracking-[0.14em]', selected ? 'bg-white text-black' : 'border border-white/30 bg-black/30 text-white hover:border-white/60 hover:bg-white/10')}>
                            {selected ? <X size={14} /> : <Check size={14} />}
                            {selected ? 'Remove selection' : 'Select photo'}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
});

