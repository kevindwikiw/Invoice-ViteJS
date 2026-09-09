import { useEffect, useLayoutEffect, useMemo, useState, useCallback } from 'react';
import { useParams } from '@tanstack/react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, CheckSquare, ChevronLeft, ChevronRight, HelpCircle, ImageIcon, Instagram, Loader2, Lock, Send } from 'lucide-react';
import clsx from 'clsx';

import {
    calculateAddonQuote,
    galleryPreviewUrl,
    getPublicGalleryPhotos,
    submitGallerySelections,
} from '../features/culling/culling.public';

import type {
    GalleryPhoto,
    PublicGallery,
} from '../features/culling/culling.types';

import {
    BLACK_THEME,
    DEFAULT_ADDON_DISCOUNT_RULES,
    GALLERY_PAGE_SIZE,
    WHITE_THEME,
    idrFormat,
} from '../features/culling/client-gallery/constants';
import {
    draftKey,
    galleryThemeKey,
    photoToSelectedMeta,
    pruneSelectedPhotoMeta,
    readGalleryTheme,
    readSelectedPhotoMetaDraft,
    readSelectionDraft,
    sameSelectedPhotoMeta,
    selectedMetaToPhoto,
    selectedPhotoMetaKey,
    tokenKey,
    tutorialKey,
} from '../features/culling/client-gallery/storage';
import { photoDisplayIndex } from '../features/culling/client-gallery/photo-labels';
import { canPrefetchPreview, preloadPreviewImage } from '../features/culling/client-gallery/preview-cache';
import { CountdownLabel } from '../features/culling/client-gallery/countdown';
import { useSelectionCountdown } from '../features/culling/client-gallery/useSelectionCountdown';
import { OrbitLogo, ThemeToggle } from '../features/culling/client-gallery/GalleryChrome';
import { PhotoTile } from '../features/culling/client-gallery/PhotoTile';
import { GalleryLockedScreen, PinGate } from '../features/culling/client-gallery/AccessScreens';
import { RequestMoreModal, SubmitConfirmationModal, TutorialModal } from '../features/culling/client-gallery/Modals';
import { Lightbox } from '../features/culling/client-gallery/Lightbox';
import type {
    GalleryContactSettings,
    GalleryTheme,
} from '../features/culling/client-gallery/types';

export default function ClientCullingGallery() {
    const { galleryId } = useParams({ from: '/culling/$galleryId' });
    const queryClient = useQueryClient();
    const [theme, setTheme] = useState<GalleryTheme>(() => readGalleryTheme(galleryId));
    const [token, setToken] = useState(() => localStorage.getItem(tokenKey(galleryId)) || '');
    const [unlockedGallery, setUnlockedGallery] = useState<PublicGallery | null>(null);
    const [selectionDraft, setSelectionDraft] = useState(() => ({
        selectedIds: new Set(readSelectionDraft(galleryId)),
        photoMetaById: readSelectedPhotoMetaDraft(galleryId),
    }));
    const [page, setPage] = useState(1);
    const [showSelected, setShowSelected] = useState(false);
    const [selectionTouched, setSelectionTouched] = useState(() => readSelectionDraft(galleryId).length > 0);
    const [lightboxPhotoId, setLightboxPhotoId] = useState<string | null>(null);
    const [submittedCount, setSubmittedCount] = useState<number | null>(null);
    const [showTutorial, setShowTutorial] = useState(() => Boolean(token) && !localStorage.getItem(tutorialKey(galleryId)));
    const [limitMessage, setLimitMessage] = useState('');
    const [requestSettings, setRequestSettings] = useState<GalleryContactSettings | null>(null);
    const [showRequestMore, setShowRequestMore] = useState(false);
    const [requestedCount, setRequestedCount] = useState(10);
    const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
    const [knownPhotosById, setKnownPhotosById] = useState<Record<string, GalleryPhoto>>({});
    const [pendingLightboxPageMove, setPendingLightboxPageMove] = useState<'first' | 'last' | null>(null);
    const selectedIds = selectionDraft.selectedIds;
    const selectedPhotoMetaById = selectionDraft.photoMetaById;
    const shouldIncludeSelections = !showSelected && !selectionTouched && selectedIds.size === 0 && page === 1;
    
    const photosQuery = useQuery({
        queryKey: ['public-gallery-photos', galleryId, token, page, GALLERY_PAGE_SIZE, showSelected],
        queryFn: () => getPublicGalleryPhotos(galleryId, token, page, GALLERY_PAGE_SIZE, showSelected, shouldIncludeSelections),
        enabled: !!token,
        retry: false,
        placeholderData: keepPreviousData,
        staleTime: 5 * 60 * 1000,
    });
    const photos = useMemo(() => photosQuery.data?.photos || [], [photosQuery.data?.photos]);
    const submittedPhotos = useMemo(() => photosQuery.data?.selectedPhotos || [], [photosQuery.data?.selectedPhotos]);
    const selectedDriveFileIds = useMemo(() => photosQuery.data?.selectedDriveFileIds || [], [photosQuery.data?.selectedDriveFileIds]);
    
    const effectiveSelectedIds = useMemo(() => {
        if (selectionTouched || selectedIds.size > 0) return selectedIds;
        if (showSelected && submittedPhotos.length > 0) return new Set(submittedPhotos.map((photo) => photo.driveFileId));
        return new Set(selectedDriveFileIds);
    }, [selectedDriveFileIds, selectedIds, selectionTouched, showSelected, submittedPhotos]);
    
    const selectionList = useMemo(() => Array.from(effectiveSelectedIds), [effectiveSelectedIds]);
    const selectedPhotoMetaMap = useMemo(() => new Map(Object.entries(selectedPhotoMetaById)), [selectedPhotoMetaById]);
    const pickedPhotos = useMemo(() => {
        const submittedById = new Map(submittedPhotos.map((photo) => [photo.driveFileId, photo]));
        const selectionOrder = new Map(selectionList.map((driveFileId, index) => [driveFileId, index]));
        return selectionList
            .map((driveFileId) => {
                const meta = selectedPhotoMetaMap.get(driveFileId);
                return knownPhotosById[driveFileId] ?? submittedById.get(driveFileId) ?? (meta ? selectedMetaToPhoto(meta) : {
                    id: 0,
                    galleryId: 0,
                    driveFileId,
                    filename: 'Selected photo',
                    mimeType: 'image/jpeg',
                    displayOrder: Number.MAX_SAFE_INTEGER,
                    createdAt: '',
                });
            })
            .sort((left, right) => {
                const leftOrder = Number.isFinite(Number(left.displayOrder)) ? Number(left.displayOrder) : Number.MAX_SAFE_INTEGER;
                const rightOrder = Number.isFinite(Number(right.displayOrder)) ? Number(right.displayOrder) : Number.MAX_SAFE_INTEGER;
                if (leftOrder !== rightOrder) return leftOrder - rightOrder;
                return (selectionOrder.get(left.driveFileId) ?? 0) - (selectionOrder.get(right.driveFileId) ?? 0);
            });
    }, [knownPhotosById, selectedPhotoMetaMap, selectionList, submittedPhotos]);
    const visiblePhotos = showSelected ? pickedPhotos : photos;
    const displayGallery = photosQuery.data?.gallery || unlockedGallery;
    const countdown = useSelectionCountdown(displayGallery?.selectionDeadlineAt, displayGallery?.serverTime);
    const galleryError = photosQuery.error as (Error & { code?: string; contactUrl?: string | null }) | null;
    const galleryLockCode = galleryError?.code === 'GALLERY_EXPIRED' || galleryError?.code === 'GALLERY_CLOSED' ? galleryError.code : null;
    const totalPages = photosQuery.data?.totalPages || 0;
    const totalPhotos = photosQuery.data?.total || visiblePhotos.length;
    const hasPreviousGalleryPage = !showSelected && totalPages > 0 && page > 1;
    const hasNextGalleryPage = !showSelected && totalPages > 0 && page < totalPages;

    const goToGalleryPage = useCallback((nextPage: number) => {
        const clampedPage = totalPages ? Math.min(totalPages, Math.max(1, nextPage)) : Math.max(1, nextPage);
        if (clampedPage === page) return;
        setPendingLightboxPageMove(null);
        setPage(clampedPage);
        setLightboxPhotoId(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [page, totalPages]);

    const moveLightboxAcrossPage = useCallback((direction: 'previous' | 'next') => {
        if (showSelected || pendingLightboxPageMove) return;

        if (direction === 'previous' && hasPreviousGalleryPage) {
            setPendingLightboxPageMove('last');
            setPage((current) => Math.max(1, current - 1));
            return;
        }

        if (direction === 'next' && hasNextGalleryPage) {
            setPendingLightboxPageMove('first');
            setPage((current) => totalPages ? Math.min(totalPages, current + 1) : current + 1);
        }
    }, [hasNextGalleryPage, hasPreviousGalleryPage, pendingLightboxPageMove, showSelected, totalPages]);

    useLayoutEffect(() => {
        if (!pendingLightboxPageMove || showSelected || photosQuery.data?.page !== page || !photos.length) return;

        const targetPhoto = pendingLightboxPageMove === 'first' ? photos[0] : photos[photos.length - 1];
        if (!targetPhoto) return;

        /* eslint-disable react-hooks/set-state-in-effect -- Continue lightbox navigation before the boundary page transition paints. */
        setLightboxPhotoId(targetPhoto.driveFileId);
        setPendingLightboxPageMove(null);
        /* eslint-enable react-hooks/set-state-in-effect */
    }, [page, pendingLightboxPageMove, photos, photosQuery.data?.page, showSelected]);

    useEffect(() => {
        const errorStatus = (photosQuery.error as (Error & { status?: number }) | null)?.status;
        if (!token || errorStatus !== 401) return;

        localStorage.removeItem(tokenKey(galleryId));
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Drop an invalidated public session and return to the PIN gate.
        setToken('');
    }, [galleryId, photosQuery.error, token]);

    const masterLimit = Number(displayGallery?.maxSelections || 0);
    const additionalLimit = Number(displayGallery?.additionalLimit || 0);
    const isAddonActive = Boolean(displayGallery?.addon?.enabled && additionalLimit > 0);
    const selectionLimit = masterLimit ? masterLimit + (isAddonActive ? additionalLimit : 0) : 0;
    const selectedCount = effectiveSelectedIds.size;
    const remainingSelections = selectionLimit ? Math.max(0, selectionLimit - selectedCount) : null;
    const shouldShowRequestMore = remainingSelections !== null && remainingSelections <= 1;
    const overLimitCount = selectionLimit ? Math.max(0, selectedCount - selectionLimit) : 0;
    const isOverLimit = overLimitCount > 0;
    const addonUnitPrice = Math.max(0, Number(displayGallery?.addon?.unitPrice ?? 10_000));
    const discountRules = displayGallery?.addon?.discountRules?.length ? displayGallery.addon.discountRules : DEFAULT_ADDON_DISCOUNT_RULES;
    const addonQuote = useMemo(() => {
        return calculateAddonQuote(requestedCount, addonUnitPrice, discountRules);
    }, [addonUnitPrice, requestedCount, discountRules]);
    const requestMoreUrl = useMemo(() => {
        if (!requestSettings?.contactWhatsappUrl) return null;
        let template = requestSettings.requestMoreMessage || 'Halo Kak Admin Orbit\nSaya ingin meminta tambahan edited photos.\n\nIni URL saya: {{gallery_url}}\nSaya client dari: {{gallery_title}}\nPilihan saat ini: {{selected_count}} foto\nSaya ingin menambah: {{requested_count}} foto\nPromo: {{promo_label}}\nEstimasi biaya: {{estimated_price}}';
        if (!template.includes('{{promo_label}}')) template += '\nPromo: {{promo_label}}';
        if (!template.includes('{{estimated_price}}')) template += '\nEstimasi biaya: {{estimated_price}}';
        const text = template
            .replaceAll('{{gallery_url}}', window.location.href)
            .replaceAll('{{gallery_title}}', displayGallery?.title || galleryId)
            .replaceAll('{{selected_count}}', String(selectedCount))
            .replaceAll('{{requested_count}}', String(requestedCount))
            .replaceAll('{{promo_label}}', addonQuote.discountPercent ? `Hemat ${addonQuote.discountPercent}%` : 'Harga normal')
            .replaceAll('{{normal_price}}', idrFormat.format(addonQuote.normalTotal))
            .replaceAll('{{estimated_price}}', idrFormat.format(addonQuote.total));
        let phone = requestSettings.contactWhatsappUrl.replace(/\D/g, '');
        if (phone.startsWith('0')) phone = '62' + phone.slice(1);
        return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    }, [addonQuote, displayGallery?.title, galleryId, requestSettings, requestedCount, selectedCount]);
    const fallbackContactUrl = useMemo(() => {
        if (!requestSettings?.contactWhatsappUrl) return null;
        const text = (requestSettings.message || 'Halo Kak Admin Orbit\nSaya ingin meminta bantuan untuk membuka client gallery saya yaa.')
            .replaceAll('{{gallery_url}}', window.location.href)
            .replaceAll('{{gallery_title}}', displayGallery?.title || galleryId);
        let phone = requestSettings.contactWhatsappUrl.replace(/\D/g, '');
        if (phone.startsWith('0')) phone = `62${phone.slice(1)}`;
        return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    }, [displayGallery?.title, galleryId, requestSettings]);
    const hasUnsavedChanges = useMemo(() => {
        if (!selectionTouched) return false;
        const submittedSet = new Set(selectedDriveFileIds.length ? selectedDriveFileIds : submittedPhotos.map((photo) => photo.driveFileId));
        if (selectedCount !== submittedSet.size) return true;
        for (const id of effectiveSelectedIds) {
            if (!submittedSet.has(id)) return true;
        }
        return false;
    }, [effectiveSelectedIds, selectedCount, selectedDriveFileIds, selectionTouched, submittedPhotos]);

    useEffect(() => {
        if (!token) return;
        fetch(`/api/public/galleries/${galleryId}/contact`)
            .then((response) => response.ok ? response.json() : null)
            .then((settings: GalleryContactSettings | null) => setRequestSettings(settings))
            .catch(() => setRequestSettings(null));
    }, [galleryId, token]);

    useEffect(() => {
        localStorage.removeItem(`orbit_culling_notes_${galleryId}`);
    }, [galleryId]);

    useEffect(() => {
        const incomingPhotos = [...photos, ...submittedPhotos];
        if (!incomingPhotos.length) return;

        // eslint-disable-next-line react-hooks/set-state-in-effect -- Keep a local photo cache so picked selections survive pagination and reloads.
        setKnownPhotosById((current) => {
            let changed = false;
            const next = { ...current };
            for (const photo of incomingPhotos) {
                if (next[photo.driveFileId] === photo) continue;
                next[photo.driveFileId] = photo;
                changed = true;
            }
            return changed ? next : current;
        });

        setSelectionDraft((current) => {
            let changed = false;
            let nextMetaById = current.photoMetaById;

            for (const photo of incomingPhotos) {
                if (!current.selectedIds.has(photo.driveFileId)) continue;
                const existing = nextMetaById[photo.driveFileId];
                const nextMeta = photoToSelectedMeta(photo, existing?.selectedAt);
                if (sameSelectedPhotoMeta(existing, nextMeta)) continue;

                if (!changed) nextMetaById = { ...current.photoMetaById };
                nextMetaById[photo.driveFileId] = nextMeta;
                changed = true;
            }

            return changed ? { ...current, photoMetaById: nextMetaById } : current;
        });
    }, [photos, submittedPhotos]);

    useEffect(() => {
        const selectedFromServer = selectedDriveFileIds.length
            ? selectedDriveFileIds
            : showSelected
                ? submittedPhotos.map((photo) => photo.driveFileId)
                : [];
        if (selectionTouched || selectedIds.size > 0 || !selectedFromServer?.length) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- Seed the editable selection draft from page-one server data.
        setSelectionDraft((current) => ({ ...current, selectedIds: new Set(selectedFromServer) }));
    }, [selectedDriveFileIds, selectedIds.size, selectionTouched, showSelected, submittedPhotos]);

    const submitMutation = useMutation({
        mutationFn: () => {
            const mappedSelections = selectionList.map((driveFileId) => ({ driveFileId, note: '' }));
            return submitGallerySelections(galleryId, token, mappedSelections);
        },
        onSuccess: (data) => {
            setSubmittedCount(data.selectionCount);
            setSelectionTouched(false);
            setShowSubmitConfirm(false);
            localStorage.setItem(draftKey(galleryId), JSON.stringify(selectionList));
            void queryClient.invalidateQueries({ queryKey: ['public-gallery-photos', galleryId, token] });
        },
    });

    useEffect(() => {
        localStorage.setItem(draftKey(galleryId), JSON.stringify(selectionList));
        localStorage.setItem(selectedPhotoMetaKey(galleryId), JSON.stringify(pruneSelectedPhotoMeta(selectedPhotoMetaById, selectionList)));
    }, [galleryId, selectedPhotoMetaById, selectionList]);

    useEffect(() => {
        const totalPages = photosQuery.data?.totalPages || 0;
        if (showSelected || !token || !photosQuery.data || page >= totalPages) return;

        const idle = window.setTimeout(() => {
            void queryClient.prefetchQuery({
                queryKey: ['public-gallery-photos', galleryId, token, page + 1, GALLERY_PAGE_SIZE, false],
                queryFn: () => getPublicGalleryPhotos(galleryId, token, page + 1, GALLERY_PAGE_SIZE, false, false),
                staleTime: 5 * 60 * 1000,
            });
        }, 800);

        return () => window.clearTimeout(idle);
    }, [galleryId, page, photosQuery.data, queryClient, showSelected, token]);

    const handleToggleSelection = useCallback((photo: GalleryPhoto) => {
        const driveFileId = photo.driveFileId;
        setSubmittedCount(null);
        setSelectionTouched(true);

        setSelectionDraft((current) => {
            const nextSelectedIds = new Set(current.selectedIds);
            let nextPhotoMetaById = current.photoMetaById;

            if (nextSelectedIds.has(driveFileId)) {
                nextSelectedIds.delete(driveFileId);
                if (nextPhotoMetaById[driveFileId]) {
                    nextPhotoMetaById = { ...current.photoMetaById };
                    delete nextPhotoMetaById[driveFileId];
                }
                if (!selectionLimit || nextSelectedIds.size <= selectionLimit) setLimitMessage('');
            } else if (!selectionLimit || nextSelectedIds.size < selectionLimit) {
                nextSelectedIds.add(driveFileId);
                nextPhotoMetaById = {
                    ...current.photoMetaById,
                    [driveFileId]: photoToSelectedMeta(photo, current.photoMetaById[driveFileId]?.selectedAt),
                };
                if (!selectionLimit || nextSelectedIds.size <= selectionLimit) setLimitMessage('');
            } else {
                setLimitMessage(`You have selected ${nextSelectedIds.size} / ${selectionLimit} photos. Remove a photo or request more edited photos.`);
                setShowRequestMore(true);
            }

            return { selectedIds: nextSelectedIds, photoMetaById: nextPhotoMetaById };
        });
    }, [selectionLimit]);

    const handleOpenLightbox = useCallback((driveFileId: string) => {
        setLightboxPhotoId(driveFileId);
    }, []);

    const handlePrefetchLightbox = useCallback((photo: GalleryPhoto) => {
        if (!canPrefetchPreview()) return;
        const previewUrl = galleryPreviewUrl(galleryId, photo.driveFileId, token, photo.photoToken);
        void preloadPreviewImage(previewUrl).catch(() => undefined);
    }, [galleryId, token]);

    const handleSubmitSelections = () => {
        if (isOverLimit) {
            setLimitMessage(`You selected ${selectedCount} photos, but this gallery allows ${selectionLimit}. Remove ${overLimitCount} photo${overLimitCount === 1 ? '' : 's'} before submitting.`);
            return;
        }
        setLimitMessage('');
        submitMutation.reset();
        setShowSubmitConfirm(true);
    };

    const closeTutorial = useCallback(() => {
        localStorage.setItem(tutorialKey(galleryId), '1');
        setShowTutorial(false);
    }, [galleryId]);

    const toggleTheme = () => {
        setTheme((current) => {
            const next = current === 'black' ? 'white' : 'black';
            localStorage.setItem(galleryThemeKey(galleryId), next);
            return next;
        });
    };

    if (!token) {
        return <PinGate galleryId={galleryId} theme={theme} onToggleTheme={toggleTheme} onUnlocked={(nextToken, nextGallery) => { setToken(nextToken); setUnlockedGallery(nextGallery); if (!localStorage.getItem(tutorialKey(galleryId))) setShowTutorial(true); }} />;
    }

    if (countdown.isExpired || displayGallery?.isExpired || galleryLockCode) {
        return <GalleryLockedScreen expired={countdown.isExpired || Boolean(displayGallery?.isExpired) || galleryLockCode === 'GALLERY_EXPIRED'} contactUrl={galleryError?.contactUrl || fallbackContactUrl} theme={theme} onToggleTheme={toggleTheme} />;
    }

    return (
        <main style={theme === 'black' ? BLACK_THEME : WHITE_THEME} className="min-h-screen bg-[var(--bg-deep)] font-sans text-[var(--text-primary)]">
            
            <header data-testid="gallery-header" className="sticky top-0 z-40 h-11 border-b border-[var(--border)] bg-[var(--bg-deep)]/90 px-2.5 backdrop-blur sm:h-14 sm:px-8">
                <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-1.5 sm:gap-2">
                    
                    <OrbitLogo theme={theme} />

                    <div className="flex items-center gap-1.5 sm:gap-2">
                        {requestMoreUrl && shouldShowRequestMore && (
                            <button
                                type="button"
                                onClick={() => setShowRequestMore(true)}
                                className="flex h-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-1.5 text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] sm:h-8 sm:px-2.5 sm:text-[10px] sm:tracking-[0.12em]"
                            >
                                <span className="hidden sm:inline">Request More</span>
                                <span className="sm:hidden">Request</span>
                            </button>
                        )}
                        <CountdownLabel countdown={countdown} />
                        <button
                            type="button"
                            onClick={() => setShowTutorial(true)}
                            title="How to submit"
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)] sm:h-8 sm:w-auto sm:gap-1 sm:px-2.5 sm:text-[10px] sm:font-bold sm:uppercase sm:tracking-[0.12em]"
                        >
                            <HelpCircle size={13} />
                            <span className="hidden sm:inline">How to submit</span>
                        </button>
                        <ThemeToggle theme={theme} onToggle={toggleTheme} />
                    </div>
                </div>
            </header>

            <div data-testid="gallery-toolbar" className="sticky top-11 z-30 border-b border-[var(--border)] bg-[var(--bg-deep)]/95 px-2.5 py-1.5 backdrop-blur sm:top-[56px] sm:px-8 sm:py-2">
                <div className="no-scrollbar mx-auto flex max-w-[1600px] items-center justify-between gap-1.5 overflow-x-auto sm:gap-2">
                    
                    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                        
                        <button
                            type="button"
                            onClick={() => {
                                setShowSelected((current) => !current);
                                setLightboxPhotoId(null);
                            }}
                            className={clsx(
                                'relative inline-grid h-7 grid-cols-1 grid-rows-1 items-center justify-center whitespace-nowrap rounded-md border px-2 text-[9px] font-bold uppercase tracking-[0.1em] transition-colors sm:h-8 sm:px-2.5 sm:text-[10px] sm:tracking-[0.12em]',
                                showSelected
                                    ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]'
                                    : 'border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:border-[var(--accent)]'
                            )}
                        >
                            <span aria-hidden="true" className="pointer-events-none col-start-1 row-start-1 flex select-none items-center justify-center gap-1.5 opacity-0">
                                <CheckSquare size={12} />
                                Picked ({selectedCount})
                            </span>

                            <span className="col-start-1 row-start-1 flex items-center justify-center gap-1.5">
                                {showSelected ? (
                                    <>
                                        <CheckSquare size={12} />
                                        Picked ({selectedCount})
                                    </>
                                ) : (
                                    <>
                                        <ImageIcon size={12} />
                                        All Photos
                                    </>
                                )}
                            </span>
                        </button>

                        <span
                            className={clsx(
                                'flex h-7 shrink-0 items-center whitespace-nowrap rounded-md border bg-[var(--bg-card)] px-2 text-[9px] font-bold uppercase tracking-[0.1em] sm:h-8 sm:px-2.5 sm:text-[10px] sm:tracking-[0.12em]',
                                isOverLimit ? 'border-rose-500/45 text-rose-400' : 'border-[var(--border)] text-[var(--text-secondary)]'
                            )}
                        >
                            Picked {selectedCount}{selectionLimit ? ` / ${selectionLimit}` : ''}
                            
                            {selectionLimit ? (
                                <span className={clsx('ml-1 border-l border-[var(--border)] pl-1 font-normal sm:ml-1.5 sm:pl-1.5', isOverLimit ? 'text-rose-400' : 'text-[var(--text-muted)]')}>
                                    {isOverLimit ? `${overLimitCount} Over` : `${remainingSelections} Left`}
                                </span>
                            ) : (
                                <span className="ml-1 border-l border-[var(--border)] pl-1 font-normal text-[var(--text-muted)] sm:ml-1.5 sm:pl-1.5">
                                    Unlimited
                                </span>
                            )}
                        </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                        {hasUnsavedChanges && (
                            <span title="Your latest selection changes have not been submitted yet." className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-1.5 text-[8px] font-semibold text-[var(--text-secondary)] sm:h-8 sm:px-2 sm:text-[9px]">
                                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" /> Not submitted
                            </span>
                        )}
                        
                        <button 
                            type="button" 
                            disabled={submitMutation.isPending || photosQuery.isLoading} 
                            onClick={handleSubmitSelections} 
                            className={clsx(
                                "flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded-md px-2.5 text-[9px] font-bold uppercase tracking-[0.1em] transition-all disabled:opacity-45 sm:h-8 sm:px-3 sm:text-[10px] sm:tracking-[0.12em]",
                                isOverLimit ? 'border border-rose-500/45 bg-rose-500/10 text-rose-400 hover:bg-rose-500/15' : 'bg-[var(--accent)] text-[var(--bg-deep)] hover:opacity-90',
                                hasUnsavedChanges && "ring-1 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--bg-deep)]"
                            )}
                        >
                            {submitMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                            Submit
                        </button>
                    </div>
                </div>
            </div>

            <section className="mx-auto max-w-[1600px] px-2.5 pt-3 pb-10 sm:px-4 sm:pt-5 sm:pb-12 md:px-8 md:pt-6">
                {limitMessage && (
                    <div className="mb-4 text-xs text-[var(--text-muted)] border border-[var(--border)] p-3 rounded-lg bg-[var(--bg-card)]">
                        {limitMessage} {requestMoreUrl && <button type="button" onClick={() => setShowRequestMore(true)} className="ml-1 font-semibold underline text-[var(--text-primary)]">Request more</button>}
                    </div>
                )}
                {submittedCount !== null && (
                    <div className="mb-5 flex items-center gap-3 border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-primary)]">
                        <Check size={16} />
                        Selection saved. {submittedCount} filenames submitted.
                    </div>
                )}
                {submitMutation.isError && (
                    <div className="mb-5 flex items-center gap-3 border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-primary)]">
                        <AlertCircle size={16} />
                        {submitMutation.error instanceof Error ? submitMutation.error.message : 'Unable to submit selections.'}
                    </div>
                )}

                {photosQuery.isLoading ? (
                    <div className="flex min-h-[60vh] items-center justify-center text-[var(--text-muted)]">
                        <Loader2 size={24} className="animate-spin text-[var(--accent)]" />
                    </div>
                ) : photosQuery.isError && !visiblePhotos.length ? (
                    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
                        <AlertCircle size={30} className="mb-4 text-[var(--text-muted)]" />
                        <p className="font-display text-2xl text-[var(--text-primary)]">Gallery Session Expired</p>
                        <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--text-muted)]">The gallery was reopened or your session expired. Enter the PIN again to continue.</p>
                        <button type="button" onClick={() => { localStorage.removeItem(tokenKey(galleryId)); setToken(''); }} className="mt-6 flex h-10 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-5 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--bg-deep)] transition-opacity hover:opacity-85"><Lock size={14} /> Enter PIN again</button>
                    </div>
                ) : !visiblePhotos.length ? (
                    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
                        {showSelected ? <CheckSquare size={30} className="mb-4 text-[var(--text-muted)]" /> : <ImageIcon size={30} className="mb-4 text-[var(--text-muted)]" />}
                        <p className="font-display text-2xl text-[var(--text-primary)]">{showSelected ? 'No picked photos' : 'No photos synced yet'}</p>
                        <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--text-muted)]">{showSelected ? 'Select photos from the gallery to see them here before submitting.' : 'The studio needs to sync this Drive folder before selection opens.'}</p>
                    </div>
                ) : (
                    <div data-testid="gallery-grid" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2 md:grid-cols-4 md:gap-3 xl:grid-cols-5 2xl:grid-cols-6">
                        {visiblePhotos.map((photo, index) => {
                            const fallbackIndex = showSelected ? index : (page - 1) * GALLERY_PAGE_SIZE + index;
                            return (
                                <PhotoTile
                                    key={photo.driveFileId}
                                    photo={photo}
                                    selected={effectiveSelectedIds.has(photo.driveFileId)}
                                    token={token}
                                    galleryId={galleryId}
                                    galleryTitle={displayGallery?.title}
                                    displayIndex={photoDisplayIndex(photo, fallbackIndex)}
                                    thumbnailPriority={index < 10}
                                    onOpen={handleOpenLightbox}
                                    onPrefetch={handlePrefetchLightbox}
                                    onToggle={handleToggleSelection}
                                />
                            );
                        })}
                    </div>
                )}
                
                {!showSelected && !photosQuery.isLoading && !photosQuery.isError && photosQuery.data && totalPages > 1 && (
                    <nav className="mt-8 flex items-center justify-center gap-4" aria-label="Gallery pages">
                        <button type="button" disabled={page === 1} onClick={() => goToGalleryPage(page - 1)} className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] px-4 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] disabled:opacity-35"><ChevronLeft size={14} /> Previous</button>
                        <span className="text-xs text-[var(--text-muted)]">Page {page} of {totalPages}</span>
                        <button type="button" disabled={!hasNextGalleryPage} onClick={() => goToGalleryPage(page + 1)} className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] px-4 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] disabled:opacity-35">Next <ChevronRight size={14} /></button>
                    </nav>
                )}
            </section>

            <footer className="border-t border-[var(--border)] px-4 py-5 text-[10px] text-[var(--text-muted)] md:px-8">
                <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-between gap-3 sm:flex-row">
                    <p>&copy; {new Date().getFullYear()} The Orbit Photo. All rights reserved.</p>
                    <a href="https://www.instagram.com/theorbitphoto/" target="_blank" rel="noreferrer" aria-label="The Orbit Photo on Instagram" className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                        <Instagram size={13} /> @theorbitphoto
                    </a>
                </div>
            </footer>

            <Lightbox
                galleryId={galleryId}
                galleryTitle={displayGallery?.title}
                token={token}
                photos={visiblePhotos}
                displayStartIndex={showSelected ? 0 : (page - 1) * GALLERY_PAGE_SIZE}
                currentPhotoId={lightboxPhotoId}
                selectedIds={effectiveSelectedIds}
                hasPreviousPage={hasPreviousGalleryPage}
                hasNextPage={hasNextGalleryPage}
                totalCount={showSelected ? visiblePhotos.length : totalPhotos}
                onClose={() => setLightboxPhotoId(null)}
                onMove={setLightboxPhotoId}
                onPreviousPage={() => moveLightboxAcrossPage('previous')}
                onNextPage={() => moveLightboxAcrossPage('next')}
                onToggle={handleToggleSelection}
            />

            {showRequestMore && requestMoreUrl && (
                <RequestMoreModal
                    requestedCount={requestedCount}
                    selectedCount={selectedCount}
                    unitPrice={addonUnitPrice}
                    discountRules={discountRules}
                    requestUrl={requestMoreUrl}
                    onChange={setRequestedCount}
                    onClose={() => setShowRequestMore(false)}
                />
            )}

            {showSubmitConfirm && (
                <SubmitConfirmationModal
                    selectedCount={selectedCount}
                    pending={submitMutation.isPending}
                    error={submitMutation.isError ? (submitMutation.error instanceof Error ? submitMutation.error.message : 'Unable to submit selections.') : undefined}
                    onConfirm={() => submitMutation.mutate()}
                    onClose={() => { submitMutation.reset(); setShowSubmitConfirm(false); }}
                />
            )}
            
            {showTutorial && <TutorialModal galleryId={galleryId} token={token} tutorialSampleSlots={displayGallery?.tutorialSampleSlots || []} onClose={closeTutorial} />}
        </main>
    );
}
