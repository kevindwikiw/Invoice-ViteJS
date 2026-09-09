import { useEffect, useRef, useState, memo } from 'react';
import { Check, CheckSquare, ImageOff, X } from 'lucide-react';
import clsx from 'clsx';

import { galleryThumbnailUrl } from '../culling.public';
import type { GalleryPhoto } from '../culling.types';

import { displayPhotoLabel } from './photo-labels';

export const PhotoTile = memo(function PhotoTile({
    photo,
    selected,
    token,
    galleryId,
    galleryTitle,
    displayIndex,
    thumbnailPriority,
    onOpen,
    onPrefetch,
    onToggle,
}: {
    photo: GalleryPhoto;
    selected: boolean;
    token: string;
    galleryId: string;
    galleryTitle?: string | null;
    displayIndex: number;
    thumbnailPriority?: boolean;
    onOpen: (driveFileId: string) => void;
    onPrefetch: (photo: GalleryPhoto) => void;
    onToggle: (photo: GalleryPhoto) => void;
}) {
    const [hasError, setHasError] = useState(false);
    const prefetchTimerRef = useRef<number | null>(null);
    const displayLabel = displayPhotoLabel(galleryTitle, displayIndex);

    const cancelScheduledPrefetch = () => {
        if (prefetchTimerRef.current == null) return;
        window.clearTimeout(prefetchTimerRef.current);
        prefetchTimerRef.current = null;
    };

    const schedulePrefetch = () => {
        cancelScheduledPrefetch();
        prefetchTimerRef.current = window.setTimeout(() => {
            prefetchTimerRef.current = null;
            if (!hasError) onPrefetch(photo);
        }, 120);
    };

    useEffect(() => () => {
        if (prefetchTimerRef.current != null) window.clearTimeout(prefetchTimerRef.current);
    }, []);

    return (
        <article className={clsx('group overflow-hidden bg-[var(--bg-card)] transition-transform duration-150 hover:-translate-y-0.5 [content-visibility:auto] [contain-intrinsic-size:180px_160px]', selected && 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-deep)]')}>
            <div className="relative aspect-[4/3] overflow-hidden">
                <button
                    type="button"
                    onClick={() => !hasError && onOpen(photo.driveFileId)}
                    onFocus={() => !hasError && onPrefetch(photo)}
                    onPointerEnter={(event) => { if (event.pointerType === 'mouse' && !hasError) schedulePrefetch(); }}
                    onPointerLeave={cancelScheduledPrefetch}
                    onPointerDown={(event) => {
                        cancelScheduledPrefetch();
                        if (event.pointerType !== 'touch' && !hasError) onPrefetch(photo);
                    }}
                    className="h-full w-full bg-[var(--bg-card)] text-left"
                    aria-label={`Open ${displayLabel}`}
                >
                    {!hasError ? (
                        <img
                            src={galleryThumbnailUrl(galleryId, photo.driveFileId, token, photo.photoToken)}
                            alt={displayLabel}
                            title={photo.filename}
                            loading={thumbnailPriority ? 'eager' : 'lazy'}
                            decoding="async"
                            fetchPriority={thumbnailPriority ? 'high' : 'auto'}
                            className="h-full w-full object-cover opacity-0 transition-[opacity,transform] duration-200 group-hover:scale-[1.015]"
                            onLoad={(event) => event.currentTarget.classList.remove('opacity-0')}
                            onError={() => setHasError(true)}
                        />
                    ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                            <ImageOff size={24} className="mb-2 opacity-50" />
                            <span className="text-[9px] font-bold uppercase tracking-[0.16em] opacity-60">
                                Failed to load
                            </span>
                        </div>
                    )}

                    <div className={clsx('pointer-events-none absolute inset-0 bg-[var(--accent-muted)] transition-opacity duration-200', selected ? 'opacity-100' : 'opacity-0')} />
                </button>
                {selected && (
                    <>
                        <div className="pointer-events-none absolute left-2 top-2 flex h-7 items-center gap-1 rounded-full border border-[var(--accent)] bg-[var(--accent)] px-2 text-[9px] font-black uppercase tracking-[0.1em] text-[var(--bg-deep)] shadow-lg shadow-black/35">
                            <CheckSquare size={11} strokeWidth={2.6} />
                            Picked
                        </div>
                        <div className="pointer-events-none absolute inset-0 border-[3px] border-[var(--accent)] shadow-[inset_0_0_0_1px_var(--bg-deep)]" />
                    </>
                )}
                <button
                    type="button"
                    onClick={() => onToggle(photo)}
                    aria-pressed={selected}
                    className={clsx('absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur transition-all duration-200', selected ? 'scale-105 border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]' : 'scale-100 border-white/35 bg-black/45 text-white/75 hover:border-white/70 hover:bg-black/60 hover:text-white')}
                    aria-label={selected ? `Remove ${displayLabel}` : `Select ${displayLabel}`}
                >
                    {selected ? <X size={14} strokeWidth={3} className="transition-transform duration-200" /> : <Check size={14} strokeWidth={3} className="transition-transform duration-200" />}
                </button>
            </div>
            <div className="flex h-7 items-center justify-between gap-2 border-t border-[var(--border)] px-2 text-[9px] text-[var(--text-secondary)] sm:h-8 sm:px-2.5 sm:text-[10px]">
                <p title={photo.filename} className="min-w-0 truncate font-semibold">{displayLabel}</p>
                <p className="shrink-0 font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">#{String(displayIndex + 1).padStart(3, '0')}</p>
            </div>
        </article>
    );
});

