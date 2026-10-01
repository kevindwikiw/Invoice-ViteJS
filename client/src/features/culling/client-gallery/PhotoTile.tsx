import { useEffect, useRef, useState, memo } from 'react';
import { Check, CheckSquare, Download, ImageOff, X } from 'lucide-react';
import clsx from 'clsx';

import { galleryThumbnailUrl } from '../culling.public';
import type { GalleryDisplayPhoto } from '../culling.types';

import { displayPhotoLabel } from './photo-labels';

function PhotoTileView<T extends GalleryDisplayPhoto>({
    photo,
    selected = false,
    mode = 'selection',
    thumbnailUrl,
    downloadUrl,
    token,
    galleryId,
    displayIndex,
    thumbnailPriority,
    thumbnailEager,
    onOpen,
    onPrefetch,
    onToggle,
}: {
    photo: T;
    selected?: boolean;
    mode?: 'selection' | 'delivery';
    thumbnailUrl?: string;
    downloadUrl?: string;
    token: string;
    galleryId: string;
    displayIndex: number;
    thumbnailPriority?: boolean;
    thumbnailEager?: boolean;
    onOpen: (driveFileId: string) => void;
    onPrefetch: (photo: T) => void;
    onToggle?: (photo: T) => void;
}) {
    const [hasError, setHasError] = useState(false);
    const prefetchTimerRef = useRef<number | null>(null);
    const displayLabel = displayPhotoLabel(photo, displayIndex);

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
        <article className={clsx('overflow-hidden bg-[var(--bg-card)]', selected && 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-deep)]')}>
            <div className="relative aspect-[4/3] overflow-hidden">
                <button
                    type="button"
                    onClick={() => !hasError && onOpen(photo.driveFileId)}
                    onContextMenu={(event) => event.preventDefault()}
                    onFocus={(event) => { if (event.currentTarget.matches(':focus-visible') && !hasError) onPrefetch(photo); }}
                    onPointerEnter={(event) => { if (event.pointerType === 'mouse' && !hasError) schedulePrefetch(); }}
                    onPointerLeave={cancelScheduledPrefetch}
                    onPointerCancel={cancelScheduledPrefetch}
                    onPointerDown={(event) => {
                        cancelScheduledPrefetch();
                        if (event.pointerType !== 'touch' && !hasError) onPrefetch(photo);
                    }}
                    className="h-full w-full select-none bg-[var(--bg-card)] text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)] [-webkit-touch-callout:none]"
                    aria-label={`Open ${displayLabel}`}
                >
                    {/* Skip offscreen media painting without estimating the tile's height. */}
                    <span className="absolute inset-0 block [content-visibility:auto]">
                        {!hasError ? (
                            <img
                                src={thumbnailUrl ?? galleryThumbnailUrl(galleryId, photo.driveFileId, token, photo.photoToken)}
                                alt={displayLabel}
                                title={displayLabel}
                                draggable={false}
                                width={photo.width || undefined}
                                height={photo.height || undefined}
                                loading={thumbnailEager || thumbnailPriority ? 'eager' : 'lazy'}
                                decoding="async"
                                fetchPriority={thumbnailPriority ? 'high' : 'auto'}
                                className={clsx('h-full w-full object-cover transition-opacity duration-150 motion-reduce:transition-none', !thumbnailPriority && 'opacity-0')}
                                onLoad={(event) => event.currentTarget.classList.remove('opacity-0')}
                                onDragStart={(event) => event.preventDefault()}
                                onError={() => setHasError(true)}
                            />
                        ) : (
                            <span className="flex h-full w-full flex-col items-center justify-center bg-[var(--bg-elevated)] text-[var(--text-muted)]">
                                <ImageOff size={24} className="mb-2 opacity-50" />
                                <span className="text-[9px] font-bold uppercase tracking-[0.16em] opacity-60">
                                    Failed to load
                                </span>
                            </span>
                        )}
                    </span>

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
                {mode === 'delivery' ? (
                    <a href={downloadUrl} target="_blank" rel="noreferrer" referrerPolicy="no-referrer" aria-label={`Download ${displayLabel}`} title="Download Original" className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-md text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
                        <span className="flex h-8 w-8 items-center justify-center rounded-md border border-white/30 bg-black/80 transition-colors [@media(hover:hover)]:hover:bg-black motion-reduce:transition-none"><Download size={15} /></span>
                    </a>
                ) : <button
                    type="button"
                    onClick={() => onToggle?.(photo)}
                    aria-pressed={selected}
                    className={clsx('absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border transition-colors duration-150 motion-reduce:transition-none', selected ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]' : 'border-white/35 bg-black/80 text-white/90 [@media(hover:hover)]:hover:border-white/70 [@media(hover:hover)]:hover:bg-black')}
                    aria-label={selected ? `Remove ${displayLabel}` : `Select ${displayLabel}`}
                >
                    {selected ? <X size={14} strokeWidth={3} className="transition-transform duration-200" /> : <Check size={14} strokeWidth={3} className="transition-transform duration-200" />}
                </button>}
            </div>
            <div className="flex h-7 items-center justify-between gap-2 border-t border-[var(--border)] px-2 text-[9px] text-[var(--text-secondary)] sm:h-8 sm:px-2.5 sm:text-[10px]">
                <p title={displayLabel} className="min-w-0 truncate font-semibold">{displayLabel}</p>
                <p className="shrink-0 font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">#{String(displayIndex + 1).padStart(3, '0')}</p>
            </div>
        </article>
    );
}

export const PhotoTile = memo(PhotoTileView) as typeof PhotoTileView;
