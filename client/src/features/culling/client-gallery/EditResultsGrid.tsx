import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight, Clock3, Download, FolderOpen, Instagram, Loader2, Lock, RotateCcw } from 'lucide-react';
import clsx from 'clsx';

import { getEditResults, getEditResultsStatus, verifyEditResultsPassword } from '../culling.public';
import type { EditResultPhoto } from '../culling.types';
import { BLACK_THEME, GALLERY_PAGE_SIZE, WHITE_THEME } from './constants';
import { GalleryViewTabs, OrbitLogo, ThemeToggle, type GalleryView } from './GalleryChrome';
import { PhotoTile } from './PhotoTile';
import { Lightbox } from './Lightbox';
import { canPrefetchPreview, preloadPreviewImage } from './preview-cache';
import type { GalleryTheme } from './types';

const inputClass = 'h-11 w-full rounded-md border border-[var(--border)] bg-[var(--bg-deep)] px-3 text-center text-sm font-semibold tracking-[0.12em] text-[var(--text-primary)] outline-none placeholder:font-normal placeholder:tracking-normal placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]';
const previewUrlFor = (photo: EditResultPhoto) => photo.previewUrl;
const thumbnailUrlFor = (photo: EditResultPhoto) => photo.thumbnailUrl;
const downloadUrlFor = (photo: EditResultPhoto) => photo.downloadUrl;
const comparisonFor = (photo: EditResultPhoto) => photo.comparison;
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
    if (canPrefetchPreview()) void preloadPreviewImage(photo.previewUrl, 'low').catch(() => undefined);
};

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
    onViewChange,
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
    onViewChange?: (view: GalleryView) => void;
}) {
    const queryClient = useQueryClient();
    const { folder: requestedFolder } = useSearch({ from: '/culling/$galleryId' });
    const navigate = useNavigate({ from: '/culling/$galleryId' });
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [accessExpiresAt, setAccessExpiresAt] = useState<string | null>(null);
    const [navigation, setNavigation] = useState({ galleryId, token, folderId: requestedFolder ?? null, page: 1, photoId: null as string | null });
    const gridRef = useRef<HTMLDivElement>(null);
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
    });
    useEffect(() => {
        const status = (results.error as (Error & { status?: number }) | null)?.status;
        if (status === 401 && token) {
            localStorage.removeItem(`orbit:edit-results-token:${galleryId}`);
            localStorage.removeItem(`orbit:edit-results-expiry:${galleryId}`);
            setAccessExpiresAt(null);
            setError(results.error?.message || 'Enter the edited photos password again.');
            setNavigation((current) => ({ ...current, photoId: null, page: 1 }));
            onToken('');
            queryClient.removeQueries({ queryKey: ['public-edit-results', galleryId, token], exact: true });
        }
    }, [results.error, token, galleryId, onToken, queryClient]);
    const folders = useMemo(() => results.data?.folders ?? [], [results.data?.folders]);
    const folderId = requestedFolder && folders.some((folder) => folder.id === requestedFolder) ? requestedFolder : null;
    useEffect(() => {
        setNavigation((current) => current.galleryId === galleryId && current.token === token && current.folderId === folderId
            ? current
            : { galleryId, token, folderId, page: 1, photoId: null });
    }, [galleryId, token, folderId]);
    const childFolders = folders.filter((folder) => folder.parentId === folderId);
    const breadcrumbs = useMemo(() => {
        const trail: typeof folders = [];
        const seen = new Set<string>();
        let current = folderId;
        while (current && !seen.has(current)) {
            seen.add(current);
            const folder = folders.find((entry) => entry.id === current);
            if (!folder) break;
            trail.unshift(folder);
            current = folder.parentId;
        }
        return trail;
    }, [folderId, folders]);
    useEffect(() => {
        if (results.isSuccess && requestedFolder && !folderId) {
            void navigate({ search: (current) => ({ ...current, folder: undefined }), replace: true, resetScroll: false });
        }
    }, [results.isSuccess, requestedFolder, folderId, navigate]);
    const photos = useMemo(() => (results.data?.photos ?? []).filter((photo) => (photo.folderId ?? null) === folderId), [results.data?.photos, folderId]);
    const archive = results.data?.archive;
    const accessError = (results.error || verify.error) as (Error & { code?: string }) | null;
    const unavailable = accessStatus.data?.available === false || accessError?.code === 'EDIT_RESULTS_CLOSED' || accessError?.code === 'EDIT_RESULTS_EXPIRED';
    const accessExpired = accessStatus.data?.isExpired || accessError?.code === 'EDIT_RESULTS_EXPIRED';
    const expiry = results.data?.expiresAt ?? accessExpiresAt ?? (localStorage.getItem(`orbit:edit-results-expiry:${galleryId}`) || null);
    const expired = (results.error as (Error & { status?: number }) | null)?.status === 401;
    const totalPages = Math.max(1, Math.ceil(photos.length / GALLERY_PAGE_SIZE));
    const sameSession = navigation.galleryId === galleryId && navigation.token === token && navigation.folderId === folderId;
    const page = Math.min(sameSession ? navigation.page : 1, totalPages);
    const startIndex = (page - 1) * GALLERY_PAGE_SIZE;
    const visiblePhotos = photos.slice(startIndex, startIndex + GALLERY_PAGE_SIZE);
    const photoId = sameSession ? navigation.photoId : null;
    const openPhoto = useCallback((id: string) => {
        const index = photos.findIndex((photo) => photo.driveFileId === id);
        if (index < 0) return;
        setNavigation({ galleryId, token, folderId, page: Math.floor(index / GALLERY_PAGE_SIZE) + 1, photoId: id });
    }, [photos, galleryId, token, folderId]);
    const closePhoto = useCallback(() => {
        setNavigation((current) => ({ ...current, photoId: null }));
    }, []);
    const changePage = (nextPage: number) => {
        setNavigation({ galleryId, token, folderId, page: Math.max(1, Math.min(nextPage, totalPages)), photoId: null });
        gridRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    };
    const archiveAction = !unavailable && token && results.isSuccess && archive ? (
        <a href={archive.downloadUrl} target="_blank" rel="noreferrer" title={archive.filename} aria-label="Download All (.zip)" className="inline-flex h-10 w-[min(210px,calc(100vw-1rem))] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--accent)] px-3 text-[11px] font-semibold text-[var(--bg-deep)] transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] motion-reduce:transition-none sm:h-11 sm:gap-2 sm:px-4 sm:text-[13px]">
            <Download size={13} aria-hidden="true" /> <span>Download All <span className="font-normal opacity-75">(.zip)</span></span>
        </a>
    ) : null;
    const expiryAction = expiry ? <span className="inline-flex min-w-0 max-w-[5.5rem] items-center gap-1 text-[9px] font-medium text-[var(--text-muted)] sm:max-w-none sm:gap-1.5 sm:text-xs" title={expiryLabel(expiry)} aria-label={expiryLabel(expiry)} aria-live="polite"><Clock3 size={12} aria-hidden="true" className="shrink-0 animate-[spin_12s_linear_infinite] text-[var(--accent)] motion-reduce:animate-none" /><span className="truncate sm:hidden">{compactExpiryLabel(expiry)}</span><span className="hidden truncate sm:inline">{expiryLabel(expiry)}</span></span> : null;
    const deliveryActions = archiveAction;

    const content = unavailable ? (
        <section role="status" className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-5 py-10 text-center">
            <Lock size={24} aria-hidden="true" />
            <h1 className="font-display text-2xl">{accessExpired ? 'Edited Photos access expired' : 'Edited Photos unavailable'}</h1>
            <p className="text-sm text-[var(--text-muted)]">{accessExpired ? 'Please contact the photographer to reopen access.' : 'Access is not open. Please contact the photographer.'}</p>
            <button type="button" onClick={() => { verify.reset(); void accessStatus.refetch(); if (token) void results.refetch(); }} className="inline-flex h-11 items-center gap-2 rounded-md border border-[var(--border)] px-4 text-sm"><RotateCcw size={15} aria-hidden="true" /> Check again</button>
        </section>
    ) : !token || expired ? (
        <section className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-5 py-10 text-center">
            <Lock size={24} className="mb-5 text-[var(--accent)]" />
            <h1 className="mt-2 font-display text-2xl text-[var(--text-primary)]">Edited Photos</h1>
            <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--text-muted)]">Enter your edited photos password.</p>
            <form className="mt-6 flex w-full flex-col gap-2" onSubmit={(event) => { event.preventDefault(); setError(''); verify.mutate(); }}>
                <input type="password" aria-label="Edited photos password" autoComplete="current-password" autoCapitalize="none" value={password} onChange={(event) => setPassword(event.currentTarget.value.slice(0, 64))} placeholder="Edited photos password" className={inputClass} />
                {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
                <button disabled={verify.isPending || password.trim().length < 6} className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 text-xs font-bold uppercase tracking-[0.08em] text-[var(--bg-deep)] disabled:opacity-45">
                    {verify.isPending ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />} Unlock Edited Photos
                </button>
            </form>
            {expired && <button type="button" onClick={() => { setPassword(''); setError('Edited photos access has expired. Please contact the photographer.'); }} className="mt-3 text-xs text-[var(--text-muted)] underline">Enter password again</button>}
            {onExit && <button type="button" onClick={onExit} className="mt-5 inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] px-4 text-xs font-semibold text-[var(--text-secondary)]"><ArrowLeft size={14} /> Back to gallery</button>}
        </section>
    ) : results.isPending ? (
        <div role="status" className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={18} className="animate-spin" /> Loading edited photos...</div>
    ) : results.isError ? (
        <div role="alert" className="mx-auto flex min-h-[45dvh] max-w-md flex-col items-center justify-center px-5 text-center">
            <AlertCircle size={24} className="mb-4 text-rose-400" />
            <p className="text-sm text-[var(--text-primary)]">{results.error instanceof Error ? results.error.message : 'Unable to load edited photos.'}</p>
            <button type="button" onClick={() => void results.refetch()} className="mt-4 inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] px-4 text-xs font-semibold"><RotateCcw size={14} /> Retry</button>
        </div>
    ) : (
        <div className={clsx('mx-auto max-w-[1664px]', standalone && 'px-2.5 pb-10 pt-3 sm:px-8 sm:pt-5 sm:pb-12 md:pt-6')}>
            {folders.length > 0 && <nav aria-label="Edited photo folders" className="mb-4 flex flex-wrap items-center gap-1 text-sm text-[var(--text-secondary)]">
                <Link from="/culling/$galleryId" search={(current) => ({ ...current, view: 'edit-results', folder: undefined })} resetScroll={false} onClick={closePhoto} aria-current={!folderId ? 'page' : undefined} className="inline-flex min-h-11 items-center rounded px-2 font-semibold hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">Edited Photos</Link>
                {breadcrumbs.map((folder) => <span key={folder.id} className="flex min-w-0 max-w-full items-center gap-1">
                    <ChevronRight size={14} aria-hidden="true" className="shrink-0" />
                    <Link from="/culling/$galleryId" search={(current) => ({ ...current, view: 'edit-results', folder: folder.id })} resetScroll={false} onClick={closePhoto} aria-current={folder.id === folderId ? 'page' : undefined} className="inline-flex min-h-11 min-w-0 items-center break-all rounded px-2 hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">{folder.name}</Link>
                </span>)}
            </nav>}
            {childFolders.length > 0 && <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {childFolders.map((folder) => <Link key={folder.id} from="/culling/$galleryId" search={(current) => ({ ...current, view: 'edit-results', folder: folder.id })} resetScroll={false} onClick={closePhoto} aria-label={`Open folder ${folder.name}`} className="flex min-h-14 min-w-0 items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-primary)] hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                    <FolderOpen size={20} aria-hidden="true" className="shrink-0 text-[var(--text-secondary)]" /><span className="min-w-0 break-all">{folder.name}</span><ChevronRight size={16} aria-hidden="true" className="ml-auto shrink-0" />
                </Link>)}
            </div>}
            {photos.length ? <div ref={gridRef} data-testid="edited-gallery-grid" className="grid scroll-mt-36 grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2 md:grid-cols-4 md:gap-3 xl:grid-cols-5 2xl:grid-cols-6">
                {visiblePhotos.map((photo, index) => <PhotoTile
                    key={photo.driveFileId}
                    photo={photo}
                    galleryId={galleryId}
                    token={token}
                    mode="delivery"
                    thumbnailUrl={photo.thumbnailUrl}
                    downloadUrl={photo.downloadUrl}
                    displayIndex={startIndex + index}
                    thumbnailPriority={index === 0}
                    thumbnailEager={index < 10}
                    onOpen={openPhoto}
                    onPrefetch={prefetchPhoto}
                />)}
            </div> : !childFolders.length && <div role="status" className="py-20 text-center text-sm text-[var(--text-muted)]">{folderId ? 'This folder is empty.' : 'No edited photos are available.'}</div>}
            {totalPages > 1 && <nav className="mt-6 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4 sm:justify-center sm:gap-6" aria-label="Edited photos pages">
                <button type="button" aria-label="Previous page" title="Previous page" disabled={page === 1} onClick={() => changePage(page - 1)} className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-35"><ChevronLeft size={18} /></button>
                <span className="text-xs tabular-nums text-[var(--text-secondary)]">Page {page} of {totalPages}</span>
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
                getThumbnailUrl={thumbnailUrlFor}
                getDownloadUrl={downloadUrlFor}
                getComparison={comparisonFor}
                onClose={closePhoto}
                onMove={openPhoto}
            />
        </div>
    );

    if (!standalone) return <>{downloadTarget && createPortal(archiveAction, downloadTarget)}{expiryTarget && createPortal(expiryAction, expiryTarget)}{content}</>;
    return <main style={theme === 'black' ? BLACK_THEME : WHITE_THEME} className="min-h-screen bg-[var(--bg-deep)] font-sans text-[var(--text-primary)]">
        <header data-testid="gallery-header" className="sticky top-0 z-40 h-14 border-b border-[var(--border)] bg-[var(--bg-deep)] px-2.5 sm:px-8">
            <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-1.5 sm:gap-2">
                <div className="flex items-center gap-1"><OrbitLogo theme={theme} />{onToggleTheme && <ThemeToggle theme={theme} onToggle={onToggleTheme} />}</div>
                {expiryAction}
            </div>
        </header>
        <div data-testid="gallery-toolbar" className="sticky top-14 z-30 border-b border-[var(--border)] bg-[var(--bg-deep)] px-2 py-1.5 sm:px-8 sm:py-2">
            <div className="mx-auto flex max-w-[1600px] items-center gap-1 sm:gap-x-2">
                <GalleryViewTabs value="edit-results" galleryAvailable={false} editedAvailable onAllPhotos={() => {}} onChange={(view) => { if (view !== 'edit-results') return; closePhoto(); onViewChange?.(view); }} />
                {deliveryActions && <div className="ml-auto min-w-0">{deliveryActions}</div>}
            </div>
        </div>
        {content}
        <footer className="border-t border-[var(--border)] px-4 py-5 text-[10px] text-[var(--text-muted)] md:px-8">
            <div className="mx-auto flex max-w-[1600px] flex-col items-center justify-between gap-3 sm:flex-row">
                <p>&copy; {new Date().getFullYear()} The Orbit Photo. All rights reserved.</p>
                <a href="https://www.instagram.com/theorbitphoto/" target="_blank" rel="noreferrer" aria-label="@theorbitphoto on Instagram" className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                    <Instagram size={13} /> @theorbitphoto
                </a>
            </div>
        </footer>
    </main>;
}
