import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useRouter, useSearch } from '@tanstack/react-router';
import { AlertCircle, ArrowLeft, Camera, Check, CheckSquare, ChevronLeft, ChevronRight, Clock3, Download, Folder, FolderOpen, HelpCircle, ImageIcon, Images, Loader2, Lock, MessageCircle, RotateCcw, ScanFace, Send, Video, X } from 'lucide-react';
import clsx from 'clsx';

import { editResultVideoUrl, getEditedOwnPhotos, getEditFolderArchiveJob, getEditResults, getEditResultsStatus, resolveEditResultDownload, startEditFolderArchive, startEditGalleryArchive, verifyEditResultsPassword, type EditFolderArchiveScope } from '../culling.public';
import type { EditResultPhoto } from '../culling.types';
import type { ClientCullingSearch } from '../../../router';
import { BLACK_THEME, GALLERY_PAGE_SIZE, WHITE_THEME } from './constants';
import { GalleryHeader, GalleryViewTabs, OrbitLogo, ThemeToggle, type GalleryView } from './GalleryChrome';
import { GalleryFooter } from './GalleryFooter';
import { GalleryPreparingScreen } from './AccessScreens';
import { PhotoTile } from './PhotoTile';
import { Lightbox } from './Lightbox';
import { GalleryPasswordField } from './GalleryPasswordField';
import { EditedPhotosGuide } from './EditedPhotosGuide';
import { OwnPhotoChooser } from './OwnPhotoChooser';
import { OWN_PHOTO_SEARCH_ENABLED } from './own-photo-availability';
import { canPrefetchPreview, preloadPreviewImage } from './preview-cache';
import type { GalleryTheme } from './types';

const previewUrlFor = (photo: EditResultPhoto) => photo.previewUrl;
const thumbnailUrlFor = (photo: EditResultPhoto) => photo.thumbnailUrl;
const downloadUrlFor = (photo: EditResultPhoto) => photo.downloadResolveUrl;
const comparisonFor = (photo: EditResultPhoto) => photo.comparison;
const compareFolderNames = (left: string, right: string) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
const VIDEO_FOLDER = '__videos__';
type EditedOwnMatches = { ids: string[]; status: 'ready' | 'indexing' | 'unavailable'; sourceVersion?: string | null };
type EditedGalleryLinkProps = {
    galleryId: string;
    weddingSlug?: string;
    search: (current: ClientCullingSearch) => ClientCullingSearch;
    children: ReactNode;
    className?: string;
    onClick?: () => void;
    'aria-label'?: string;
    'aria-current'?: 'page' | undefined;
    title?: string;
    resetScroll?: boolean;
};

function EditedGalleryLink({ galleryId, weddingSlug, ...props }: EditedGalleryLinkProps) {
    return weddingSlug
        ? <Link to="/$weddingSlug" params={{ weddingSlug }} {...props} />
        : <Link to="/culling/$galleryId/edited" params={{ galleryId }} {...props} />;
}
const expiryLabel = (expiresAt: string | null) => {
    if (!expiresAt || expiresAt === 'unlimited') return 'Unlimited Access';
    const remainingDays = Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 86_400_000));
    return remainingDays <= 1 ? 'Available for less than 24 hours' : `Available for ${remainingDays} days`;
};
const compactExpiryLabel = (expiresAt: string | null) => {
    if (!expiresAt || expiresAt === 'unlimited') return 'Unlimited';
    const remainingDays = Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 86_400_000));
    return remainingDays <= 1 ? '<24h' : `${remainingDays}d left`;
};
const prefetchPhoto = (photo: EditResultPhoto) => {
    if (photo.mimeType?.toLowerCase().startsWith('video/')) return;
    if (canPrefetchPreview()) void preloadPreviewImage(photo.previewUrl, 'low').catch(() => undefined);
};

function ArchiveDownloadAction({ pending, progress, onDownload }: { pending: boolean; progress?: string; onDownload: () => void }) {
    const label = 'Download All Photos';
    return <><button type="button" disabled={pending} aria-busy={pending} onClick={onDownload} title={pending ? `Preparing ZIP${progress ? ` (${progress})` : ''}` : `${label} as ZIP`} aria-label={pending ? `Preparing ZIP${progress ? `, ${progress}` : ''}` : `${label} as ZIP`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--accent)] p-0 text-xs font-semibold text-[var(--bg-deep)] transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-60 motion-reduce:transition-none sm:w-[210px] sm:gap-2 sm:px-4 sm:py-0 sm:text-[13px]">
            {pending ? <Loader2 size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Download size={17} aria-hidden="true" />}
            <span className="hidden sm:inline">{pending ? 'Preparing download…' : label}</span>
        </button><span role="status" aria-live="polite" className="sr-only">{pending ? 'Preparing ZIP download' : ''}</span></>;
}

export function EditResultsGrid({
    galleryId,
    weddingSlug,
    theme,
    token,
    onToken,
    onExit,
    onToggleTheme,
    standalone = false,
    downloadTarget,
    expiryTarget,
    helpTarget,
    onRequestSelectionAccess,
    selectionCameraCount = 0,
    hasSubmittedPhotos = false,
    selectionUnavailable = false,
    selectionContactUrl,
    deliveryOnly = false,
    editedPath = false,
}: {
    galleryId: string;
    weddingSlug?: string;
    theme: GalleryTheme;
    token: string;
    onToken: (token: string) => void;
    onExit?: () => void;
    onToggleTheme?: () => void;
    standalone?: boolean;
    downloadTarget?: HTMLElement | null;
    expiryTarget?: HTMLElement | null;
    helpTarget?: HTMLElement | null;
    onRequestSelectionAccess?: (filter?: 'none' | 'camera1' | 'camera2' | 'picked' | 'submitted') => void;
    selectionCameraCount?: number;
    hasSubmittedPhotos?: boolean;
    selectionUnavailable?: boolean;
    selectionContactUrl?: string | null;
    deliveryOnly?: boolean;
    editedPath?: boolean;
}) {
    const queryClient = useQueryClient();
    const { folder: requestedFolder, editedPage, view, selfieSource, selfiePage, filter: ownFilter, sensitivity: searchSensitivity } = useSearch({ strict: false }) as ClientCullingSearch;
    const isSelfieView = OWN_PHOTO_SEARCH_ENABLED && view === 'selfie' && (deliveryOnly || editedPath || selfieSource === 'edited');
    const viewPage = (isSelfieView ? selfiePage : editedPage) ?? 1;
    const router = useRouter();
    const navigateEdited = useCallback((search: (current: ClientCullingSearch) => ClientCullingSearch, options: { replace?: boolean; resetScroll?: boolean } = {}) => {
        const destination = weddingSlug
            ? { to: '/$weddingSlug', params: { weddingSlug }, search, ...options }
            : { to: '/culling/$galleryId/edited', params: { galleryId }, search, ...options };
        return router.navigate(destination as never);
    }, [galleryId, router, weddingSlug]);
    useEffect(() => {
        if (!OWN_PHOTO_SEARCH_ENABLED && view === 'selfie') {
            void navigateEdited((current) => ({ ...current, view: undefined, selfieSource: undefined, filter: undefined, sensitivity: undefined, selfiePage: undefined }), { replace: true, resetScroll: false });
        }
    }, [navigateEdited, view]);
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [accessExpiresAt, setAccessExpiresAt] = useState<string | null>(null);
    const [preparingAccess, setPreparingAccess] = useState(false);
    const [accessPreparationUntil, setAccessPreparationUntil] = useState(0);
    const accessSubmittedAt = useRef(0);
    const [navigation, setNavigation] = useState({ galleryId, token, folderId: requestedFolder ?? null, selfie: isSelfieView, page: viewPage, photoId: null as string | null });
    const [pendingDownload, setPendingDownload] = useState<string | null>(null);
    const [downloadError, setDownloadError] = useState('');
    const [folderArchiveTarget, setFolderArchiveTarget] = useState<{ folderId: string; name: string; scope: EditFolderArchiveScope; jobId: string } | null>(null);
    const autoDownloadStartedForJob = useRef<string | null>(null);
    const [pendingPage, setPendingPage] = useState<{ folderId: string | null; selfie: boolean; page: number } | null>(null);
    const ownCategory = ownFilter === 'male' ? 'male' : 'female';
    const ownSensitivity = searchSensitivity ?? 'balanced';
    const [showOwnPhotoChooser, setShowOwnPhotoChooser] = useState(false);
    const [showSelectionInfo, setShowSelectionInfo] = useState(false);
    const selfieResults = useQuery<EditedOwnMatches>({ queryKey: ['public-edited-own-photo', galleryId, token, ownCategory, ownSensitivity], queryFn: () => getEditedOwnPhotos(galleryId, token, ownCategory, ownSensitivity), enabled: Boolean(token) && isSelfieView, staleTime: 60_000, refetchInterval: (query) => query.state.data?.status === 'indexing' ? 10_000 : false });
    const [editedMenuOpen, setEditedMenuOpen] = useState(false);
    const [allMenuOpen, setAllMenuOpen] = useState(false);
    const [guideState, setGuideState] = useState(() => ({ galleryId, open: localStorage.getItem(`orbit:edit-results-guide:${galleryId}`) !== 'seen' }));
    const [clockNow, setClockNow] = useState(() => Date.now());
    const gridRef = useRef<HTMLDivElement>(null);
    const downloadAlertRef = useRef<HTMLDivElement>(null);
    const editedMenuRef = useRef<HTMLDivElement>(null);
    const selectionInfoTriggerRef = useRef<HTMLButtonElement>(null);
    const selectionInfoCloseRef = useRef<HTMLButtonElement>(null);
    const selectionInfoDialogRef = useRef<HTMLElement>(null);
    const videoUrlFor = useCallback((photo: EditResultPhoto) => editResultVideoUrl(galleryId, photo.driveFileId, token), [galleryId, token]);
    useEffect(() => {
        if (downloadError) downloadAlertRef.current?.focus({ preventScroll: true });
    }, [downloadError]);
    useEffect(() => {
        if (!showSelectionInfo) return;
        selectionInfoCloseRef.current?.focus({ preventScroll: true });
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setShowSelectionInfo(false);
                selectionInfoTriggerRef.current?.focus({ preventScroll: true });
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = selectionInfoDialogRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
            if (!focusable?.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', closeOnEscape);
        return () => document.removeEventListener('keydown', closeOnEscape);
    }, [showSelectionInfo]);
    const accessStatus = useQuery({
        queryKey: ['public-edit-results-status', galleryId],
        queryFn: () => getEditResultsStatus(galleryId),
        retry: false,
        staleTime: 60_000,
    });
    const verify = useMutation({
        mutationFn: () => verifyEditResultsPassword(galleryId, password),
        onSuccess: (result) => {
            setError('');
            setPassword('');
            setAccessExpiresAt(result.expiresAt);
            setPreparingAccess(true);
            setAccessPreparationUntil(Math.max(Date.now(), accessSubmittedAt.current + 2000));
            localStorage.setItem(`orbit:edit-results-expiry:${galleryId}`, result.expiresAt || 'unlimited');
            onToken(result.token);
        },
        onError: (cause) => setError(cause instanceof Error ? cause.message : 'Unable to unlock edited photos.'),
    });
    const results = useQuery({
        queryKey: ['public-edit-results', galleryId, token],
        queryFn: () => getEditResults(galleryId, token),
        enabled: Boolean(token),
        retry: false,
        staleTime: 60_000,
        refetchOnWindowFocus: 'always',
    });
    const folderArchiveMutation = useMutation({
        mutationFn: ({ folderId, scope }: { folderId: string; name: string; scope: EditFolderArchiveScope }) => folderId === '__all__' ? startEditGalleryArchive(galleryId, token, scope) : startEditFolderArchive(galleryId, folderId, token, scope),
        onSuccess: (job, target) => setFolderArchiveTarget({ ...target, jobId: job.jobId }),
        onError: (cause) => setDownloadError(cause instanceof Error ? cause.message : 'Unable to prepare this folder download.'),
    });
    const folderArchiveStatus = useQuery({
        queryKey: ['edit-folder-archive', galleryId, token, folderArchiveTarget?.jobId],
        queryFn: ({ signal }) => getEditFolderArchiveJob(galleryId, folderArchiveTarget!.jobId, token, signal),
        enabled: Boolean(folderArchiveTarget?.jobId),
        retry: false,
        refetchInterval: (query) => ['queued', 'running'].includes(query.state.data?.status ?? 'queued') ? 1200 : false,
    });
    useEffect(() => {
        if (!preparingAccess) return;
        if (results.isError) {
            setPreparingAccess(false);
            return;
        }
        if (!results.isSuccess) return;
        const remaining = Math.max(0, accessPreparationUntil - Date.now());
        const timer = window.setTimeout(() => setPreparingAccess(false), remaining);
        return () => window.clearTimeout(timer);
    }, [preparingAccess, results.isError, results.isSuccess, accessPreparationUntil]);
    useEffect(() => {
        const status = (results.error as (Error & { status?: number }) | null)?.status;
        if (status === 401 && token) {
            localStorage.removeItem(`orbit:edit-results-token:${galleryId}`);
            localStorage.removeItem(`orbit:edit-results-expiry:${galleryId}`);
            setAccessExpiresAt(null);
            setPassword('');
            setError('Your Edited Photos session expired. Enter the password again.');
            setNavigation((current) => ({ ...current, photoId: null, page: 1 }));
            onToken('');
            queryClient.removeQueries({ queryKey: ['public-edit-results', galleryId, token], exact: true });
        }
    }, [results.error, token, galleryId, onToken, queryClient]);
    const folders = useMemo(() => deliveryOnly ? results.data?.folders ?? [] : [], [deliveryOnly, results.data?.folders]);
    const videoCount = (results.data?.photos ?? []).filter((photo) => photo.mimeType?.toLowerCase().startsWith('video/')).length;
    const folderId = requestedFolder === VIDEO_FOLDER ? VIDEO_FOLDER : deliveryOnly && requestedFolder && folders.some((folder) => folder.id === requestedFolder) ? requestedFolder : null;
    const isVideoView = folderId === VIDEO_FOLDER && !isSelfieView;
    const currentFolder = folders.find((folder) => folder.id === folderId);
    const childFolders = useMemo(() => deliveryOnly && !isSelfieView && !isVideoView
        ? folders.filter((folder) => folder.parentId === folderId).sort((left, right) => compareFolderNames(left.name, right.name))
        : [], [deliveryOnly, folders, folderId, isSelfieView, isVideoView]);
    const folderBreadcrumbs = useMemo(() => {
        const byId = new Map(folders.map((folder) => [folder.id, folder]));
        const trail: typeof folders = [];
        const seen = new Set<string>();
        let folder = currentFolder;
        while (folder && !seen.has(folder.id)) {
            seen.add(folder.id);
            trail.unshift(folder);
            folder = folder.parentId ? byId.get(folder.parentId) : undefined;
        }
        return trail;
    }, [folders, currentFolder]);
    const folderContents = useMemo(() => {
        const counts = new Map(folders.map((folder) => [folder.id, { photos: 0, folders: 0 }]));
        for (const photo of results.data?.photos ?? []) {
            if (!photo.mimeType?.toLowerCase().startsWith('video/') && photo.folderId) {
                const count = counts.get(photo.folderId);
                if (count) count.photos += 1;
            }
        }
        for (const folder of folders) {
            if (!folder.parentId) continue;
            const count = counts.get(folder.parentId);
            if (count) count.folders += 1;
        }
        return counts;
    }, [folders, results.data?.photos]);
    useEffect(() => {
        setNavigation((current) => current.galleryId === galleryId && current.token === token && current.folderId === folderId && current.page === viewPage && current.selfie === isSelfieView
            ? current
            : { galleryId, token, folderId, selfie: isSelfieView, page: viewPage, photoId: null });
    }, [galleryId, token, folderId, viewPage, isSelfieView]);
    useEffect(() => {
        if (results.isSuccess && requestedFolder && (!folderId || isSelfieView)) {
            void navigateEdited((current) => ({ ...current, folder: undefined }), { replace: true, resetScroll: false });
        }
    }, [results.isSuccess, requestedFolder, folderId, isSelfieView, navigateEdited]);
    const folderPhotos = useMemo(() => (results.data?.photos ?? []).filter((photo) => isVideoView
        ? photo.mimeType?.toLowerCase().startsWith('video/')
        : !photo.mimeType?.toLowerCase().startsWith('video/') && (!deliveryOnly || !folders.length || (photo.folderId ?? null) === folderId)), [results.data?.photos, isVideoView, deliveryOnly, folders.length, folderId]);
    const hasDirectPhotos = (results.data?.photos ?? []).some((photo) => !photo.mimeType || photo.mimeType.startsWith('image/') || /\.(jpe?g|png|webp|heic|avif|gif)$/i.test(photo.filename || ''));
    const accessError = (results.error || verify.error) as (Error & { code?: string }) | null;
    const expiry = results.data?.expiresAt ?? accessExpiresAt ?? (localStorage.getItem(`orbit:edit-results-expiry:${galleryId}`) || null);
    const expiryTime = expiry && expiry !== 'unlimited' ? Date.parse(expiry) : NaN;
    const expiryElapsed = Number.isFinite(expiryTime) && expiryTime <= clockNow;
    const accessExpired = Boolean(accessStatus.data?.isExpired || accessError?.code === 'EDIT_RESULTS_EXPIRED' || expiryElapsed);
    const unavailable = accessStatus.data?.available === false || accessError?.code === 'EDIT_RESULTS_CLOSED' || accessExpired;
    const guideReady = results.isSuccess && !unavailable && Boolean(token);
    const validSelfieResults = selfieResults.data?.status === 'ready' && (!results.data?.sourceVersion || selfieResults.data.sourceVersion === results.data.sourceVersion) ? selfieResults.data : null;
    const matchedPhotos = useMemo(() => {
        const ids = new Set(validSelfieResults?.ids ?? []);
        return (results.data?.photos ?? []).filter((photo) => ids.has(photo.driveFileId));
    }, [results.data?.photos, validSelfieResults]);
    const photos = isSelfieView ? matchedPhotos : folderPhotos;
    const guideOpen = guideReady && (guideState.galleryId === galleryId ? guideState.open : localStorage.getItem(`orbit:edit-results-guide:${galleryId}`) !== 'seen');
    const closeGuide = () => {
        localStorage.setItem(`orbit:edit-results-guide:${galleryId}`, 'seen');
        setGuideState({ galleryId, open: false });
    };
    const expired = (results.error as (Error & { status?: number }) | null)?.status === 401;
    const totalPages = Math.max(1, Math.ceil(photos.length / GALLERY_PAGE_SIZE));
    const sameSession = navigation.galleryId === galleryId && navigation.token === token && navigation.folderId === folderId && navigation.selfie === isSelfieView;
    const urlPage = Math.min(viewPage, totalPages);
    const page = pendingPage?.folderId === folderId && pendingPage.selfie === isSelfieView ? pendingPage.page : urlPage;
    useEffect(() => {
        if (!results.isSuccess || viewPage === urlPage) return;
        void navigateEdited((current) => ({ ...current, ...(isSelfieView ? { selfiePage: urlPage } : { editedPage: urlPage }) }), { replace: true, resetScroll: false });
    }, [results.isSuccess, viewPage, navigateEdited, urlPage, isSelfieView]);
    useEffect(() => {
        if (pendingPage?.folderId === folderId && pendingPage.selfie === isSelfieView && pendingPage.page === viewPage) setPendingPage(null);
    }, [pendingPage, folderId, viewPage, isSelfieView]);
    useEffect(() => setPendingPage(null), [folderId, isSelfieView]);
    const startIndex = (page - 1) * GALLERY_PAGE_SIZE;
    const visiblePhotos = photos.slice(startIndex, startIndex + GALLERY_PAGE_SIZE);
    const photoId = sameSession ? navigation.photoId : null;
    const openPhoto = useCallback((id: string) => {
        const index = photos.findIndex((photo) => photo.driveFileId === id);
        if (index < 0) return;
        const nextPage = Math.floor(index / GALLERY_PAGE_SIZE) + 1;
        setNavigation({ galleryId, token, folderId, selfie: isSelfieView, page: nextPage, photoId: id });
        void navigateEdited((current) => ({ ...current, ...(isSelfieView ? { selfiePage: nextPage } : { editedPage: nextPage }) }), { replace: true, resetScroll: false });
    }, [photos, galleryId, token, folderId, navigateEdited, isSelfieView]);
    const closePhoto = useCallback(() => {
        setNavigation((current) => ({ ...current, photoId: null }));
    }, []);
    const changePage = (nextPage: number) => {
        const clampedPage = Math.max(1, Math.min(nextPage, totalPages));
        setPendingPage({ folderId, selfie: isSelfieView, page: clampedPage });
        setNavigation({ galleryId, token, folderId, selfie: isSelfieView, page: clampedPage, photoId: null });
        void navigateEdited((current) => ({ ...current, ...(isSelfieView ? { selfiePage: clampedPage } : { editedPage: clampedPage }) }), { replace: false, resetScroll: false }).catch(() => setPendingPage(null));
        requestAnimationFrame(() => {
            gridRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
        });
    };
    const startDownload = useCallback(async (resolveUrl: string, key: string) => {
        setDownloadError('');
        setPendingDownload(key);
        try {
            const resolved = await resolveEditResultDownload(resolveUrl);
            // Navigate only after the token and snapshot have been validated, so a
            // failed download never leaves the gallery or opens a blank tab.
            window.location.assign(resolved.downloadUrl);
        } catch (cause) {
            setDownloadError(cause instanceof Error ? cause.message : 'Unable to start this download. Check access and retry.');
        } finally {
            setPendingDownload(null);
        }
    }, []);
    const downloadFolder = useCallback((targetFolderId: string, name: string, scope: EditFolderArchiveScope = 'direct') => {
        const activeJob = folderArchiveTarget?.folderId === targetFolderId && folderArchiveTarget.scope === scope ? folderArchiveStatus.data : null;
        const pendingKey = `folder-archive:${scope}:${targetFolderId}`;
        if (activeJob?.status === 'completed' && activeJob.downloadUrl) {
            setPendingDownload(pendingKey);
            void folderArchiveStatus.refetch().then(({ data }) => {
                if (data?.status === 'completed' && data.downloadUrl) window.location.assign(data.downloadUrl);
                else setDownloadError('The folder ZIP link expired. Prepare the download again.');
            }).catch((cause) => setDownloadError(cause instanceof Error ? cause.message : 'Unable to start this folder download.'))
                .finally(() => setPendingDownload(null));
            return;
        }
        if (activeJob && ['queued', 'running'].includes(activeJob.status)) return;
        setDownloadError('');
        setFolderArchiveTarget(null);
        folderArchiveMutation.mutate({ folderId: targetFolderId, name, scope });
    }, [folderArchiveMutation, folderArchiveStatus, folderArchiveTarget]);
    useEffect(() => {
        const target = folderArchiveTarget;
        if (!target?.jobId || folderArchiveStatus.data?.status !== 'completed' || !folderArchiveStatus.data.downloadUrl || pendingDownload) return;
        if (autoDownloadStartedForJob.current === target.jobId) return;
        autoDownloadStartedForJob.current = target.jobId;
        downloadFolder(target.folderId, target.name, target.scope);
    }, [folderArchiveTarget, folderArchiveStatus.data, pendingDownload, downloadFolder]);
    useEffect(() => {
        if (!folderArchiveStatus.data || folderArchiveStatus.data.status !== 'failed') return;
        setDownloadError(folderArchiveStatus.data.error || 'Could not prepare this ZIP. Please try again.');
        setFolderArchiveTarget(null);
    }, [folderArchiveStatus.data]);
    useEffect(() => {
        if (!folderArchiveTarget || !folderArchiveStatus.isError) return;
        setDownloadError('Unable to check the folder ZIP. Please try again.');
        setFolderArchiveTarget(null);
    }, [folderArchiveTarget, folderArchiveStatus.isError]);
    useEffect(() => {
        if (!token || unavailable) {
            setFolderArchiveTarget(null);
            folderArchiveMutation.reset();
        }
    }, [token, unavailable]);
    const archiveJobInProgress = folderArchiveMutation.isPending || ['queued', 'running'].includes(folderArchiveStatus.data?.status ?? '');
    const headerFolderId = '__all__';
    const headerScope: EditFolderArchiveScope = 'subtree';
    const headerArchiveTarget = folderArchiveTarget?.folderId === headerFolderId && folderArchiveTarget.scope === headerScope;
    const headerArchiveStarting = folderArchiveMutation.isPending && folderArchiveMutation.variables?.folderId === headerFolderId && folderArchiveMutation.variables?.scope === headerScope;
    const headerArchivePending = headerArchiveStarting || Boolean(headerArchiveTarget && archiveJobInProgress) || pendingDownload === `folder-archive:${headerScope}:${headerFolderId}`;
    const archiveAction = !isVideoView && !unavailable && token && results.isSuccess && hasDirectPhotos ? (
        <ArchiveDownloadAction key={`${galleryId}:${token}`} pending={headerArchivePending || archiveJobInProgress} progress={headerArchiveTarget && folderArchiveStatus.data?.total ? `${folderArchiveStatus.data.processed ?? 0}/${folderArchiveStatus.data.total}` : undefined} onDownload={() => downloadFolder('__all__', 'Edited Photos', 'subtree')} />
    ) : null;
    const accessLabel = accessExpired ? 'Access expired' : unavailable ? 'Access unavailable' : token && results.isSuccess ? expiryLabel(expiry) : null;
    const showGalleryToolbar = Boolean(token && !unavailable && results.isSuccess && !expired);
    const expiryAction = accessLabel ? <span className="inline-flex h-8 max-w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-2.5 text-[11px] font-semibold leading-none tabular-nums text-[var(--text-secondary)] sm:h-9 sm:text-xs" title={accessLabel} aria-live="polite"><Clock3 size={14} aria-hidden="true" className="shrink-0" /><span className="sm:hidden">{accessExpired ? 'Expired' : unavailable ? 'Unavailable' : compactExpiryLabel(expiry)}</span><span className="hidden sm:inline">{accessLabel}</span></span> : null;
    const deliveryActions = archiveAction;
    const helpAction = guideReady ? <button type="button" onClick={() => setGuideState({ galleryId, open: true })} title="Edited Photos guide" aria-label="Edited Photos guide" className="flex h-11 w-11 shrink-0 items-center justify-center text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><HelpCircle size={16} aria-hidden="true" /></button> : null;
    const guide = guideReady && <EditedPhotosGuide open={guideOpen} onClose={closeGuide} theme={theme} hasFolders={deliveryOnly && folders.length > 0} hasArchive={hasDirectPhotos} />;
    const changeView = (next: GalleryView) => {
        closePhoto();
        if (next === 'gallery') {
            if (selectionUnavailable) { setShowSelectionInfo(true); return; }
            onRequestSelectionAccess?.();
            return;
        }
        if (next !== 'edit-results' && next !== 'selfie') return;
        void navigateEdited((current) => ({ ...current, view: next === 'selfie' ? 'selfie' : undefined, selfieSource: undefined }), { resetScroll: false });
    };

    const content = unavailable ? (
        <section role="status" className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-5 py-10 text-center">
            <Lock size={24} aria-hidden="true" />
            <h2 className="font-display text-2xl">{accessExpired ? 'Edited Photos access expired' : 'Edited Photos unavailable'}</h2>
            <p className="text-sm text-[var(--text-muted)]">{accessExpired ? 'Please contact the photographer to reopen access.' : 'Access is not open. Please contact the photographer.'}</p>
            <button type="button" onClick={() => { verify.reset(); void accessStatus.refetch(); if (token) void results.refetch(); }} className="inline-flex h-11 items-center gap-2 rounded-md border border-[var(--border)] px-4 text-sm hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><RotateCcw size={15} aria-hidden="true" /> Check again</button>
        </section>
    ) : !token || expired ? (
        <section className="mx-auto flex min-h-full w-full flex-col items-center justify-center px-4 py-8 text-center sm:px-5 sm:py-12">
            <div data-testid="edited-access-card" className="w-full max-w-sm border border-[var(--border)] bg-[var(--bg-card)] px-5 py-7 shadow-2xl sm:px-8 sm:py-9">
                <div className="mb-7 flex justify-center"><OrbitLogo theme={theme} /></div>
                <div className="mb-3 flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]"><Images size={14} aria-hidden="true" /><span>Edited Gallery</span></div>
                <h1 className="font-display text-[26px] font-medium leading-tight text-[var(--text-primary)] [text-wrap:balance]">View Your Edited Photos</h1>
                <p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-[var(--text-muted)]">Enter your password to view and download your finished gallery.</p>
            <form aria-busy={verify.isPending} className="mt-7 flex w-full flex-col" onSubmit={(event) => { event.preventDefault(); if (verify.isPending) return; if (!password.trim()) { setError('Enter your password.'); return; } setError(''); accessSubmittedAt.current = Date.now(); verify.mutate(); }}>
                <GalleryPasswordField label="Edited photos password" name="editedPhotosPassword" value={password} onChange={(value) => { setPassword(value); if (error) setError(''); }} error={error} />
                <button disabled={verify.isPending} aria-live="polite" className="mt-3 inline-flex h-12 items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 text-xs font-bold text-[var(--bg-deep)] transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-45">
                    {verify.isPending ? <Loader2 size={15} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Lock size={15} aria-hidden="true" />} {verify.isPending ? 'Checking password…' : 'Unlock Edited Photos'}
                </button>
            </form>
            {onRequestSelectionAccess && <button type="button" onClick={() => onRequestSelectionAccess()} className="mt-3 inline-flex min-h-11 items-center justify-center text-xs font-semibold text-[var(--text-secondary)] underline underline-offset-4 hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">Use Photo Selection password</button>}
            {onExit && <button type="button" onClick={onExit} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md px-4 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><ArrowLeft size={14} aria-hidden="true" /> Back to gallery</button>}
            </div>
        </section>
    ) : results.isPending ? (
        <div role="status" className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading edited photos…</div>
    ) : results.isError ? (
        <div role="alert" className="mx-auto flex min-h-[45dvh] max-w-md flex-col items-center justify-center px-5 text-center">
            <AlertCircle size={24} className="mb-4 text-rose-400" />
            <p className="text-sm text-[var(--text-primary)]">{results.error instanceof Error ? results.error.message : 'Unable to load edited photos.'}</p>
            <button type="button" onClick={() => void results.refetch()} className="mt-4 inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] px-4 text-xs font-semibold"><RotateCcw size={14} /> Retry</button>
        </div>
    ) : (
        <div className={clsx('mx-auto max-w-[1664px]', standalone && 'px-2.5 pb-10 pt-3 sm:px-8 sm:pt-5 sm:pb-12 md:pt-6')}>
            {downloadError && <div ref={downloadAlertRef} role="alert" tabIndex={-1} className="fixed inset-x-3 bottom-3 z-[140] mx-auto flex max-w-lg items-start gap-3 rounded-md border border-rose-500/40 bg-[var(--bg-card)] px-4 py-3 text-sm text-rose-400 shadow-2xl outline-none focus-visible:ring-2 focus-visible:ring-rose-400 sm:bottom-5">
                <AlertCircle size={17} aria-hidden="true" className="mt-0.5 shrink-0" /><span className="min-w-0 flex-1">{downloadError}</span><button type="button" onClick={() => setDownloadError('')} aria-label="Dismiss download error" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><X size={15} aria-hidden="true" /></button>
            </div>}
            {isSelfieView && <button type="button" onClick={() => setShowOwnPhotoChooser(true)} className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--border)] px-3 text-sm text-[var(--text-secondary)]"><ScanFace size={16} aria-hidden="true" />{ownCategory === 'female' ? 'Foto Cewe' : 'Foto Cowo'} · {ownSensitivity === 'strict' ? 'Ketat' : ownSensitivity === 'balanced' ? 'Normal' : 'Luas'}</button>}
            {folderArchiveTarget && ['queued', 'running'].includes(folderArchiveStatus.data?.status ?? 'queued') && <p role="status" aria-live="polite" className="mb-3 text-xs text-[var(--text-secondary)]">{folderArchiveStatus.data?.status === 'running' ? 'Preparing' : 'Queued'} {folderArchiveTarget.name} ZIP{folderArchiveStatus.data?.status === 'running' && folderArchiveStatus.data.total ? ` (${folderArchiveStatus.data.processed ?? 0}/${folderArchiveStatus.data.total})` : '…'}</p>}
            {folderArchiveTarget && folderArchiveStatus.data?.status === 'completed' && folderArchiveStatus.data.downloadUrl && <p role="status" aria-live="polite" className="sr-only">{folderArchiveTarget.name} ZIP is ready. Download starting.</p>}
            {deliveryOnly && currentFolder && !isSelfieView && !isVideoView && <nav aria-label="Folder path" className="mb-4 flex min-w-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap text-xs text-[var(--text-secondary)] sm:text-sm">
                <EditedGalleryLink galleryId={galleryId} weddingSlug={weddingSlug} search={(current) => ({ ...current, folder: undefined, editedPage: 1 })} resetScroll onClick={closePhoto} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><FolderOpen size={15} aria-hidden="true" />Edited Photos</EditedGalleryLink>
                {folderBreadcrumbs.map((folder, index) => <span key={folder.id} className="inline-flex min-w-0 items-center gap-1.5"><ChevronRight size={13} aria-hidden="true" className="shrink-0" />{index === folderBreadcrumbs.length - 1 ? <span aria-current="page" className="max-w-48 truncate font-semibold text-[var(--text-primary)]">{folder.name}</span> : <EditedGalleryLink galleryId={galleryId} weddingSlug={weddingSlug} search={(current) => ({ ...current, folder: folder.id, editedPage: 1 })} resetScroll onClick={closePhoto} className="inline-flex min-h-11 max-w-40 items-center truncate rounded-md px-1 hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">{folder.name}</EditedGalleryLink>}</span>)}
            </nav>}
            {deliveryOnly && !isSelfieView && !isVideoView && childFolders.length > 0 && <section aria-label="Photo folders" className={photos.length ? 'mb-5' : undefined}>
                <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)] sm:text-sm"><Folder size={15} aria-hidden="true" />Folders</h2>
                <div data-testid="edited-folder-tiles" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {childFolders.map((folder) => {
                        const count = folderContents.get(folder.id) ?? { photos: 0, folders: 0 };
                        const details = [count.photos ? `${count.photos} ${count.photos === 1 ? 'photo' : 'photos'}` : null, count.folders ? `${count.folders} ${count.folders === 1 ? 'folder' : 'folders'}` : null].filter(Boolean).join(' · ') || 'Empty folder';
                        const archivePending = archiveJobInProgress && folderArchiveTarget?.folderId === folder.id;
                        return <div key={folder.id} className="flex min-w-0 items-center rounded-md border border-[var(--border)] bg-[var(--bg-card)]">
                            <EditedGalleryLink galleryId={galleryId} weddingSlug={weddingSlug} search={(current) => ({ ...current, folder: folder.id, editedPage: 1 })} resetScroll onClick={closePhoto} aria-label={`Open ${folder.name}, ${details}`} title={folder.name} className="group flex min-h-14 min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-left hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><Folder size={17} aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]" /><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{folder.name}</span><span className="block text-[11px] text-[var(--text-muted)]">{details}</span></span><ChevronRight size={16} aria-hidden="true" className="shrink-0 text-[var(--text-muted)]" /></EditedGalleryLink>
                            <button type="button" disabled={archiveJobInProgress || (!count.photos && !count.folders)} onClick={() => downloadFolder(folder.id, folder.name, 'subtree')} aria-label={archivePending ? `Preparing ${folder.name} ZIP` : `Download ${folder.name} as ZIP`} title={archivePending ? `Preparing ${folder.name} ZIP` : `Download ${folder.name} as ZIP`} className="mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-40">{archivePending ? <Loader2 size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Download size={16} aria-hidden="true" />}</button>
                        </div>;
                    })}
                </div>
            </section>}
            {deliveryOnly && !isSelfieView && !isVideoView && photos.length > 0 && (childFolders.length > 0 || currentFolder) && <h2 className="mb-3 border-t border-[var(--border)] pt-3 text-xs font-semibold text-[var(--text-secondary)] sm:text-sm">Photos</h2>}
            {photos.length ? <div ref={gridRef} data-testid="edited-gallery-grid" className="grid scroll-mt-36 grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2 md:grid-cols-4 md:gap-3 xl:grid-cols-5 2xl:grid-cols-6">
                {visiblePhotos.map((photo, index) => <PhotoTile
                    key={photo.driveFileId}
                    photo={photo}
                    galleryId={galleryId}
                    token={token}
                    mode="delivery"
                    thumbnailUrl={photo.thumbnailUrl}
                    downloadUrl={photo.downloadResolveUrl}
                    displayIndex={startIndex + index}
                    thumbnailPriority={index === 0}
                    thumbnailEager={index < 10}
                    downloadPending={pendingDownload === photo.driveFileId}
                    onOpen={openPhoto}
                    onPrefetch={prefetchPhoto}
                    onDownload={(item) => void startDownload(item.downloadResolveUrl, item.driveFileId)}
                />)}
            </div> : (isSelfieView || isVideoView || !childFolders.length) && <div role="status" className="py-20 text-center font-sans text-[15px] font-medium leading-6 text-[var(--text-secondary)] sm:text-base">{isSelfieView ? selfieResults.isPending || selfieResults.data?.status === 'indexing' ? 'Menyiapkan Foto Sendiri…' : selfieResults.isError ? 'Gagal memuat Foto Sendiri. Coba buka kembali.' : selfieResults.data?.status === 'unavailable' ? 'Foto Sendiri belum siap. Tim Orbit perlu menandai wajah Cewe dan Cowo.' : 'Belum ada foto yang cocok.' : isVideoView ? 'Belum ada video tersinkron. Minta Tim Orbit menjalankan Sync Edited Photos.' : currentFolder ? 'This folder is empty.' : 'No edited photos are available.'}</div>}
            {totalPages > 1 && <nav className="mt-6 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4 sm:justify-center sm:gap-6" aria-label="Edited photos pages">
                <button type="button" aria-label="Previous page" title="Previous page" disabled={page === 1} onClick={() => changePage(page - 1)} className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-35"><ChevronLeft size={18} /></button>
                <span role="status" aria-live="polite" className="text-xs tabular-nums text-[var(--text-secondary)]">Page {page} of {totalPages}</span>
                <button type="button" aria-label="Next page" title="Next page" disabled={page === totalPages} onClick={() => changePage(page + 1)} className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-35"><ChevronRight size={18} /></button>
            </nav>}
            <Lightbox
                galleryId={galleryId}
                token={token}
                photos={photos}
                currentPhotoId={photoId}
                displayStartIndex={0}
                mode="delivery"
                getPreviewUrl={previewUrlFor}
                getVideoUrl={videoUrlFor}
                getThumbnailUrl={thumbnailUrlFor}
                getDownloadUrl={downloadUrlFor}
                getComparison={comparisonFor}
                onClose={closePhoto}
                onMove={openPhoto}
                onDownload={(item) => void startDownload(item.downloadResolveUrl, item.driveFileId)}
                downloadPending={Boolean(photoId && pendingDownload === photoId)}
            />
        </div>
    );

    if (preparingAccess && !results.isError) return <GalleryPreparingScreen title={accessStatus.data?.title} theme={theme} onToggleTheme={onToggleTheme} />;
    const ownChooser = OWN_PHOTO_SEARCH_ENABLED && showOwnPhotoChooser && <OwnPhotoChooser category={isSelfieView ? ownCategory : null} sensitivity={ownSensitivity} onApply={(category, sensitivity) => { setShowOwnPhotoChooser(false); void navigateEdited((current) => ({ ...current, view: 'selfie', selfieSource: undefined, filter: category, sensitivity, folder: undefined, selfiePage: 1 }), { resetScroll: false }); }} onClear={() => { setShowOwnPhotoChooser(false); void navigateEdited((current) => ({ ...current, view: undefined, selfieSource: undefined, filter: undefined, sensitivity: undefined, folder: undefined, editedPage: 1 }), { resetScroll: false }); }} onClose={() => setShowOwnPhotoChooser(false)} />;
    if (!standalone) return <>{downloadTarget && createPortal(archiveAction, downloadTarget)}{expiryTarget && createPortal(expiryAction, expiryTarget)}{helpTarget && createPortal(helpAction, helpTarget)}{content}{guide}{ownChooser}</>;
    return <main style={theme === 'black' ? BLACK_THEME : WHITE_THEME} className="flex min-h-screen flex-col bg-[var(--bg-deep)] font-sans text-[var(--text-primary)]">
        <a href="#edited-gallery-content" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[160] focus:rounded-md focus:bg-[var(--accent)] focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-[var(--bg-deep)]">Skip to edited photos</a>
        <GalleryHeader section={isVideoView ? "Edited Videos" : "Edited Photos"} title={accessStatus.data?.title} theme={theme} utilities={<>
            <div className="flex min-w-0 justify-end lg:pr-2">{expiryAction}</div>
            <div>{helpAction}</div>
            {onToggleTheme && <ThemeToggle theme={theme} onToggle={onToggleTheme} />}
        </>} />
        {showGalleryToolbar && <div data-testid="gallery-toolbar" className="sticky top-20 z-30 border-b border-[var(--border)] bg-[var(--bg-deep)] px-2.5 py-2 [touch-action:manipulation] sm:px-8 sm:py-2.5 lg:top-16">
            <div className="mx-auto flex max-w-[1600px] min-w-0 items-center gap-1 sm:gap-x-2">
                <div ref={editedMenuRef} className="relative flex min-w-0 flex-1 items-center">
                    <div className={clsx('min-w-0 flex-1 items-center gap-1 pb-1 sm:flex sm:gap-2', deliveryOnly ? OWN_PHOTO_SEARCH_ENABLED ? 'grid grid-cols-[repeat(2,minmax(0,116px))]' : 'grid grid-cols-[minmax(0,116px)]' : 'flex overflow-x-auto whitespace-nowrap sm:overflow-x-auto')}>
                        <div className={clsx('sm:w-auto', deliveryOnly ? 'min-w-0' : 'w-max shrink-0')}><GalleryViewTabs value="edit-results" editedLabel={isVideoView ? "Edited Videos" : "Edited Photos"} deliveryOnly={deliveryOnly} galleryAvailable={Boolean(onRequestSelectionAccess)} galleryUnavailableAction={selectionUnavailable} editedAvailable={!unavailable} editedExpired={accessExpired} selfieAvailable={false} allPhotosMenuOpen={allMenuOpen} editedMenuOpen={editedMenuOpen} allPhotosButtonRef={selectionInfoTriggerRef} onAllPhotos={() => { if (selectionUnavailable) { setShowSelectionInfo(true); return; } setEditedMenuOpen(false); setAllMenuOpen((open) => !open); }} onChange={(next) => next === 'edit-results' ? (setAllMenuOpen(false), setEditedMenuOpen((open) => !open)) : changeView(next)} />
                        </div>
                        {OWN_PHOTO_SEARCH_ENABLED && <button type="button" aria-label="Foto Sendiri" aria-pressed={isSelfieView} onClick={() => setShowOwnPhotoChooser(true)} className={clsx('inline-flex min-h-11 items-center gap-1 rounded-md border text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] sm:shrink-0 sm:px-3 sm:text-sm', deliveryOnly ? 'min-w-0 justify-center px-1.5' : 'shrink-0 px-2.5', isSelfieView ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]' : 'border-[var(--border)] text-[var(--text-secondary)]')}><ScanFace size={16} aria-hidden="true" className="shrink-0" /><span className="truncate sm:hidden">Sendiri</span><span className="hidden sm:inline">Foto Sendiri</span></button>}
                    </div>
                        {allMenuOpen && <div role="menu" aria-label="Photo filters" className="absolute left-0 top-[calc(100%+8px)] z-50 w-[min(224px,calc(100vw-16px))] origin-top-left rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-1.5 shadow-xl">
                            {([['none', 'Photos', ImageIcon], ...(['camera1', 'camera2'] as const).slice(0, selectionCameraCount).map((mode) => [mode, mode === 'camera1' ? 'Kamera 1' : 'Kamera 2', Camera]), ['picked', 'Picked', CheckSquare], ...(hasSubmittedPhotos ? [['submitted', 'Submitted', Send]] : [])] as Array<['none' | 'camera1' | 'camera2' | 'picked' | 'submitted', string, typeof ImageIcon]>).map(([filter, label, Icon]) => <button key={filter} type="button" role="menuitem" onClick={() => { setAllMenuOpen(false); onRequestSelectionAccess?.(filter); }} className="flex min-h-11 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-card)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><Icon size={15} aria-hidden="true" />{label}</button>)}
                        </div>}
                        {editedMenuOpen && <div role="group" aria-label="Edited Photos" className={clsx('absolute top-[calc(100%+8px)] z-50 w-[min(224px,calc(100vw-16px))] origin-top-left rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] p-1.5 shadow-xl', deliveryOnly ? 'left-0' : 'left-[90px] sm:left-36')}>
                            <EditedGalleryLink galleryId={galleryId} weddingSlug={weddingSlug} search={(current) => ({ ...current, view: undefined, selfieSource: undefined, filter: undefined, sensitivity: undefined, folder: undefined, editedPage: 1 })} onClick={() => { closePhoto(); setEditedMenuOpen(false); }} aria-current={!isSelfieView && !isVideoView ? 'page' : undefined} className={clsx('flex min-h-11 items-center gap-2 rounded-md px-2.5 text-[13px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]', !isSelfieView && !isVideoView ? 'bg-[var(--accent)] text-[var(--bg-deep)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card)]')}><Images size={15} aria-hidden="true" /><span className="flex-1">Photos</span>{!isSelfieView && !isVideoView && <Check size={14} aria-hidden="true" />}</EditedGalleryLink>
                            <EditedGalleryLink galleryId={galleryId} weddingSlug={weddingSlug} search={(current) => ({ ...current, view: undefined, selfieSource: undefined, filter: undefined, sensitivity: undefined, folder: VIDEO_FOLDER, editedPage: 1 })} onClick={() => { closePhoto(); setEditedMenuOpen(false); }} aria-current={isVideoView ? 'page' : undefined} className={clsx('flex min-h-11 items-center gap-2 rounded-md px-2.5 text-[13px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]', isVideoView ? 'bg-[var(--accent)] text-[var(--bg-deep)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-card)]')}><Video size={15} aria-hidden="true" /><span className="flex-1">Videos</span>{isVideoView ? <Check size={14} aria-hidden="true" /> : videoCount > 0 ? <span className="text-xs tabular-nums">{videoCount}</span> : null}</EditedGalleryLink>
                        </div>}
                    </div>
                {deliveryActions && <div className="ml-auto shrink-0">{deliveryActions}</div>}
            </div>
        </div>}
        <div id="edited-gallery-content" tabIndex={-1} className="flex-1 scroll-mt-44 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] lg:scroll-mt-36">{content}</div>
        <GalleryFooter />
        {guide}
        {ownChooser}
        {showSelectionInfo && <div className="fixed inset-0 z-[150] flex items-center justify-center overscroll-contain bg-black/60 p-4 [touch-action:manipulation]" onMouseDown={(event) => { if (event.target === event.currentTarget) { setShowSelectionInfo(false); selectionInfoTriggerRef.current?.focus({ preventScroll: true }); } }}>
            <section ref={selectionInfoDialogRef} role="dialog" aria-modal="true" aria-labelledby="selection-access-title" aria-describedby="selection-access-description" className="relative w-full max-w-[420px] border border-[var(--border)] bg-[var(--bg-deep)] p-5 text-[var(--text-primary)] shadow-2xl sm:p-7">
                <button ref={selectionInfoCloseRef} type="button" onClick={() => { setShowSelectionInfo(false); selectionInfoTriggerRef.current?.focus({ preventScroll: true }); }} aria-label="Close" className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><X size={18} aria-hidden="true" /></button>
                <div className="mb-6 flex items-center gap-3 pr-10">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)]"><Lock size={17} aria-hidden="true" /></span>
                    <p className="text-[11px] font-semibold uppercase leading-4 tracking-[0.12em] text-[var(--text-muted)]">Gallery Access</p>
                </div>
                <h2 id="selection-access-title" className="text-xl font-semibold leading-tight text-[var(--text-primary)] [text-wrap:balance]">Photo Selection is closed</h2>
                <p id="selection-access-description" className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">Your Edited Photos gallery is still available.</p>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <button type="button" onClick={() => { setShowSelectionInfo(false); selectionInfoTriggerRef.current?.focus({ preventScroll: true }); }} className="min-h-11 whitespace-nowrap rounded-md px-3 text-sm font-semibold text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">Continue browsing</button>
                    {selectionContactUrl && <a href={selectionContactUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 whitespace-nowrap items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--bg-deep)] transition-opacity hover:opacity-90 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"><MessageCircle size={16} aria-hidden="true" />Message Team Orbit</a>}
                </div>
            </section>
        </div>}
    </main>;
}
