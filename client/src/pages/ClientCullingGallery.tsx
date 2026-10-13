import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, CheckSquare, ChevronLeft, ChevronRight, HelpCircle, ImageIcon, ImagePlus, Images, Instagram, Loader2, Lock, Plus, ScanFace, Send, X } from 'lucide-react';
import clsx from 'clsx';

import {
    calculateAddonQuote,
    getEditResultsStatus,
    galleryPreviewUrl,
    getPublicGalleryPhotos,
    galleryThumbnailUrl,
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
import { useGalleryStartup } from '../features/culling/client-gallery/useGalleryStartup';
import { GalleryHeaderIdentity, GalleryViewTabs, OrbitLogo, ThemeToggle, type GalleryView } from '../features/culling/client-gallery/GalleryChrome';
import { PhotoTile } from '../features/culling/client-gallery/PhotoTile';
import { GalleryLockedScreen, PinGate } from '../features/culling/client-gallery/AccessScreens';
import { RequestMoreModal, SubmitConfirmationModal, TutorialModal } from '../features/culling/client-gallery/Modals';
import { Lightbox } from '../features/culling/client-gallery/Lightbox';
import { FaceSearchModal } from '../features/culling/client-gallery/FaceSearchModal';
import { EditResultsGrid } from '../features/culling/client-gallery/EditResultsGrid';
import { SubmissionAction, submissionStatusLabel, type SubmissionStatus } from '../features/culling/client-gallery/SubmissionAction';
import { getFaceSearchStatus } from '../features/culling/client-gallery/face-search';
import type {
    GalleryContactSettings,
    GalleryTheme,
} from '../features/culling/client-gallery/types';

type GalleryRefineMode = 'none' | 'submitted';

export default function ClientCullingGallery() {
    const { galleryId } = useParams({ from: '/culling/$galleryId' });
    const metadata = useQuery({
        queryKey: ['public-edit-results-status', galleryId],
        queryFn: () => getEditResultsStatus(galleryId),
        staleTime: 60_000,
        retry: false,
    });
    if (!metadata.data) return <main style={readGalleryTheme(galleryId) === 'black' ? BLACK_THEME : WHITE_THEME} className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[var(--bg-deep)] px-5 text-center text-[var(--text-primary)]">
        {metadata.isPending ? <p role="status" className="inline-flex items-center gap-2 text-sm"><Loader2 size={18} aria-hidden="true" className="animate-spin" /> Loading gallery...</p> : <>
            <p role="alert" className="text-sm">{metadata.error?.message || 'Unable to load gallery details.'}</p>
            <button type="button" onClick={() => void metadata.refetch()} className="min-h-11 rounded-md border border-[var(--border)] px-4 text-sm hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">Retry</button>
        </>}
    </main>;
    return metadata.data.workflow === 'delivery_only' ? <WeddingGallery key={galleryId} galleryId={galleryId} title={metadata.data.title} /> : <SelectionCullingGallery key={galleryId} title={metadata.data.title} />;
}

function WeddingGallery({ galleryId, title }: { galleryId: string; title?: string }) {
    const navigate = useNavigate({ from: '/culling/$galleryId' });
    const { view } = useSearch({ from: '/culling/$galleryId' });
    const [theme, setTheme] = useState<GalleryTheme>(() => readGalleryTheme(galleryId));
    const [token, setToken] = useState(() => localStorage.getItem(`orbit:edit-results-token:${galleryId}`) || '');
    useEffect(() => {
        if (view !== 'edit-results') void navigate({ search: (current) => ({ ...current, view: 'edit-results' }), replace: true, resetScroll: false });
    }, [navigate, view]);
    useEffect(() => {
        const previous = document.title;
        document.title = title ? `${title} | The Orbit Photo` : 'The Orbit Photo';
        return () => { document.title = previous; };
    }, [title]);
    const onToken = useCallback((next: string) => {
        if (next) localStorage.setItem(`orbit:edit-results-token:${galleryId}`, next);
        else localStorage.removeItem(`orbit:edit-results-token:${galleryId}`);
        setToken(next);
    }, [galleryId]);
    return <EditResultsGrid galleryId={galleryId} theme={theme} token={token} onToken={onToken} standalone deliveryOnly onToggleTheme={() => {
        setTheme((current) => {
            const next = current === 'black' ? 'white' : 'black';
            localStorage.setItem(galleryThemeKey(galleryId), next);
            return next;
        });
    }} />;
}

function SelectionCullingGallery({ title }: { title?: string }) {
    const { galleryId } = useParams({ from: '/culling/$galleryId' });
    const navigate = useNavigate({ from: '/culling/$galleryId' });
    const { view: urlView, filter: urlFilter, page: urlPage } = useSearch({ from: '/culling/$galleryId' });
    const queryClient = useQueryClient();
    const [theme, setTheme] = useState<GalleryTheme>(() => readGalleryTheme(galleryId));
    const [token, setToken] = useState(() => localStorage.getItem(tokenKey(galleryId)) || '');
    const editResultsStorageKey = `orbit:edit-results-token:${galleryId}`;
    const [editResultsToken, setEditResultsToken] = useState(() => localStorage.getItem(editResultsStorageKey) || '');
    const [showEditResultsGate, setShowEditResultsGate] = useState(false);
    const [unlockedGallery, setUnlockedGallery] = useState<PublicGallery | null>(null);
    const [selectionDraft, setSelectionDraft] = useState(() => ({
        selectedIds: new Set(readSelectionDraft(galleryId)),
        photoMetaById: readSelectedPhotoMetaDraft(galleryId),
    }));
    const [page, setPage] = useState(urlPage);
    const [activeTab, setActiveTab] = useState<GalleryView>(() => urlView as GalleryView);
    const [downloadTarget, setDownloadTarget] = useState<HTMLDivElement | null>(null);
    const [expiryTarget, setExpiryTarget] = useState<HTMLDivElement | null>(null);
    const showSelected = activeTab === 'picked';
    const [selectionTouched, setSelectionTouched] = useState(() => readSelectionDraft(galleryId).length > 0);
    const [lightboxPhotoId, setLightboxPhotoId] = useState<string | null>(null);
    const [submittedCount, setSubmittedCount] = useState<number | null>(null);
    const [showTutorial, setShowTutorial] = useState(() => Boolean(token) && !localStorage.getItem(tutorialKey(galleryId)));
    const [limitMessage, setLimitMessage] = useState('');
    const [requestSettings, setRequestSettings] = useState<GalleryContactSettings | null>(null);
    const [showRequestMore, setShowRequestMore] = useState(false);
    const [requestedCount, setRequestedCount] = useState(10);
    const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
    const [reviewOpening, setReviewOpening] = useState(false);
    const reviewOpenTimerRef = useRef<number | null>(null);
    const reviewOpenerRef = useRef<HTMLElement | null>(null);
    const [knownPhotosById, setKnownPhotosById] = useState<Record<string, GalleryPhoto>>({});
    const [pendingLightboxPageMove, setPendingLightboxPageMove] = useState<'first' | 'last' | null>(null);
    const [showFaceSearch, setShowFaceSearch] = useState(false);
    const [showRefine, setShowRefine] = useState(false);
    const allPhotosMenuRef = useRef<HTMLDivElement>(null);
    const allPhotosButtonRef = useRef<HTMLButtonElement>(null);
    const allPhotosDropdownRef = useRef<HTMLDivElement>(null);
    const submitErrorRef = useRef<HTMLDivElement>(null);
    const submitSuccessRef = useRef<HTMLDivElement>(null);
    const [refineMode, setRefineMode] = useState<GalleryRefineMode>(urlFilter as GalleryRefineMode);
    const [faceFilteredPhotos, setFaceFilteredPhotos] = useState<GalleryPhoto[] | null>(null);
    const [faceFilterTotal, setFaceFilterTotal] = useState(0);
    const [currentYear, setCurrentYear] = useState<number | null>(null);
    const selectedIds = selectionDraft.selectedIds;
    const submittedOnly = refineMode === 'submitted';
    const selectedPhotoMetaById = selectionDraft.photoMetaById;
    const selectionViewActive = activeTab !== 'edit-results';

    useEffect(() => {
        setPage(urlPage);
        setRefineMode(urlFilter as GalleryRefineMode);
        setActiveTab(urlView);
    }, [token, editResultsToken, urlFilter, urlPage, urlView]);

    useEffect(() => {
        setCurrentYear(new Date().getFullYear());
    }, []);

    const syncGalleryUrl = useCallback((next: { view?: GalleryView; filter?: GalleryRefineMode; page?: number }, replace = false) => {
        void navigate({
            search: (current) => ({
                ...current,
                view: next.view ?? current.view,
                filter: next.filter ?? current.filter,
                page: next.page ?? current.page,
            }),
            replace,
        });
    }, [navigate]);
    // Ref so the photos-cache effect can read current selection without adding it as a dep
    const selectedIdsRef = useRef(selectedIds);
    const photosQuery = useQuery({
        queryKey: ['public-gallery-photos', galleryId, token, page, GALLERY_PAGE_SIZE, false],
        queryFn: () => getPublicGalleryPhotos(galleryId, token, page, GALLERY_PAGE_SIZE, false, true),
        enabled: Boolean(token) && selectionViewActive,
        retry: false,
        placeholderData: keepPreviousData,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: true,
    });
    const startupGallery = photosQuery.isPlaceholderData ? unlockedGallery : photosQuery.data?.gallery ?? unlockedGallery;
    const startupThumbnails = useMemo(() => (photosQuery.data?.photos.slice(0, 8) ?? []).map((photo) => galleryThumbnailUrl(galleryId, photo.driveFileId, token, photo.photoToken)), [photosQuery.data, galleryId, token]);
    const startup = useGalleryStartup({
        initialSession: Boolean(token) && showTutorial && selectionViewActive,
        dataReady: photosQuery.isSuccess && !photosQuery.isPlaceholderData,
        hasSamples: startupGallery ? Boolean(startupGallery.tutorialSampleSlots?.length) : undefined,
        needsTutorial: showTutorial,
        thumbnailUrls: startupThumbnails,
    });
    useEffect(() => { if (!token) startup.cancel(); }, [token, startup.cancel]);
    const submittedPhotosQuery = useQuery({
        queryKey: ['public-gallery-submitted-photos', galleryId, token],
        queryFn: () => getPublicGalleryPhotos(galleryId, token, 1, 1, true, true),
        enabled: Boolean(token) && selectionViewActive && submittedOnly,
        retry: false,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: true,
    });
    const editResultsStatusQuery = useQuery({
        queryKey: ['public-edit-results-status', galleryId],
        queryFn: () => getEditResultsStatus(galleryId),
        staleTime: 60_000,
        retry: false,
    });
    const faceSearchStatusQuery = useQuery({
        queryKey: ['public-gallery-face-search-status', galleryId, token],
        queryFn: ({ signal }) => getFaceSearchStatus(galleryId, token, signal),
        enabled: Boolean(token) && selectionViewActive,
        retry: false,
        staleTime: 10_000,
        refetchInterval: (query) => query.state.error ? false : 30_000,
    });
    const photos = useMemo(() => photosQuery.data?.photos || [], [photosQuery.data?.photos]);
    const submittedPhotos = useMemo(() => submittedPhotosQuery.data?.selectedPhotos || photosQuery.data?.selectedPhotos || [], [photosQuery.data?.selectedPhotos, submittedPhotosQuery.data?.selectedPhotos]);
    const selectedDriveFileIds = useMemo(() => photosQuery.data?.selectedDriveFileIds || [], [photosQuery.data?.selectedDriveFileIds]);
    
    const effectiveSelectedIds = useMemo(() => {
        if (selectionTouched || selectedIds.size > 0) return selectedIds;
        if (showSelected && submittedPhotos.length > 0) return new Set(submittedPhotos.map((photo) => photo.driveFileId));
        return new Set(selectedDriveFileIds);
    }, [selectedDriveFileIds, selectedIds, selectionTouched, showSelected, submittedPhotos]);
    selectedIdsRef.current = effectiveSelectedIds;
    
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
    const isFaceFilterActive = faceFilteredPhotos !== null && activeTab === 'selfie';
    const faceSearchAvailable = faceSearchStatusQuery.data?.available === true;
    const faceSearchControlVisible = faceSearchAvailable || faceFilteredPhotos !== null;
    const visiblePhotos = useMemo(() => {
        if (activeTab === 'picked') return pickedPhotos;
        if (activeTab !== 'gallery' && activeTab !== 'selfie') return photos;
        if (isFaceFilterActive) {
            const matched = faceFilteredPhotos || [];
            if (submittedOnly) {
                const submittedIds = new Set(submittedPhotos.map((photo) => photo.driveFileId));
                return matched.filter((photo) => submittedIds.has(photo.driveFileId));
            }
            return matched;
        }
        return activeTab === 'selfie' ? [] : submittedOnly ? submittedPhotos : photos;
    }, [activeTab, faceFilteredPhotos, isFaceFilterActive, photos, pickedPhotos, submittedOnly, submittedPhotos]);
    const displayGallery = photosQuery.data?.gallery || unlockedGallery;
    const countdown = useSelectionCountdown(displayGallery?.selectionDeadlineAt, displayGallery?.serverTime);
    const galleryError = photosQuery.error as (Error & { code?: string; contactUrl?: string | null }) | null;
    const galleryLockCode = galleryError?.code === 'GALLERY_EXPIRED' || galleryError?.code === 'GALLERY_CLOSED' ? galleryError.code : null;
    const galleryAvailable = activeTab === 'edit-results'
        ? Boolean(token)
        : Boolean(token && photosQuery.isSuccess && !countdown.isExpired && !displayGallery?.isExpired && !galleryLockCode);
    const totalPages = photosQuery.data?.totalPages || 0;
    const totalPhotos = isFaceFilterActive ? visiblePhotos.length : photosQuery.data?.total || visiblePhotos.length;
    const hasPreviousGalleryPage = activeTab === 'gallery' && !submittedOnly && !isFaceFilterActive && totalPages > 0 && page > 1;
    const hasNextGalleryPage = activeTab === 'gallery' && !submittedOnly && !isFaceFilterActive && totalPages > 0 && page < totalPages;
    const hasSubmittedPhotos = Number(displayGallery?.selectionCount || submittedCount || selectedDriveFileIds.length) > 0;

    useEffect(() => {
        const previousTitle = document.title;
        document.title = displayGallery?.title?.trim()
            ? `${displayGallery.title.trim()} | The Orbit Photo`
            : 'The Orbit Photo';

        return () => {
            document.title = previousTitle;
        };
    }, [displayGallery?.title]);

    const resetFaceFilter = useCallback(() => {
        setFaceFilteredPhotos(null);
        setFaceFilterTotal(0);
        setRefineMode('none');
        setLightboxPhotoId(null);
    }, []);

    const openAllPhotosMenu = () => setShowRefine((current) => !current);
    useEffect(() => {
        if (!showRefine) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (allPhotosMenuRef.current && !allPhotosMenuRef.current.contains(event.target as Node)) {
                setShowRefine(false);
                allPhotosButtonRef.current?.focus();
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setShowRefine(false);
                allPhotosButtonRef.current?.focus();
                return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const items = Array.from(allPhotosDropdownRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
                if (!items.length) return;
                const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
                const nextIndex = event.key === 'ArrowDown'
                    ? (currentIndex + 1) % items.length
                    : (currentIndex - 1 + items.length) % items.length;
                items[nextIndex]?.focus();
            }
        };
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [showRefine]);
    useEffect(() => {
        if (showRefine) requestAnimationFrame(() => allPhotosDropdownRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
    }, [showRefine]);
    const chooseRefineMode = (mode: GalleryRefineMode) => {
        setShowRefine(false);
        setPage(1);
        setLightboxPhotoId(null);
        setPendingLightboxPageMove(null);
        if (mode === 'submitted') {
            setActiveTab('gallery');
            setRefineMode('submitted');
            syncGalleryUrl({ view: 'gallery', filter: 'submitted', page: 1 });
            return;
        }
        if (mode === 'none') {
            resetFaceFilter();
            setRefineMode('none');
            setActiveTab('gallery');
            syncGalleryUrl({ view: 'gallery', filter: 'none', page: 1 });
        }
    };

    const goToGalleryPage = useCallback((nextPage: number) => {
        const clampedPage = totalPages ? Math.min(totalPages, Math.max(1, nextPage)) : Math.max(1, nextPage);
        if (clampedPage === page) return;
        setPendingLightboxPageMove(null);
        setPage(clampedPage);
        syncGalleryUrl({ page: clampedPage });
        setLightboxPhotoId(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [page, syncGalleryUrl, totalPages]);

    const moveLightboxAcrossPage = useCallback((direction: 'previous' | 'next') => {
        if (showSelected || pendingLightboxPageMove) return;

        if (direction === 'previous' && hasPreviousGalleryPage) {
            setPendingLightboxPageMove('last');
            const nextPage = Math.max(1, page - 1);
            setPage(nextPage);
            syncGalleryUrl({ page: nextPage });
            return;
        }

        if (direction === 'next' && hasNextGalleryPage) {
            setPendingLightboxPageMove('first');
            const nextPage = totalPages ? Math.min(totalPages, page + 1) : page + 1;
            setPage(nextPage);
            syncGalleryUrl({ page: nextPage });
        }
    }, [hasNextGalleryPage, hasPreviousGalleryPage, page, pendingLightboxPageMove, showSelected, syncGalleryUrl, totalPages]);

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
    const qrisEnabled = Boolean(displayGallery?.addon?.qrisEnabled);
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
    const reviewCanOpenRef = useRef(false);
    reviewCanOpenRef.current = galleryAvailable && hasUnsavedChanges && !isOverLimit && activeTab !== 'edit-results' && !showRequestMore && !showTutorial && !showFaceSearch;

    useEffect(() => () => {
        if (reviewOpenTimerRef.current !== null) window.clearTimeout(reviewOpenTimerRef.current);
    }, []);

    useEffect(() => {
        if (!hasUnsavedChanges) return;
        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [hasUnsavedChanges]);

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
        const incomingPhotos = [...photos, ...submittedPhotos, ...(faceFilteredPhotos || [])];
        if (!incomingPhotos.length) return;

        // eslint-disable-next-line react-hooks/set-state-in-effect -- Keep a local photo cache so picked selections survive pagination and reloads.
        setKnownPhotosById((current) => {
            let changed = false;
            // Only retain currently-selected photos — prevents unbounded RAM growth across pages.
            // selectedIdsRef.current is always up-to-date without being a dep.
            const activeIds = selectedIdsRef.current;
            const next: Record<string, GalleryPhoto> = {};

            // Carry over existing selected entries
            for (const id of activeIds) {
                if (current[id]) next[id] = current[id];
            }
            if (Object.keys(current).length !== Object.keys(next).length) changed = true;

            // Update/add from incoming batch (only for selected photos)
            for (const photo of incomingPhotos) {
                if (!activeIds.has(photo.driveFileId)) continue;
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
    }, [faceFilteredPhotos, photos, submittedPhotos]);

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
        if (!submitMutation.isError || showSubmitConfirm) return;
        requestAnimationFrame(() => submitErrorRef.current?.focus());
    }, [showSubmitConfirm, submitMutation.isError]);

    useEffect(() => {
        if (submittedCount === null) return;
        requestAnimationFrame(() => submitSuccessRef.current?.focus());
    }, [submittedCount]);

    useEffect(() => {
        localStorage.setItem(draftKey(galleryId), JSON.stringify(selectionList));
        localStorage.setItem(selectedPhotoMetaKey(galleryId), JSON.stringify(pruneSelectedPhotoMeta(selectedPhotoMetaById, selectionList)));
    }, [galleryId, selectedPhotoMetaById, selectionList]);

    useEffect(() => {
        const totalPages = photosQuery.data?.totalPages || 0;
        if (showSelected || showTutorial || startup.preparing || !token || !photosQuery.data || page >= totalPages) return;

        const idle = window.setTimeout(() => {
            void queryClient.prefetchQuery({
                queryKey: ['public-gallery-photos', galleryId, token, page + 1, GALLERY_PAGE_SIZE, false],
                queryFn: () => getPublicGalleryPhotos(galleryId, token, page + 1, GALLERY_PAGE_SIZE, false, true),
                staleTime: 5 * 60 * 1000,
            });
        }, 800);

        return () => window.clearTimeout(idle);
    }, [galleryId, page, photosQuery.data, queryClient, showSelected, showTutorial, startup.preparing, token]);

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

    const handleReviewSelection = () => {
        if (!galleryAvailable || !hasUnsavedChanges || reviewOpenTimerRef.current !== null) return;
        if (isOverLimit) {
            setLimitMessage(`You selected ${selectedCount} photos, but this gallery allows ${selectionLimit}. Remove ${overLimitCount} photo${overLimitCount === 1 ? '' : 's'} before submitting.`);
            return;
        }
        setLimitMessage('');
        submitMutation.reset();
        reviewOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setReviewOpening(true);
        reviewOpenTimerRef.current = window.setTimeout(() => {
            reviewOpenTimerRef.current = null;
            setReviewOpening(false);
            if (reviewCanOpenRef.current) setShowSubmitConfirm(true);
        }, 300);
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

    const updateEditResultsToken = useCallback((nextToken: string) => {
        if (nextToken) localStorage.setItem(editResultsStorageKey, nextToken);
        else localStorage.removeItem(editResultsStorageKey);
        setEditResultsToken(nextToken);
        setShowEditResultsGate(!nextToken);
        setActiveTab('edit-results');
        syncGalleryUrl({ view: 'edit-results' });
    }, [editResultsStorageKey, syncGalleryUrl]);

    const submissionStatus: SubmissionStatus = submitMutation.isPending
        ? 'pending'
        : hasUnsavedChanges
            ? 'dirty'
            : submittedCount !== null || Number(displayGallery?.selectionCount || 0) > 0
                ? 'submitted'
                : 'ready';
    const showSelectionActionBar = activeTab !== 'edit-results' && galleryAvailable && hasUnsavedChanges;
    const [actionBarMounted, setActionBarMounted] = useState(false);
    const [actionBarVisible, setActionBarVisible] = useState(false);

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setActionBarMounted(showSelectionActionBar);
            setActionBarVisible(showSelectionActionBar);
            return;
        }
        if (showSelectionActionBar) {
            setActionBarMounted(true);
            let enterFrame = 0;
            const paintFrame = window.requestAnimationFrame(() => {
                enterFrame = window.requestAnimationFrame(() => setActionBarVisible(true));
            });
            return () => {
                window.cancelAnimationFrame(paintFrame);
                window.cancelAnimationFrame(enterFrame);
            };
        }
        setActionBarVisible(false);
        const exitTimer = window.setTimeout(() => setActionBarMounted(false), 220);
        return () => window.clearTimeout(exitTimer);
    }, [showSelectionActionBar]);
    const changeView = (view: GalleryView) => {
        if (view !== 'edit-results' && !galleryAvailable) return;
        if (reviewOpenTimerRef.current !== null) {
            window.clearTimeout(reviewOpenTimerRef.current);
            reviewOpenTimerRef.current = null;
            setReviewOpening(false);
        }
        if (view === 'picked') {
            setRefineMode('none');
        } else if (view === 'selfie') {
            setRefineMode('none');
            if (activeTab === 'selfie' || faceFilteredPhotos === null) setShowFaceSearch(true);
        }
        setActiveTab(view);
        syncGalleryUrl({ view, ...((view === 'picked' || view === 'selfie') ? { filter: 'none' as const } : {}) });
        setLightboxPhotoId(null);
        setPendingLightboxPageMove(null);
    };

    if (!token && activeTab === 'edit-results' && (editResultsToken || showEditResultsGate || urlView === 'edit-results')) {
        return <EditResultsGrid galleryId={galleryId} theme={theme} token={editResultsToken} onToken={updateEditResultsToken} onToggleTheme={toggleTheme} onViewChange={changeView} onRequestSelectionAccess={() => { setActiveTab('gallery'); syncGalleryUrl({ view: 'gallery' }); }} standalone />;
    }

    if (token && (countdown.isExpired || displayGallery?.isExpired || galleryLockCode)) {
        if (activeTab === 'edit-results' && (editResultsToken || showEditResultsGate)) return <EditResultsGrid galleryId={galleryId} theme={theme} token={editResultsToken} onToken={updateEditResultsToken} onToggleTheme={toggleTheme} onViewChange={changeView} standalone />;
        return <GalleryLockedScreen title={title} expired={countdown.isExpired || Boolean(displayGallery?.isExpired) || galleryLockCode === 'GALLERY_EXPIRED'} contactUrl={galleryError?.contactUrl || fallbackContactUrl} theme={theme} onToggleTheme={toggleTheme} hasEditResults={editResultsStatusQuery.data?.available || Boolean(displayGallery?.hasEditResults)} onAccessEditedPhotos={() => { setShowEditResultsGate(true); changeView('edit-results'); }} />;
    }

    return (
        <div style={theme === 'black' ? BLACK_THEME : WHITE_THEME} className="font-sans">
        {(!token || startup.preparing) && <div inert={startup.leaving} aria-hidden={startup.leaving} className="gallery-unlock-overlay fixed inset-0 z-[140] overflow-y-auto" data-leaving={startup.leaving}>
            <PinGate galleryId={galleryId} title={title} theme={theme} onToggleTheme={toggleTheme} initialMode={urlView === 'edit-results' ? 'edited' : 'gallery'} editedSessionAvailable={Boolean(editResultsToken)} onBackToEdited={() => { setActiveTab('edit-results'); syncGalleryUrl({ view: 'edit-results' }); }} onEditResultsUnlocked={updateEditResultsToken} onUnlocked={(nextToken, nextGallery, submittedAt) => { startup.start(submittedAt); setActiveTab('gallery'); if (urlView === 'edit-results') syncGalleryUrl({ view: 'gallery' }); setToken(nextToken); setUnlockedGallery(nextGallery); setShowTutorial(!localStorage.getItem(tutorialKey(galleryId))); }} opening={startup.preparing} leaving={startup.leaving} preparationError={startup.preparing && photosQuery.isError ? 'Unable to load your gallery. Please try again.' : undefined} onRetry={() => void photosQuery.refetch()} />
        </div>}
        {token && (!startup.preparing || startup.leaving) && <main inert={startup.preparing || showTutorial} aria-hidden={startup.preparing || showTutorial} className={clsx('min-h-screen bg-[var(--bg-deep)] font-sans text-[var(--text-primary)]', activeTab === 'edit-results' && 'flex flex-col')}>
            <a href="#gallery-content" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-[var(--accent)] focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-[var(--bg-deep)]">
                Skip to gallery
            </a>
            
            <header data-testid="gallery-header" className="sticky top-0 z-40 h-20 select-none border-b border-[var(--border)] bg-[var(--bg-deep)] px-2.5 sm:px-8 lg:h-16">
                <div className="mx-auto grid h-full max-w-[1600px] min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[2.75rem_1.5rem] items-center gap-x-2 py-1 lg:flex lg:py-0">
                    <OrbitLogo theme={theme} />
                    <GalleryHeaderIdentity section={activeTab === 'edit-results' ? 'Edited Photos' : 'Photo Selection'} title={activeTab === 'edit-results' ? title : displayGallery?.title || title} />
                    <div className="col-start-3 row-start-1 flex shrink-0 items-center gap-1 sm:ml-2 sm:gap-2 lg:ml-auto lg:gap-0">
                        {activeTab === 'edit-results' && <div ref={setExpiryTarget} className="flex min-w-0 items-center" />}
                        {activeTab !== 'edit-results' && <div className="lg:pr-2"><CountdownLabel countdown={countdown} compact /></div>}
                        <div data-testid="header-utilities" className="flex items-center gap-2">
                            {activeTab !== 'edit-results' && <button type="button" onClick={() => setShowTutorial(true)} title="How to Submit" aria-label="How to Submit" className="flex h-11 w-11 shrink-0 items-center justify-center px-2 text-[var(--text-secondary)] transition-[color,transform] duration-150 hover:text-[var(--text-primary)] active:scale-[0.97] motion-reduce:transition-none"><HelpCircle size={16} aria-hidden="true" /></button>}
                            <ThemeToggle theme={theme} onToggle={toggleTheme} />
                        </div>
                    </div>
                </div>
            </header>

            <div data-testid="gallery-toolbar" className="sticky top-20 z-30 select-none border-b border-[var(--border)] bg-[var(--bg-deep)] px-2.5 py-2 [touch-action:manipulation] sm:px-8 sm:py-2.5 lg:top-16">
                <div data-testid="gallery-toolbar-inner" className="mx-auto flex max-w-[1600px] items-center gap-1 sm:gap-x-2">
                    <div ref={allPhotosMenuRef} className="relative flex w-[calc((100%-0.375rem)/2)] min-w-0 flex-none items-center gap-1 sm:w-auto sm:gap-2">
                        <GalleryViewTabs value={activeTab === 'picked' ? 'gallery' : activeTab} galleryAvailable={galleryAvailable} galleryLabel={activeTab === 'picked' ? 'Picked' : submittedOnly ? 'Submitted' : 'All Photos'} editedAvailable={editResultsStatusQuery.data?.available ?? Boolean(displayGallery?.hasEditResults)} editedExpired={Boolean(editResultsStatusQuery.data?.isExpired)} selfieAvailable={faceSearchControlVisible} allPhotosMenuOpen={showRefine} allPhotosButtonRef={allPhotosButtonRef} onAllPhotos={activeTab === 'edit-results' ? () => changeView('gallery') : openAllPhotosMenu} onChange={changeView} />
                        {showRefine && activeTab !== 'edit-results' && (
                            <div ref={allPhotosDropdownRef} className="absolute left-0 top-[calc(100%+8px)] z-[80] w-[min(204px,calc(100vw-16px))] rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-1.5 shadow-xl transition-[opacity,transform] duration-150 motion-reduce:transition-none" role="menu" aria-label="All Photos views">
                                <button type="button" role="menuitemradio" aria-checked={refineMode === 'none' && activeTab === 'gallery'} onClick={() => chooseRefineMode('none')} className={clsx('flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2.5 text-[13px] font-medium', refineMode === 'none' && activeTab === 'gallery' ? 'bg-[var(--accent)] text-[var(--bg-deep)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card)]')}>
                                    <span className="flex items-center gap-2"><ImageIcon size={15} aria-hidden="true" />All Photos</span>{refineMode === 'none' && activeTab === 'gallery' && <Check size={14} aria-hidden="true" />}
                                </button>
                                <button type="button" role="menuitemradio" aria-checked={activeTab === 'picked'} onClick={() => { setShowRefine(false); changeView('picked'); }} className={clsx('flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2.5 text-[13px] font-medium', activeTab === 'picked' ? 'bg-[var(--accent)] text-[var(--bg-deep)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card)]')}>
                                    <span className="flex items-center gap-2"><CheckSquare size={15} aria-hidden="true" />Picked</span>{activeTab === 'picked' && <Check size={14} aria-hidden="true" />}
                                </button>
                                <button type="button" role="menuitemradio" aria-checked={refineMode === 'submitted'} disabled={!hasSubmittedPhotos} onClick={() => chooseRefineMode('submitted')} className={clsx('flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-2.5 text-[13px] font-medium disabled:opacity-40', refineMode === 'submitted' ? 'bg-[var(--accent)] text-[var(--bg-deep)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card)]')}>
                                    <span className="flex items-center gap-2"><Send size={15} aria-hidden="true" />Submitted</span>{refineMode === 'submitted' && <Check size={14} aria-hidden="true" />}
                                </button>
                                {refineMode === 'submitted' && <button type="button" role="menuitem" onClick={() => chooseRefineMode('none')} className="mt-1 flex min-h-11 w-full items-center rounded-md px-2.5 text-left text-xs text-[var(--text-muted)] hover:bg-[var(--bg-card)]">Clear filters</button>}
                            </div>
                        )}
                    </div>

                    <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1 sm:gap-2 lg:gap-0">
                    {activeTab !== 'edit-results' && <div data-testid="selection-summary" className={clsx('inline-flex min-w-0 items-center gap-1 whitespace-nowrap text-xs text-[var(--text-secondary)] transition-transform duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none sm:gap-2 sm:text-sm lg:pr-2', requestMoreUrl && !shouldShowRequestMore && 'translate-x-[4rem] min-[390px]:translate-x-[4.75rem] sm:translate-x-20 md:translate-x-[10.5rem] lg:translate-x-44')}>
                        <span className="inline-flex items-center gap-1"><Images size={14} aria-hidden="true" className="shrink-0" /><strong className="tabular-nums text-[var(--text-primary)]">{selectedCount}{selectionLimit ? `/${selectionLimit}` : ''}</strong>{' '}<span className="hidden md:inline">selected</span></span>
                        <span className={clsx('hidden items-center gap-1 sm:inline-flex', isOverLimit && 'text-rose-400')}><ImagePlus size={14} aria-hidden="true" />{selectionLimit ? `${isOverLimit ? overLimitCount : remainingSelections} ${isOverLimit ? 'over' : 'left'}` : 'Unlimited'}</span>
                        <span data-testid="selection-count-announcement" aria-live="polite" className="sr-only">{selectedCount} selected{selectionLimit ? ` of ${selectionLimit}; ${isOverLimit ? `${overLimitCount} over limit` : `${remainingSelections} remaining`}` : ''}</span>
                        <span role="status" className="sr-only">{submissionStatusLabel(submissionStatus)}</span>
                    </div>}
                    {activeTab !== 'edit-results' && requestMoreUrl && <div data-testid="request-more-group" aria-hidden={!shouldShowRequestMore} inert={!shouldShowRequestMore} className={clsx('w-[3.75rem] shrink-0 transition-[opacity,transform] duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none min-[390px]:w-[4.5rem] md:w-40 lg:w-44', shouldShowRequestMore ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0')}>
                        <button type="button" aria-label="Request more editing slots" title="Request more editing slots" onClick={() => { setShowRequestMore(true); void photosQuery.refetch(); }} className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-0.5 whitespace-nowrap rounded-md border border-[var(--border)] px-0.5 text-[11px] font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-card)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] min-[390px]:gap-1 min-[390px]:px-2 md:gap-2 md:px-3 md:text-sm lg:px-4 lg:text-[15px]"><Plus size={14} aria-hidden="true" /><span className="md:hidden">More</span><span className="hidden md:inline">Request More</span></button>
                    </div>}
                        <div ref={setDownloadTarget} className={activeTab === 'edit-results' ? 'flex min-w-0 shrink-0 items-center justify-end' : 'hidden'} />
                    </div>
                </div>
            </div>

            <section id="gallery-content" tabIndex={-1} className={clsx('mx-auto w-full max-w-[1664px] px-2.5 pt-3 pb-10 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] sm:px-8 sm:pt-5 sm:pb-12 md:pt-6', activeTab === 'edit-results' ? 'flex-1 scroll-mt-44 sm:scroll-mt-28' : 'scroll-mt-44 lg:scroll-mt-36')}>
                {activeTab !== 'edit-results' && limitMessage && (
                    <div role="alert" className="mb-4 text-xs text-[var(--text-muted)] border border-[var(--border)] p-3 rounded-lg bg-[var(--bg-card)]">
                        {limitMessage} {requestMoreUrl && <button type="button" onClick={() => setShowRequestMore(true)} className="ml-1 font-semibold underline text-[var(--text-primary)]">Request more</button>}
                    </div>
                )}
                {activeTab !== 'edit-results' && submittedCount !== null && (
                    <div ref={submitSuccessRef} role="status" tabIndex={-1} aria-live="polite" className="mb-5 flex items-center gap-3 border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                        <Check size={16} aria-hidden="true" />
                        Selection saved. {submittedCount} filenames submitted.
                    </div>
                )}
                {activeTab !== 'edit-results' && submitMutation.isError && !showSubmitConfirm && (
                    <div ref={submitErrorRef} role="alert" tabIndex={-1} aria-live="assertive" className="mb-5 flex items-center gap-3 border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                        <AlertCircle size={16} aria-hidden="true" />
                        {submitMutation.error instanceof Error ? submitMutation.error.message : 'Unable to submit selections.'}
                    </div>
                )}

                {activeTab === 'edit-results' ? (
                    <EditResultsGrid galleryId={galleryId} theme={theme} token={editResultsToken} onToken={updateEditResultsToken} downloadTarget={downloadTarget} expiryTarget={expiryTarget} />
                ) : (submittedOnly ? submittedPhotosQuery.isLoading : photosQuery.isLoading) ? (
                    <div role="status" aria-live="polite" className="flex min-h-[60vh] items-center justify-center gap-3 text-sm text-[var(--text-muted)]">
                        <Loader2 size={24} aria-hidden="true" className="animate-spin text-[var(--accent)]" />
                        <span>Loading photos…</span>
                    </div>
                ) : (submittedOnly ? submittedPhotosQuery.isError : photosQuery.isError) && !visiblePhotos.length ? (
                    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
                        <AlertCircle size={30} className="mb-4 text-[var(--text-muted)]" />
                        <p className="font-display text-2xl text-[var(--text-primary)]">Gallery Session Expired</p>
                        <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--text-muted)]">The gallery was reopened or your session expired. Enter the password again to continue.</p>
                        <button type="button" onClick={() => { localStorage.removeItem(tokenKey(galleryId)); setToken(''); }} className="mt-6 flex h-10 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-5 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--bg-deep)] transition-opacity hover:opacity-85"><Lock size={14} /> Enter password again</button>
                    </div>
                ) : !visiblePhotos.length ? (
                    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
                        {activeTab === 'selfie' || isFaceFilterActive ? <ScanFace size={30} className="mb-4 text-[var(--text-muted)]" /> : showSelected ? <CheckSquare size={30} className="mb-4 text-[var(--text-muted)]" /> : <ImageIcon size={30} className="mb-4 text-[var(--text-muted)]" />}
                        <p className="font-display text-2xl text-[var(--text-primary)]">{activeTab === 'selfie' ? (isFaceFilterActive ? 'No face matches found' : 'Find Your Photos') : showSelected ? 'No Picked Photos' : submittedOnly ? 'No Submitted Photos' : 'No photos synced yet'}</p>
                        <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--text-muted)]">
                            {activeTab === 'selfie' ? 'Choose a clear selfie to find matching moments in this gallery.' : isFaceFilterActive ? 'Try a brighter front-facing selfie or use Wide sensitivity.' : showSelected ? 'Select photos from the gallery to see them here before submitting.' : submittedOnly ? 'Submit your current picks to update this list.' : 'The studio needs to sync this Drive folder before selection opens.'}
                        </p>
                        {isFaceFilterActive && (
                            <button type="button" onClick={resetFaceFilter} className="mt-6 flex h-9 items-center justify-center rounded-lg border border-[var(--border)] px-4 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]">
                                Back to all photos
                            </button>
                        )}
                    </div>
                ) : (
                    <div data-testid="gallery-grid" className="grid [content-visibility:auto] grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2 md:grid-cols-4 md:gap-3 xl:grid-cols-5 2xl:grid-cols-6">
                        {visiblePhotos.map((photo, index) => {
                            const fallbackIndex = showSelected || isFaceFilterActive ? index : (page - 1) * GALLERY_PAGE_SIZE + index;
                            return (
                                <PhotoTile
                                    key={photo.driveFileId}
                                    photo={photo}
                                    selected={effectiveSelectedIds.has(photo.driveFileId)}
                                    token={token}
                                    galleryId={galleryId}
                                    displayIndex={photoDisplayIndex(photo, fallbackIndex)}
                                    thumbnailPriority={index === 0}
                                    thumbnailEager={index < 10}
                                    onOpen={handleOpenLightbox}
                                    onPrefetch={handlePrefetchLightbox}
                                    onToggle={handleToggleSelection}
                                />
                            );
                        })}
                    </div>
                )}
                
                {activeTab === 'gallery' && !showSelected && !submittedOnly && !isFaceFilterActive && !photosQuery.isLoading && !photosQuery.isError && photosQuery.data && totalPages > 1 && (
                    <nav className="mt-8 flex items-center justify-center gap-4" aria-label="Gallery pages">
                        <button type="button" disabled={page === 1 || photosQuery.isFetching} onClick={() => goToGalleryPage(page - 1)} className="flex h-11 items-center gap-2 rounded-lg border border-[var(--border)] px-4 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-35"><ChevronLeft size={14} aria-hidden="true" /> Previous</button>
                        <span className="text-xs tabular-nums text-[var(--text-muted)]">Page {page} of {totalPages}</span>
                        <button type="button" disabled={!hasNextGalleryPage || photosQuery.isFetching} onClick={() => goToGalleryPage(page + 1)} className="flex h-11 items-center gap-2 rounded-lg border border-[var(--border)] px-4 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-35">Next <ChevronRight size={14} aria-hidden="true" /></button>
                    </nav>
                )}
            </section>

            {actionBarMounted && <div data-testid="selection-action-bar" role="region" aria-label="Selection actions" aria-hidden={!actionBarVisible} inert={!actionBarVisible} data-visible={actionBarVisible} className={clsx('selection-action-bar-motion fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--bg-deep)] px-2.5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.12)] sm:px-8', actionBarVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-full opacity-0')}>
                <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3">
                    <div className="min-w-0 text-xs text-[var(--text-secondary)] sm:text-sm">
                        <p className="flex items-center gap-1.5 whitespace-nowrap"><Check size={15} aria-hidden="true" className="shrink-0" /><strong className="tabular-nums text-[var(--text-primary)]">{selectedCount}{selectionLimit ? `/${selectionLimit}` : ''}</strong><span className="hidden min-[360px]:inline">photos</span> selected</p>
                        <p className={clsx('mt-0.5 hidden text-xs sm:block', isOverLimit && 'text-rose-400')}>{isOverLimit ? `Remove ${overLimitCount} ${overLimitCount === 1 ? 'photo' : 'photos'} to continue` : selectedCount === 0 ? 'Review removal of the previous submission' : selectionLimit && selectedCount === selectionLimit ? 'Ready to review' : 'Review before submitting'}</p>
                    </div>
                    <SubmissionAction status={submissionStatus} disabled={reviewOpening || submitMutation.isPending || photosQuery.isLoading || isOverLimit} opening={reviewOpening} overLimit={isOverLimit} clearsSelection={selectedCount === 0} onReview={handleReviewSelection} />
                    <span role="status" aria-live="polite" className="sr-only">{reviewOpening ? 'Opening selection review' : ''}</span>
                </div>
            </div>}

            <footer className={clsx('border-t border-[var(--border)] px-4 py-5 text-[10px] text-[var(--text-muted)] md:px-8', (showSelectionActionBar || activeTab === 'edit-results') && 'pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-24')}>
                <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-between gap-3 sm:flex-row">
                    <p>&copy; {currentYear ?? ''} The Orbit Photo. All rights reserved.</p>
                    <a href="https://www.instagram.com/theorbitphoto/" target="_blank" rel="noreferrer" aria-label="@theorbitphoto on Instagram" className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                        <Instagram size={13} /> @theorbitphoto
                    </a>
                </div>
            </footer>

            <Lightbox
                galleryId={galleryId}
                token={token}
                photos={visiblePhotos}
                displayStartIndex={showSelected || submittedOnly ? 0 : (page - 1) * GALLERY_PAGE_SIZE}
                currentPhotoId={lightboxPhotoId}
                selectedIds={effectiveSelectedIds}
                hasPreviousPage={hasPreviousGalleryPage}
                hasNextPage={hasNextGalleryPage}
                totalCount={showSelected || submittedOnly ? visiblePhotos.length : totalPhotos}
                onClose={() => setLightboxPhotoId(null)}
                onMove={setLightboxPhotoId}
                onPreviousPage={() => moveLightboxAcrossPage('previous')}
                onNextPage={() => moveLightboxAcrossPage('next')}
                onToggle={handleToggleSelection}
            />

            {showRequestMore && requestMoreUrl && (
                <RequestMoreModal
                    theme={theme}
                    galleryId={galleryId}
                    requestedCount={requestedCount}
                    selectedCount={selectedCount}
                    unitPrice={addonUnitPrice}
                    discountRules={discountRules}
                    qrisEnabled={qrisEnabled}
                    requestUrl={requestMoreUrl}
                    onChange={setRequestedCount}
                    onClose={() => setShowRequestMore(false)}
                    onPaymentSuccess={() => {
                        void photosQuery.refetch();
                    }}
                />
            )}

            {showSubmitConfirm && (
                <SubmitConfirmationModal
                    theme={theme}
                    selectedCount={selectedCount}
                    photos={pickedPhotos}
                    galleryId={galleryId}
                    token={token}
                    pending={submitMutation.isPending}
                    error={submitMutation.isError ? (submitMutation.error instanceof Error ? submitMutation.error.message : 'Unable to submit selections.') : undefined}
                    onConfirm={() => submitMutation.mutate()}
                    onClose={() => {
                        submitMutation.reset();
                        setShowSubmitConfirm(false);
                        requestAnimationFrame(() => {
                            if (reviewOpenerRef.current?.isConnected) reviewOpenerRef.current.focus({ preventScroll: true });
                        });
                    }}
                />
            )}

            {false && (
                <div
                    className="fixed inset-0 z-[120] flex items-end bg-black/45 sm:items-center sm:justify-center"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="refine-title"
                    onMouseDown={(event) => { if (event.target === event.currentTarget) setShowRefine(false); }}
                >
                    <div className="w-full max-w-md rounded-t-2xl border border-[var(--border)] bg-[var(--bg-deep)] p-4 shadow-2xl sm:rounded-xl">
                        <div className="mb-3 flex items-center justify-between">
                            <div>
                                <p id="refine-title" className="text-sm font-semibold text-[var(--text-primary)]">All Photos</p>
                                <p className="mt-0.5 text-xs text-[var(--text-muted)]">Choose what you want to see.</p>
                            </div>
                            <button type="button" aria-label="Close refine filters" onClick={() => setShowRefine(false)} className="flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"><X size={16} /></button>
                        </div>
                        <div className="grid gap-2">
                            <button type="button" onClick={() => chooseRefineMode('none')} className={clsx('flex min-h-11 items-center justify-between rounded-md border px-3 text-left text-sm', refineMode === 'none' ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]' : 'border-[var(--border)] text-[var(--text-secondary)]')}>
                                <span className="flex items-center gap-2"><ImageIcon size={16} />All Photos</span><span aria-hidden="true">{refineMode === 'none' && <Check size={15} />}</span>
                            </button>
                            <button type="button" onClick={() => chooseRefineMode('submitted')} disabled={!hasSubmittedPhotos} className={clsx('flex min-h-11 items-center justify-between rounded-md border px-3 text-left text-sm disabled:opacity-40', refineMode === 'submitted' ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]' : 'border-[var(--border)] text-[var(--text-secondary)]')}>
                                <span className="flex items-center gap-2"><Send size={16} />Submitted</span><span aria-hidden="true">{refineMode === 'submitted' && <Check size={15} />}</span>
                            </button>
                            <button type="button" onClick={() => { setShowRefine(false); changeView('picked'); }} className="flex min-h-11 items-center gap-2 rounded-md border border-[var(--border)] px-3 text-left text-sm text-[var(--text-secondary)]">
                                <CheckSquare size={16} aria-hidden="true" />Picked
                            </button>
                        </div>
                        {refineMode !== 'none' && <button type="button" onClick={() => chooseRefineMode('none')} className="mt-3 h-10 w-full rounded-md text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-card)]">Clear filters</button>}
                    </div>
                </div>
            )}

            {showFaceSearch && faceSearchControlVisible && (
                <FaceSearchModal
                    theme={theme}
                    galleryId={galleryId}
                    token={token}
                    activeCount={faceFilteredPhotos?.length || 0}
                    activeTotal={faceFilterTotal}
                    onApply={(matchedPhotos, total) => {
                        setFaceFilteredPhotos(matchedPhotos);
                        setFaceFilterTotal(total);
                        setRefineMode('none');
                        setActiveTab('selfie');
                        setLightboxPhotoId(null);
                    }}
                    onReset={resetFaceFilter}
                    onClose={() => setShowFaceSearch(false)}
                />
            )}
            
        </main>}
        {token && showTutorial && startupGallery && <TutorialModal key={token} galleryId={galleryId} token={token} tutorialSampleSlots={startupGallery.tutorialSampleSlots || []} tutorialSampleVersion={startupGallery.tutorialSampleVersion} onClose={closeTutorial} active={!startup.preparing || startup.leaving} textOnly={startup.textOnly} onInitialMediaSettled={startup.preparing ? startup.onMediaSettled : undefined} />}
        </div>
    );
}
