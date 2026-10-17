import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { AlertCircle, ArrowLeft, Check, ChevronLeft, ChevronRight, ChevronUp, Clock3, Download, Folder, FolderOpen, HelpCircle, Loader2, Lock, MessageCircle, RotateCcw, ScanFace, X } from 'lucide-react';
import clsx from 'clsx';

import { editResultVideoUrl, getEditFolderArchiveJob, getEditResults, getEditResultsStatus, resolveEditResultDownload, startEditFolderArchive, startEditGalleryArchive, verifyEditResultsPassword, type EditFolderArchiveScope } from '../culling.public';
import type { EditResultPhoto } from '../culling.types';
import { BLACK_THEME, GALLERY_PAGE_SIZE, WHITE_THEME } from './constants';
import { GalleryHeaderIdentity, GalleryViewTabs, OrbitLogo, ThemeToggle, type GalleryView } from './GalleryChrome';
import { GalleryFooter } from './GalleryFooter';
import { GalleryPreparingScreen } from './AccessScreens';
import { PhotoTile } from './PhotoTile';
import { Lightbox } from './Lightbox';
import { GalleryPasswordField } from './GalleryPasswordField';
import { EditedPhotosGuide } from './EditedPhotosGuide';
import { FaceSearchModal } from './FaceSearchModal';
import { getFaceSearchStatus } from './face-search';
import { canPrefetchPreview, preloadPreviewImage } from './preview-cache';
import type { GalleryTheme } from './types';

const previewUrlFor = (photo: EditResultPhoto) => photo.previewUrl;
const thumbnailUrlFor = (photo: EditResultPhoto) => photo.thumbnailUrl;
const downloadUrlFor = (photo: EditResultPhoto) => photo.downloadResolveUrl;
const comparisonFor = (photo: EditResultPhoto) => photo.comparison;
const compareFolderPaths = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
type EditedSelfieMatches = { ids: string[]; total: number; sourceVersion?: string | null };
const expiryLabel = (expiresAt: string | null) => {
    if (!expiresAt || expiresAt === 'unlimited') return 'Unlimited access';
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

function ArchiveDownloadAction({ folder, pending, progress, onDownload }: { folder: boolean; pending: boolean; progress?: string; onDownload: () => void }) {
    const label = folder ? 'Download Folder Photos' : 'Download All Photos';
    return <><button type="button" disabled={pending} aria-busy={pending} onClick={onDownload} title={pending ? `Preparing ZIP${progress ? ` (${progress})` : ''}` : `${label} as ZIP`} aria-label={pending ? `Preparing ZIP${progress ? `, ${progress}` : ''}` : label} className="inline-flex h-11 w-36 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--accent)] px-2 text-xs font-semibold text-[var(--bg-deep)] transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-60 motion-reduce:transition-none min-[390px]:w-40 sm:w-[210px] sm:gap-2 sm:px-4 sm:text-[13px]">
            {pending ? <Loader2 size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Download size={13} aria-hidden="true" />}
            {pending ? <><span className="sm:hidden">Preparing…</span><span className="hidden sm:inline">Preparing download…</span></> : folder ? <><span className="sm:hidden">Folder Photos</span><span className="hidden sm:inline">{label}</span></> : <span>{label}</span>}
        </button><span role="status" aria-live="polite" className="sr-only">{pending ? 'Preparing ZIP download' : ''}</span></>;
}

function FolderArchiveButton({ name, busy, ready, disabled, progress, onClick }: { name: string; busy: boolean; ready: boolean; disabled?: boolean; progress?: string; onClick: () => void }) {
    const label = ready ? `Download ${name} ZIP` : busy ? `Preparing ${name} ZIP${progress ? `, ${progress}` : ''}` : `Download ${name} folder as ZIP`;
    return <button type="button" aria-label={label} title={label} disabled={disabled || busy} onClick={onClick} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-wait disabled:opacity-65 motion-reduce:transition-none sm:h-11 sm:w-11">
        {busy ? <Loader2 size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Download size={16} aria-hidden="true" />}
    </button>;
}

export function EditResultsGrid({
    galleryId,
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
    selectionUnavailable = false,
    selectionContactUrl,
    deliveryOnly = false,
    editedPath = false,
}: {
    galleryId: string;
    theme: GalleryTheme;
    token: string;
    onToken: (token: string) => void;
    onExit?: () => void;
    onToggleTheme?: () => void;
    standalone?: boolean;
    downloadTarget?: HTMLElement | null;
    expiryTarget?: HTMLElement | null;
    helpTarget?: HTMLElement | null;
    onRequestSelectionAccess?: () => void;
    selectionUnavailable?: boolean;
    selectionContactUrl?: string | null;
    deliveryOnly?: boolean;
    editedPath?: boolean;
}) {
    const queryClient = useQueryClient();
    const { folder: requestedFolder, editedPage, view, selfieSource, selfiePage } = useSearch({ from: '/culling/$galleryId' });
    const isSelfieView = view === 'selfie' && (deliveryOnly || editedPath || selfieSource === 'edited');
    const viewPage = (isSelfieView ? selfiePage : editedPage) ?? 1;
    const navigate = useNavigate({ from: '/culling/$galleryId' });
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
    const [showFaceSearch, setShowFaceSearch] = useState(false);
    const [showSelectionInfo, setShowSelectionInfo] = useState(false);
    const selfieQueryKey = ['public-edited-selfie-results', galleryId, token];
    const selfieResults = useQuery<EditedSelfieMatches | null>({ queryKey: selfieQueryKey, queryFn: async () => null, enabled: false, staleTime: Infinity });
    const [folderPickerOpen, setFolderPickerOpen] = useState(false);
    const [guideState, setGuideState] = useState(() => ({ galleryId, open: localStorage.getItem(`orbit:edit-results-guide:${galleryId}`) !== 'seen' }));
    const [clockNow, setClockNow] = useState(() => Date.now());
    const gridRef = useRef<HTMLDivElement>(null);
    const downloadAlertRef = useRef<HTMLDivElement>(null);
    const folderPickerRef = useRef<HTMLDivElement>(null);
    const folderTriggerRef = useRef<HTMLButtonElement>(null);
    const selectionInfoTriggerRef = useRef<HTMLButtonElement>(null);
    const selectionInfoCloseRef = useRef<HTMLButtonElement>(null);
    const selectionInfoDialogRef = useRef<HTMLElement>(null);
    const folderPickerId = useId();
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
    const folders = useMemo(() => results.data?.folders ?? [], [results.data?.folders]);
    const folderId = requestedFolder && folders.some((folder) => folder.id === requestedFolder) ? requestedFolder : null;
    useEffect(() => {
        setNavigation((current) => current.galleryId === galleryId && current.token === token && current.folderId === folderId && current.page === viewPage && current.selfie === isSelfieView
            ? current
            : { galleryId, token, folderId, selfie: isSelfieView, page: viewPage, photoId: null });
    }, [galleryId, token, folderId, viewPage, isSelfieView]);
    const childFolders = useMemo(() => folders.filter((folder) => folder.parentId === folderId).sort((a, b) => compareFolderPaths(a.name, b.name)), [folders, folderId]);
    const childFoldersLabel = childFolders.length === 1 ? childFolders[0]!.name : 'Folders';
    const currentFolder = folders.find((folder) => folder.id === folderId);
    const folderPhotoCounts = useMemo(() => {
        const counts = new Map<string, number>();
        const byId = new Map(folders.map((folder) => [folder.id, folder]));
        for (const photo of results.data?.photos ?? []) {
            if (!photo.mimeType?.startsWith('image/')) continue;
            let current = photo.folderId ? byId.get(photo.folderId) : undefined;
            const seen = new Set<string>();
            while (current && !seen.has(current.id)) {
                seen.add(current.id);
                counts.set(current.id, (counts.get(current.id) ?? 0) + 1);
                current = current.parentId ? byId.get(current.parentId) : undefined;
            }
        }
        return counts;
    }, [folders, results.data?.photos]);
    const folderOptions = useMemo(() => {
        const byId = new Map(folders.map((folder) => [folder.id, folder]));
        return folders.map((folder) => {
            const names = [folder.name];
            const seen = new Set([folder.id]);
            let parentId = folder.parentId;
            while (parentId && !seen.has(parentId)) {
                seen.add(parentId);
                const parent = byId.get(parentId);
                if (!parent) break;
                names.unshift(parent.name);
                parentId = parent.parentId;
            }
            return { id: folder.id, name: folder.name, path: names.join(' / '), parentPath: names.slice(0, -1).join(' / ') };
        }).sort((a, b) => compareFolderPaths(a.path, b.path));
    }, [folders]);
    const folderBreadcrumbs = useMemo(() => {
        const byId = new Map(folders.map((folder) => [folder.id, folder]));
        const trail = [];
        const seen = new Set<string>();
        let folder = currentFolder;
        while (folder && !seen.has(folder.id)) {
            seen.add(folder.id);
            trail.push(folder);
            folder = folder.parentId ? byId.get(folder.parentId) : undefined;
        }
        return trail.reverse();
    }, [currentFolder, folders]);
    const activeFolder = folderOptions.find((folder) => folder.id === folderId);
    const folderPaths = useMemo(() => new Map(folderOptions.map((folder) => [folder.id, folder.path])), [folderOptions]);
    useEffect(() => setFolderPickerOpen(false), [folderId]);
    useEffect(() => {
        if (!folderPickerOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            if (!folderPickerRef.current?.contains(event.target as Node)) setFolderPickerOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setFolderPickerOpen(false);
            folderTriggerRef.current?.focus({ preventScroll: true });
        };
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [folderPickerOpen]);
    useEffect(() => {
        if (results.isSuccess && requestedFolder && !folderId) {
            void navigate({ to: '/culling/$galleryId/edited', params: { galleryId }, search: (current) => ({ ...current, folder: undefined }), replace: true, resetScroll: false });
        }
    }, [results.isSuccess, requestedFolder, folderId, navigate]);
    const folderPhotos = useMemo(() => (results.data?.photos ?? []).filter((photo) => (photo.folderId ?? null) === folderId), [results.data?.photos, folderId]);
    const hasDirectPhotos = folderPhotos.some((photo) => photo.mimeType?.startsWith('image/'));
    const accessError = (results.error || verify.error) as (Error & { code?: string }) | null;
    const expiry = results.data?.expiresAt ?? accessExpiresAt ?? (localStorage.getItem(`orbit:edit-results-expiry:${galleryId}`) || null);
    const expiryTime = expiry && expiry !== 'unlimited' ? Date.parse(expiry) : NaN;
    const expiryElapsed = Number.isFinite(expiryTime) && expiryTime <= clockNow;
    const accessExpired = Boolean(accessStatus.data?.isExpired || accessError?.code === 'EDIT_RESULTS_EXPIRED' || expiryElapsed);
    const unavailable = accessStatus.data?.available === false || accessError?.code === 'EDIT_RESULTS_CLOSED' || accessExpired;
    const faceStatus = useQuery({
        queryKey: ['public-edited-face-search-status', galleryId, token],
        queryFn: ({ signal }) => getFaceSearchStatus(galleryId, token, signal, 'edited'),
        enabled: Boolean(token) && results.isSuccess && !unavailable,
        staleTime: 0,
        refetchOnMount: 'always',
        refetchOnWindowFocus: true,
        refetchInterval: (query) => query.state.error ? false : 30_000,
        retry: false,
    });
    const selfieSearchUnavailable = faceStatus.isError || faceStatus.data?.available === false;
    const guideReady = results.isSuccess && !unavailable && Boolean(token);
    const selfieSearchAvailable = guideReady && faceStatus.data?.available === true && !faceStatus.isError && faceStatus.isFetchedAfterMount;
    const selfieStatusReady = selfieSearchAvailable;
    const validSelfieResults = selfieStatusReady && selfieResults.data && (!results.data?.sourceVersion || selfieResults.data.sourceVersion === results.data.sourceVersion) ? selfieResults.data : null;
    const matchedPhotos = useMemo(() => {
        const ids = new Set(validSelfieResults?.ids ?? []);
        return (results.data?.photos ?? []).filter((photo) => ids.has(photo.driveFileId));
    }, [results.data?.photos, validSelfieResults]);
    const photos = isSelfieView ? matchedPhotos : folderPhotos;
    const guideOpen = guideReady && (guideState.galleryId === galleryId ? guideState.open : localStorage.getItem(`orbit:edit-results-guide:${galleryId}`) !== 'seen');
    useEffect(() => {
        if (!isSelfieView) setShowFaceSearch(false);
        else if (selfieStatusReady && !guideOpen && !validSelfieResults) setShowFaceSearch(true);
    }, [isSelfieView, selfieStatusReady, guideOpen, validSelfieResults]);
    useEffect(() => {
        if (unavailable || !token) setShowFaceSearch(false);
    }, [unavailable, token]);
    useEffect(() => {
        if (selfieSearchUnavailable) setShowFaceSearch(false);
    }, [selfieSearchUnavailable]);
    useEffect(() => {
        if (!isSelfieView || !selfieSearchUnavailable) return;
        void navigate({ to: '/culling/$galleryId/edited', params: { galleryId }, search: (current) => ({ ...current, view: undefined, selfieSource: undefined, selfiePage: undefined }), replace: true, resetScroll: false });
    }, [isSelfieView, navigate, selfieSearchUnavailable]);
    const closeGuide = () => {
        localStorage.setItem(`orbit:edit-results-guide:${galleryId}`, 'seen');
        setGuideState({ galleryId, open: false });
    };
    useEffect(() => {
        if (unavailable || !token || !results.isSuccess) setFolderPickerOpen(false);
    }, [unavailable, token, results.isSuccess]);
    useEffect(() => {
        if (!Number.isFinite(expiryTime) || expiryTime <= Date.now()) return;
        const timer = window.setTimeout(() => {
            setClockNow(Date.now());
            void queryClient.invalidateQueries({ queryKey: ['public-edit-results-status', galleryId] });
        }, Math.min(expiryTime - Date.now() + 50, 2_147_483_647));
        return () => window.clearTimeout(timer);
    }, [expiryTime, galleryId, queryClient, clockNow]);
    const expired = (results.error as (Error & { status?: number }) | null)?.status === 401;
    const totalPages = Math.max(1, Math.ceil(photos.length / GALLERY_PAGE_SIZE));
    const sameSession = navigation.galleryId === galleryId && navigation.token === token && navigation.folderId === folderId && navigation.selfie === isSelfieView;
    const urlPage = Math.min(viewPage, totalPages);
    const page = pendingPage?.folderId === folderId && pendingPage.selfie === isSelfieView ? pendingPage.page : urlPage;
    useEffect(() => {
        if (!results.isSuccess || viewPage === urlPage) return;
        void navigate({ to: '/culling/$galleryId/edited', params: { galleryId }, search: (current) => ({ ...current, ...(isSelfieView ? { selfiePage: urlPage } : { editedPage: urlPage }) }), replace: true, resetScroll: false });
    }, [results.isSuccess, viewPage, navigate, urlPage, isSelfieView]);
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
        void navigate({ to: '/culling/$galleryId/edited', params: { galleryId }, search: (current) => ({ ...current, ...(isSelfieView ? { selfiePage: nextPage } : { editedPage: nextPage }) }), replace: true, resetScroll: false });
    }, [photos, galleryId, token, folderId, navigate, isSelfieView]);
    const closePhoto = useCallback(() => {
        setNavigation((current) => ({ ...current, photoId: null }));
    }, []);
    const changePage = (nextPage: number) => {
        const clampedPage = Math.max(1, Math.min(nextPage, totalPages));
        setPendingPage({ folderId, selfie: isSelfieView, page: clampedPage });
        setNavigation({ galleryId, token, folderId, selfie: isSelfieView, page: clampedPage, photoId: null });
        void navigate({ to: '/culling/$galleryId/edited', params: { galleryId }, search: (current) => ({ ...current, ...(isSelfieView ? { selfiePage: clampedPage } : { editedPage: clampedPage }) }), replace: false, resetScroll: false }).catch(() => setPendingPage(null));
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
    const downloadFolder = useCallback((targetFolderId: string, name: string, scope: EditFolderArchiveScope = 'subtree') => {
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
    const renderFolderArchiveButton = (targetFolderId: string, name: string) => {
        if (!folderPhotoCounts.get(targetFolderId)) return null;
        const isTarget = (folderArchiveTarget?.folderId === targetFolderId && folderArchiveTarget.scope === 'subtree') || (folderArchiveMutation.isPending && folderArchiveMutation.variables?.folderId === targetFolderId && folderArchiveMutation.variables?.scope === 'subtree');
        const status = isTarget ? folderArchiveStatus.data : null;
        const starting = folderArchiveMutation.isPending && folderArchiveMutation.variables?.folderId === targetFolderId && folderArchiveMutation.variables?.scope === 'subtree';
        const busy = starting || Boolean(isTarget && (!status || ['queued', 'running'].includes(status.status)));
        return <FolderArchiveButton
            name={name}
            busy={busy || pendingDownload === `folder-archive:subtree:${targetFolderId}`}
            ready={status?.status === 'completed' && Boolean(status.downloadUrl)}
            disabled={archiveJobInProgress && !isTarget}
            progress={status?.total ? `${status.processed ?? 0}/${status.total}` : undefined}
            onClick={() => downloadFolder(targetFolderId, name)}
        />;
    };
    const headerFolderId = folderId ?? '__all__';
    const headerScope: EditFolderArchiveScope = 'direct';
    const headerArchiveTarget = folderArchiveTarget?.folderId === headerFolderId && folderArchiveTarget.scope === headerScope;
    const headerArchiveStarting = folderArchiveMutation.isPending && folderArchiveMutation.variables?.folderId === headerFolderId && folderArchiveMutation.variables?.scope === headerScope;
    const headerArchivePending = headerArchiveStarting || Boolean(headerArchiveTarget && archiveJobInProgress) || pendingDownload === `folder-archive:${headerScope}:${headerFolderId}`;
    const archiveAction = !unavailable && token && results.isSuccess && hasDirectPhotos ? (
        <ArchiveDownloadAction key={`${galleryId}:${token}`} folder={Boolean(folderId)} pending={headerArchivePending} progress={headerArchiveTarget && folderArchiveStatus.data?.total ? `${folderArchiveStatus.data.processed ?? 0}/${folderArchiveStatus.data.total}` : undefined} onDownload={() => folderId && currentFolder ? downloadFolder(folderId, currentFolder.name, 'direct') : downloadFolder('__all__', 'Edited Photos', 'direct')} />
    ) : null;
    const accessLabel = accessExpired ? 'Access expired' : unavailable ? 'Access unavailable' : expiry ? expiryLabel(expiry) : null;
    const showGalleryToolbar = Boolean(token && !unavailable && results.isSuccess && !expired);
    const expiryAction = accessLabel ? <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-[var(--text-secondary)] sm:text-sm" title={accessLabel} aria-live="polite"><Clock3 size={15} aria-hidden="true" className="shrink-0" /><span className="sm:hidden">{accessExpired ? 'Expired' : unavailable ? 'Unavailable' : compactExpiryLabel(expiry)}</span><span className="hidden sm:inline">{accessLabel}</span></span> : null;
    const deliveryActions = archiveAction;
    const helpAction = guideReady ? <button type="button" onClick={() => setGuideState({ galleryId, open: true })} title="Edited Photos guide" aria-label="Edited Photos guide" className="flex h-11 w-11 shrink-0 items-center justify-center text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><HelpCircle size={16} aria-hidden="true" /></button> : null;
    const guide = guideReady && <EditedPhotosGuide open={guideOpen} onClose={closeGuide} theme={theme} hasFolders={folders.length > 0} hasArchive={hasDirectPhotos} />;
    const changeView = (next: GalleryView) => {
        closePhoto();
        setFolderPickerOpen(false);
        if (next === 'gallery') {
            if (selectionUnavailable) { setShowSelectionInfo(true); return; }
            onRequestSelectionAccess?.();
            return;
        }
        if (next !== 'edit-results' && next !== 'selfie') return;
        if (next === 'selfie' && (isSelfieView || !validSelfieResults)) setShowFaceSearch(true);
        else setShowFaceSearch(false);
        void navigate({
            to: '/culling/$galleryId/edited',
            params: { galleryId },
            search: (current) => ({ ...current, view: next === 'selfie' ? 'selfie' : undefined, selfieSource: undefined }),
            resetScroll: false,
        });
    };
    const selfieModal = selfieSearchAvailable && !guideOpen && showFaceSearch && <FaceSearchModal<EditResultPhoto>
        key={`${galleryId}:${token}`} theme={theme} galleryId={galleryId} token={token} source="edited"
        activeCount={matchedPhotos.length} activeTotal={validSelfieResults?.total ?? 0}
        onApply={async (matches, total, sourceVersion, signal) => {
            if (sourceVersion && sourceVersion !== results.data?.sourceVersion) {
                const refreshed = await results.refetch();
                if (signal?.aborted) return;
                if (refreshed.isError) throw refreshed.error;
                if (refreshed.data?.sourceVersion !== sourceVersion) throw new Error('This gallery changed during your search. Please try again.');
            }
            if (signal?.aborted) return;
            queryClient.setQueryData<EditedSelfieMatches>(selfieQueryKey, { ids: matches.map((photo) => photo.driveFileId), total, sourceVersion: sourceVersion ?? results.data?.sourceVersion });
            void navigate({ to: '/culling/$galleryId/edited', params: { galleryId }, search: (current) => ({ ...current, view: 'selfie', selfieSource: undefined, selfiePage: 1 }), resetScroll: false });
        }}
        onReset={() => { queryClient.setQueryData(selfieQueryKey, null); changeView('edit-results'); }}
        onClose={() => setShowFaceSearch(false)}
        onAccessError={() => { void results.refetch(); void accessStatus.refetch(); }}
    />;

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
                <div className="mb-3 flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]"><FolderOpen size={14} aria-hidden="true" /><span>Edited Gallery</span></div>
                <h1 className="font-display text-[26px] font-medium leading-tight text-[var(--text-primary)] [text-wrap:balance]">View Your Edited Photos</h1>
                <p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-[var(--text-muted)]">Enter your password to view and download your finished gallery.</p>
            <form aria-busy={verify.isPending} className="mt-7 flex w-full flex-col" onSubmit={(event) => { event.preventDefault(); if (verify.isPending) return; if (!password.trim()) { setError('Enter your password.'); return; } setError(''); accessSubmittedAt.current = Date.now(); verify.mutate(); }}>
                <GalleryPasswordField label="Edited photos password" name="editedPhotosPassword" value={password} onChange={(value) => { setPassword(value); if (error) setError(''); }} error={error} />
                <button disabled={verify.isPending} aria-live="polite" className="mt-3 inline-flex h-12 items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 text-xs font-bold text-[var(--bg-deep)] transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-45">
                    {verify.isPending ? <Loader2 size={15} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Lock size={15} aria-hidden="true" />} {verify.isPending ? 'Checking password…' : 'Unlock Edited Photos'}
                </button>
            </form>
            {onRequestSelectionAccess && <button type="button" onClick={onRequestSelectionAccess} className="mt-3 inline-flex min-h-11 items-center justify-center text-xs font-semibold text-[var(--text-secondary)] underline underline-offset-4 hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">Use Photo Selection password</button>}
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
            {isSelfieView && <div className="mb-4 flex min-w-0 items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
                <h2 className="font-sans text-base font-semibold">{validSelfieResults ? `${matchedPhotos.length} matching photos` : 'Find Your Photos'}</h2>
                {selfieSearchAvailable && <button type="button" onClick={() => setShowFaceSearch(true)} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-[var(--border)] px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><ScanFace size={16} aria-hidden="true" />{validSelfieResults ? 'Change selfie' : 'Choose selfie'}</button>}
            </div>}
            {!isSelfieView && currentFolder && <div className="mb-4 flex min-w-0 items-center gap-2 border-b border-[var(--border)] pb-3">
                <Link to="/culling/$galleryId/edited" params={{ galleryId }} search={(current) => ({ ...current, view: undefined, selfieSource: undefined, folder: currentFolder.parentId ?? undefined, editedPage: 1 })} resetScroll onClick={closePhoto} aria-label={`Back to ${folders.find((folder) => folder.id === currentFolder.parentId)?.name ?? 'Edited Photos'}`} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><ArrowLeft size={18} aria-hidden="true" /></Link>
                <nav aria-label="Folder breadcrumb" className="min-w-0 flex-1 overflow-hidden text-xs font-medium text-[var(--text-muted)]">
                    <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
                        <li className="flex min-w-0 items-center gap-1">
                            <Link to="/culling/$galleryId/edited" params={{ galleryId }} search={(current) => ({ ...current, view: undefined, selfieSource: undefined, folder: undefined, editedPage: 1 })} resetScroll onClick={closePhoto} className="max-w-32 truncate hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">Edited Photos</Link>
                        </li>
                        {folderBreadcrumbs.map((folder, index) => <li key={folder.id} className="flex min-w-0 items-center gap-1">
                            <ChevronRight size={13} aria-hidden="true" className="shrink-0 opacity-60" />
                            {index === folderBreadcrumbs.length - 1
                                ? <span aria-current="page" className="max-w-[min(55vw,18rem)] truncate font-semibold text-[var(--text-primary)]">{folder.name}</span>
                                : <Link to="/culling/$galleryId/edited" params={{ galleryId }} search={(current) => ({ ...current, view: undefined, selfieSource: undefined, folder: folder.id, editedPage: 1 })} resetScroll onClick={closePhoto} className="max-w-32 truncate hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">{folder.name}</Link>}
                        </li>)}
                    </ol>
                </nav>
                {renderFolderArchiveButton(currentFolder.id, currentFolder.name)}
            </div>}
            {folderArchiveTarget && ['queued', 'running'].includes(folderArchiveStatus.data?.status ?? 'queued') && <p role="status" aria-live="polite" className="mb-3 text-xs text-[var(--text-secondary)]">{folderArchiveStatus.data?.status === 'running' ? 'Preparing' : 'Queued'} {folderArchiveTarget.name} ZIP{folderArchiveStatus.data?.status === 'running' && folderArchiveStatus.data.total ? ` (${folderArchiveStatus.data.processed ?? 0}/${folderArchiveStatus.data.total})` : '…'}</p>}
            {folderArchiveTarget && folderArchiveStatus.data?.status === 'completed' && folderArchiveStatus.data.downloadUrl && <p role="status" aria-live="polite" className="sr-only">{folderArchiveTarget.name} ZIP is ready. Download starting.</p>}
            {!isSelfieView && childFolders.length > 0 && <section aria-label={childFoldersLabel} className={photos.length > 0 ? 'mb-6' : undefined}>
                <h2 className="mb-2 flex items-center gap-2 font-sans text-xs font-semibold tracking-normal text-[var(--text-secondary)]"><Folder size={14} aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{childFoldersLabel}</span></h2>
                <div data-testid="edited-folder-tiles" className="grid grid-cols-1 gap-0 border-t border-[var(--border)] sm:grid-cols-2 sm:gap-2 sm:border-0 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                    {childFolders.map((folder) => <div key={folder.id} className="flex min-w-0 items-center border-b border-[var(--border)] sm:min-h-16 sm:rounded-md sm:border sm:bg-[var(--bg-card)]">
                        <Link to="/culling/$galleryId/edited" params={{ galleryId }} search={(current) => ({ ...current, view: undefined, selfieSource: undefined, folder: folder.id, editedPage: 1 })} resetScroll onClick={closePhoto} aria-label={`Open folder ${folder.name}`} className="group flex min-h-12 min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-[13px] font-medium transition-colors hover:bg-[var(--bg-card)] focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] sm:min-h-16 sm:rounded-md sm:px-3 sm:py-3 sm:text-sm sm:hover:bg-[var(--bg-elevated)]">
                            <Folder size={17} aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]" /><span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{folder.name}</span><ChevronRight size={15} aria-hidden="true" className="shrink-0 text-[var(--text-muted)] transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none" />
                        </Link>
                        {renderFolderArchiveButton(folder.id, folder.name)}
                    </div>)}
                </div>
            </section>}
            {!isSelfieView && childFolders.length > 0 && photos.length > 0 && <h2 className="mb-3 border-t border-[var(--border)] pt-5 font-sans text-xs font-semibold tracking-normal text-[var(--text-secondary)]">Photos &amp; Video</h2>}
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
                    folderLabel={isSelfieView ? folderPaths.get(photo.folderId ?? '') ?? 'Edited Photos' : undefined}
                    downloadPending={pendingDownload === photo.driveFileId}
                    onOpen={openPhoto}
                    onPrefetch={prefetchPhoto}
                    onDownload={(item) => void startDownload(item.downloadResolveUrl, item.driveFileId)}
                />)}
            </div> : (isSelfieView || !childFolders.length) && <div role="status" className="py-20 text-center font-sans text-[15px] font-medium leading-6 text-[var(--text-secondary)] sm:text-base">{isSelfieView ? !selfieSearchAvailable ? 'Checking selfie search…' : validSelfieResults ? 'No matching photos found.' : 'Choose a selfie to find your photos.' : folderId ? 'This folder is empty.' : 'No edited photos are available.'}</div>}
            {totalPages > 1 && <nav className="mt-6 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4 sm:justify-center sm:gap-6" aria-label="Edited photos pages">
                <button type="button" aria-label="Previous page" title="Previous page" disabled={page === 1} onClick={() => changePage(page - 1)} className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-35"><ChevronLeft size={18} /></button>
                <span role="status" aria-live="polite" className="text-xs tabular-nums text-[var(--text-secondary)]">Page {page} of {totalPages}</span>
                <button type="button" aria-label="Next page" title="Next page" disabled={page === totalPages} onClick={() => changePage(page + 1)} className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-35"><ChevronRight size={18} /></button>
            </nav>}
            {!isSelfieView && folderId && folders.length > 0 && (
                <nav data-testid="edited-folder-bar" aria-label="Edited photo folders" className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--border)] bg-[var(--bg-deep)] px-2.5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(0,0,0,0.12)] sm:px-8">
                    <div ref={folderPickerRef} className="relative mx-auto flex max-w-[1600px] min-w-0 items-center">
                        <button ref={folderTriggerRef} type="button" aria-label={`Choose folder, current: ${activeFolder?.path ?? 'Edited Photos'}`} aria-expanded={folderPickerOpen} aria-controls={folderPickerId} onClick={() => setFolderPickerOpen((open) => !open)} className="inline-flex h-11 w-full max-w-md min-w-0 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-3 text-left text-sm font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] [touch-action:manipulation]">
                            <FolderOpen size={17} aria-hidden="true" className="shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{activeFolder?.name ?? 'Edited Photos'}</span>
                            <ChevronUp size={17} aria-hidden="true" className={clsx('shrink-0 transition-transform duration-150 motion-reduce:transition-none', folderPickerOpen && 'rotate-180')} />
                        </button>
                        <div id={folderPickerId} data-testid="edited-folder-panel" aria-hidden={!folderPickerOpen} inert={!folderPickerOpen} className={clsx('absolute bottom-[calc(100%+0.75rem)] left-0 z-10 flex max-h-[min(60dvh,26rem)] w-full max-w-md origin-bottom flex-col overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-deep)] shadow-[0_-12px_32px_rgba(0,0,0,0.18)] transition-[opacity,transform] duration-150 motion-reduce:transition-none', folderPickerOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0')}>
                            <div className="flex min-h-12 shrink-0 items-center justify-between border-b border-[var(--border)] pl-4 pr-1">
                                <span className="text-xs font-semibold text-[var(--text-secondary)]">Folders</span>
                                <button type="button" aria-label="Close folders" onClick={() => { setFolderPickerOpen(false); folderTriggerRef.current?.focus({ preventScroll: true }); }} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]"><X size={17} aria-hidden="true" /></button>
                            </div>
                            <div className="min-h-0 overflow-y-auto overscroll-contain p-1.5">
                                <Link to="/culling/$galleryId/edited" params={{ galleryId }} search={(current) => ({ ...current, view: undefined, selfieSource: undefined, folder: undefined, editedPage: 1 })} resetScroll onClick={() => { closePhoto(); setFolderPickerOpen(false); folderTriggerRef.current?.focus({ preventScroll: true }); }} aria-current={!folderId ? 'page' : undefined} className={clsx('flex min-h-12 items-center gap-3 rounded px-3 py-2 text-sm transition-colors hover:bg-[var(--bg-card)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]', !folderId && 'bg-[var(--bg-card)] font-semibold')}><FolderOpen size={17} aria-hidden="true" className="shrink-0" /><span className="min-w-0 flex-1">Edited Photos</span>{!folderId && <Check size={16} aria-hidden="true" className="shrink-0" />}</Link>
                                {folderOptions.map((folder) => <Link key={folder.id} to="/culling/$galleryId/edited" params={{ galleryId }} search={(current) => ({ ...current, view: undefined, selfieSource: undefined, folder: folder.id, editedPage: 1 })} resetScroll onClick={() => { closePhoto(); setFolderPickerOpen(false); folderTriggerRef.current?.focus({ preventScroll: true }); }} aria-label={`Open folder ${folder.path}`} aria-current={folder.id === folderId ? 'page' : undefined} className={clsx('flex min-h-12 items-start gap-3 rounded px-3 py-2 text-sm transition-colors hover:bg-[var(--bg-card)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]', folder.id === folderId && 'bg-[var(--bg-card)] font-semibold')}>{folder.id === folderId ? <FolderOpen size={17} aria-hidden="true" className="mt-0.5 shrink-0" /> : <Folder size={17} aria-hidden="true" className="mt-0.5 shrink-0" />}<span className="min-w-0 flex-1 [overflow-wrap:anywhere]"><span className="block">{folder.name}</span>{folder.parentPath && <span className="mt-0.5 block text-xs font-normal text-[var(--text-muted)]">In {folder.parentPath}</span>}</span>{folder.id === folderId && <Check size={16} aria-hidden="true" className="mt-0.5 shrink-0" />}</Link>)}
                            </div>
                        </div>
                    </div>
                </nav>
            )}
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
    if (!standalone) return <>{downloadTarget && createPortal(archiveAction, downloadTarget)}{expiryTarget && createPortal(expiryAction, expiryTarget)}{helpTarget && createPortal(helpAction, helpTarget)}{content}{guide}{selfieModal}</>;
    return <main style={theme === 'black' ? BLACK_THEME : WHITE_THEME} className="flex min-h-screen flex-col bg-[var(--bg-deep)] font-sans text-[var(--text-primary)]">
        <a href="#edited-gallery-content" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[160] focus:rounded-md focus:bg-[var(--accent)] focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-[var(--bg-deep)]">Skip to edited photos</a>
        <header data-testid="gallery-header" className="sticky top-0 z-40 h-20 border-b border-[var(--border)] bg-[var(--bg-deep)] px-2.5 sm:px-8 lg:h-16">
            <div className="mx-auto grid h-full max-w-[1600px] min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[2.75rem_1.5rem] items-center gap-x-2 py-1 lg:flex lg:py-0">
                <OrbitLogo theme={theme} />
                <GalleryHeaderIdentity section="Edited Photos" title={accessStatus.data?.title} />
                <div className="col-start-3 row-start-1 flex shrink-0 items-center gap-1 sm:ml-2 sm:gap-2 lg:ml-auto">
                    {expiryAction}
                    {helpAction}
                    {onToggleTheme && <ThemeToggle theme={theme} onToggle={onToggleTheme} />}
                </div>
            </div>
        </header>
        {showGalleryToolbar && <div data-testid="gallery-toolbar" className="sticky top-20 z-30 border-b border-[var(--border)] bg-[var(--bg-deep)] px-2.5 py-2 [touch-action:manipulation] sm:px-8 sm:py-2.5 lg:top-16">
            <div className="mx-auto flex max-w-[1600px] items-center gap-1 sm:gap-x-2">
                <div className={clsx('min-w-0 flex-none sm:w-auto', deliveryOnly && !selfieSearchAvailable ? 'w-full' : 'w-[calc((100%-0.375rem)/2)]')}><GalleryViewTabs value={isSelfieView ? 'selfie' : 'edit-results'} deliveryOnly={deliveryOnly} galleryAvailable={Boolean(onRequestSelectionAccess)} galleryUnavailableAction={selectionUnavailable} editedAvailable={!unavailable} editedExpired={accessExpired} selfieAvailable={selfieSearchAvailable} allPhotosButtonRef={selectionInfoTriggerRef} onAllPhotos={() => changeView('gallery')} onChange={changeView} /></div>
                {deliveryActions && <div className="ml-auto shrink-0">{deliveryActions}</div>}
            </div>
        </div>}
        <div id="edited-gallery-content" tabIndex={-1} className="flex-1 scroll-mt-44 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] lg:scroll-mt-36">{content}</div>
        <GalleryFooter className={clsx(results.isSuccess && folderId && folders.length > 0 && !isSelfieView && 'pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-24')} />
        {guide}
        {selfieModal}
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
