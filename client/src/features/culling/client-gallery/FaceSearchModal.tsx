import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Loader2, RefreshCcw, ScanFace, SlidersHorizontal, Upload } from 'lucide-react';
import clsx from 'clsx';
import { GalleryModal } from '../../../components/GalleryModal';
import type { GalleryPhoto } from '../culling.types';
import { getFaceSearchStatus, runFaceSearch, type FaceSearchProgress, type FaceSearchSensitivity } from './face-search';
import { BLACK_THEME, WHITE_THEME } from './constants';
import type { GalleryTheme } from './types';

type FaceSearchModalProps = {
    theme: GalleryTheme;
    galleryId: string;
    token: string;
    activeCount: number;
    activeTotal: number;
    onApply: (photos: GalleryPhoto[], total: number) => void;
    onReset: () => void;
    onClose: () => void;
};

const sensitivityOptions: Array<{ value: FaceSearchSensitivity; label: string }> = [
    { value: 'strict', label: 'Strict' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'wide', label: 'Wider' },
];

function phaseLabel(progress: FaceSearchProgress | null): string {
    if (progress?.phase === 'worker' && progress.total > 0) return `Preparing face search ${progress.processed} / ${progress.total}`;
    if (progress?.phase === 'worker') return 'Preparing face search...';
    return 'Preparing your search...';
}

function waitForPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            window.clearTimeout(timeout);
            reject(new DOMException('Face search was cancelled.', 'AbortError'));
        };
        const timeout = window.setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, milliseconds);
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

export function FaceSearchModal({ theme, galleryId, token, activeCount, activeTotal, onApply, onReset, onClose }: FaceSearchModalProps) {
    const [selfie, setSelfie] = useState<{ file: File; url: string } | null>(null);
    const [sensitivity, setSensitivity] = useState<FaceSearchSensitivity>('balanced');
    const [progress, setProgress] = useState<FaceSearchProgress | null>(null);
    const [error, setError] = useState('');
    const [isScanning, setIsScanning] = useState(false);
    const [result, setResult] = useState<{ count: number; total: number } | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const previewRef = useRef<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const cameraRef = useRef<HTMLInputElement>(null);
    const percent = progress?.total ? Math.min(100, Math.round(progress.processed / progress.total * 100)) : 0;

    useEffect(() => () => {
        abortRef.current?.abort();
        if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    }, []);

    const runSearch = async (file: File, mode = sensitivity) => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setError('');
        setResult(null);
        setIsScanning(true);
        setProgress(null);
        try {
            const search = () => runFaceSearch({
                galleryId, token, selfieFile: file, sensitivity: mode, signal: controller.signal,
                onProgress: (next) => { if (!controller.signal.aborted) setProgress(next); },
            });
            let found = await search();
            if (found.status === 'indexing') {
                const startedAt = Date.now();
                while (found.status === 'indexing') {
                    const elapsed = Date.now() - startedAt;
                    if (elapsed >= 120_000) throw new Error('Face search is still being prepared. Please try again in a moment.');
                    await waitForPoll(elapsed < 30_000 ? 2_000 : 5_000, controller.signal);
                    const status = await getFaceSearchStatus(galleryId, token, controller.signal);
                    if (!status.available || status.status === 'unavailable') throw new Error('Face search is temporarily unavailable.');
                    setProgress({ phase: 'worker', processed: status.processed, total: status.total, matches: 0 });
                    if (status.status === 'failed') throw new Error('We could not prepare this gallery for face search. Please try again.');
                    if (status.status === 'ready') found = await search();
                }
            }
            if (controller.signal.aborted || abortRef.current !== controller) return;
            if (found.status !== 'complete') throw new Error('Face search is still being prepared.');
            setResult({ count: found.matches.length, total: found.total });
            onApply(found.matches.map((match) => match.photo), found.total);
        } catch (searchError) {
            if (controller.signal.aborted || abortRef.current !== controller) return;
            setError(searchError instanceof Error ? searchError.message : 'Unable to search. Please try another selfie.');
        } finally {
            if (abortRef.current === controller) {
                abortRef.current = null;
                setIsScanning(false);
            }
        }
    };

    const chooseSelfie = (file?: File) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) { setError('Please choose an image.'); return; }
        if (file.size > 10 * 1024 * 1024) { setError('Please choose an image smaller than 10 MB.'); return; }
        if (previewRef.current) URL.revokeObjectURL(previewRef.current);
        const url = URL.createObjectURL(file);
        previewRef.current = url;
        setSelfie({ file, url });
        void runSearch(file);
    };

    const cancelSearch = () => {
        abortRef.current?.abort();
        abortRef.current = null;
        setIsScanning(false);
        setProgress(null);
    };

    const reset = () => {
        cancelSearch();
        if (previewRef.current) URL.revokeObjectURL(previewRef.current);
        previewRef.current = null;
        setSelfie(null);
        setResult(null);
        setError('');
        onReset();
    };

    const shownResult = result ?? (activeTotal > 0 ? { count: activeCount, total: activeTotal } : null);
    const buttonFeedback = 'transition-[transform,opacity,background-color] duration-150 ease-out motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-45';
    const primaryButton = `${buttonFeedback} inline-flex items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-4 font-semibold text-[var(--bg-deep)] enabled:hover:opacity-90`;
    const secondaryButton = `${buttonFeedback} inline-flex h-11 items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 text-xs font-semibold text-[var(--text-secondary)] enabled:hover:bg-[var(--bg-hover)]`;

    return (
        <GalleryModal title="Filter by selfie" close={onClose} busy={isScanning} style={theme === 'black' ? BLACK_THEME : WHITE_THEME} widthClass="max-w-md" layerClass="z-[130]" footer={(
            <>
                {shownResult && !isScanning && <button type="button" onClick={reset} className={`${secondaryButton} mr-auto`}><RefreshCcw size={14} /> Reset</button>}
                {isScanning ? (
                    <button type="button" onClick={cancelSearch} className={secondaryButton}>Cancel search</button>
                ) : (
                    <button type="button" onClick={onClose} className={shownResult?.count ? `${primaryButton} h-11 text-xs` : secondaryButton}>
                        {shownResult?.count ? <><Check size={15} /> Show {shownResult.count} photos</> : 'Close'}
                    </button>
                )}
            </>
        )}>
            <div className="space-y-5">
                <p className="text-sm text-[var(--text-secondary)]">Find the photos you&apos;re in.</p>
                <input ref={fileRef} type="file" accept="image/*" aria-label="Choose selfie" className="hidden" disabled={isScanning} onChange={(event) => { chooseSelfie(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
                <input ref={cameraRef} type="file" accept="image/*" capture="user" aria-label="Take selfie" className="hidden" disabled={isScanning} onChange={(event) => { chooseSelfie(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />

                {selfie && (
                    <div className="flex min-w-0 items-center gap-3">
                        <img src={selfie.url} alt="Your selected selfie" className="h-16 w-16 shrink-0 rounded-md object-cover" />
                        <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{selfie.file.name}</p>
                            <p className="mt-1 text-xs text-[var(--text-muted)]">Selfie selected</p>
                        </div>
                    </div>
                )}

                <div>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                        <button type="button" disabled={isScanning} onClick={() => fileRef.current?.click()} aria-describedby="selfie-processing-note" className={`${primaryButton} min-h-12 min-w-0 text-sm`}>
                            <Upload size={17} className="shrink-0" /> {selfie ? 'Change selfie' : 'Choose selfie'}
                        </button>
                        <button type="button" disabled={isScanning} onClick={() => cameraRef.current?.click()} aria-label="Take a selfie" aria-describedby="selfie-processing-note" title="Take a selfie" className={`${secondaryButton} !h-12 w-12 !px-0`}><Camera size={19} /></button>
                    </div>
                    <p id="selfie-processing-note" className="mt-3 text-xs leading-5 text-[var(--text-muted)]">Selecting a selfie starts face matching. It may be sent to our server for processing and isn&apos;t added to your gallery.</p>
                </div>

                {isScanning && (
                    <div role="status" aria-live="polite" className="space-y-3 border-t border-[var(--border)] pt-4">
                        <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><Loader2 size={16} className="shrink-0 animate-spin" /> {phaseLabel(progress)}</p>
                        {progress?.total ? <progress aria-label="Photo search progress" max={100} value={percent} className="h-1.5 w-full accent-[var(--accent)]" /> : null}
                    </div>
                )}
                {!isScanning && shownResult && !error && (
                    <div role="status" className="border-t border-[var(--border)] pt-4">
                        <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><ScanFace size={17} /> {shownResult.count ? `${shownResult.count} photos found` : 'No matching photos yet'}</p>
                        <p className="mt-1.5 text-xs leading-5 text-[var(--text-muted)]">{shownResult.count ? `From ${shownResult.total} gallery photos.` : 'Try a clearer, front-facing selfie or a wider match.'}</p>
                    </div>
                )}
                {error && <p role="alert" className="text-sm leading-5 text-rose-500">{error}</p>}

                <details className="border-t border-[var(--border)] pt-4">
                    <summary className="cursor-pointer text-xs font-semibold text-[var(--text-secondary)]"><SlidersHorizontal size={13} className="mx-1 inline" /> Match options</summary>
                    <div role="group" aria-label="Match sensitivity" className="mt-3 grid grid-cols-3 gap-1 rounded-md border border-[var(--border)] p-1">
                        {sensitivityOptions.map((option) => (
                            <button key={option.value} type="button" disabled={isScanning} aria-pressed={sensitivity === option.value} onClick={() => { setSensitivity(option.value); if (selfie) void runSearch(selfie.file, option.value); }} className={clsx(buttonFeedback, 'min-h-10 rounded px-2 text-xs font-semibold', sensitivity === option.value ? 'bg-[var(--accent)] text-[var(--bg-deep)]' : 'text-[var(--text-secondary)] enabled:hover:bg-[var(--bg-hover)]')}>{option.label}</button>
                        ))}
                    </div>
                    {selfie && !isScanning && <button type="button" onClick={() => void runSearch(selfie.file)} className={`${secondaryButton} mt-3 w-full`}><RefreshCcw size={14} /> Search again</button>}
                </details>
            </div>
        </GalleryModal>
    );
}
