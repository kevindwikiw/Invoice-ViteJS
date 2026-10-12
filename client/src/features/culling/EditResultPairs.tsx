import { useMemo, useState, useTransition } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, ChevronLeft, ChevronRight, ImageOff, Loader2, RotateCcw, Search, X } from 'lucide-react';
import { getEditResultPairing } from './culling.admin';
import type { EditResultPair, EditResultPairing, PairingPhoto } from './culling.types';

const control = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 text-sm font-medium hover:border-[var(--accent)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[var(--accent)]';
const pageSize = 12;

function Thumbnail({ photo }: { photo: PairingPhoto }) {
    const [attempt, setAttempt] = useState(0);
    const [failed, setFailed] = useState(false);
    const [loading, setLoading] = useState(Boolean(photo.thumbnailUrl));
    const retry = () => {
        setFailed(false);
        setLoading(true);
        setAttempt((current) => current + 1);
    };
    const thumbnailUrl = photo.thumbnailUrl
        ? `${photo.thumbnailUrl}${photo.thumbnailUrl.includes('?') ? '&' : '?'}pairRetry=${attempt}`
        : null;
    return <span className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-[var(--bg-elevated)]">
        {thumbnailUrl && !failed ? <img
            key={thumbnailUrl}
            src={thumbnailUrl}
            alt={photo.filename}
            width={photo.width || 400}
            height={photo.height || 300}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setLoading(false)}
            onError={() => {
                if (attempt === 0) retry();
                else {
                    setLoading(false);
                    setFailed(true);
                }
            }}
            className="h-full w-full object-contain"
        /> : <span role="status" aria-live="polite" className="flex min-h-11 flex-col items-center justify-center gap-2 px-3 text-center text-xs text-[var(--text-muted)]">
            <ImageOff size={22} aria-hidden="true" />
            <span>Thumbnail unavailable</span>
            {photo.thumbnailUrl ? <button
                type="button"
                onClick={retry}
                aria-label={`Retry thumbnail for ${photo.filename}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[var(--border)] px-3 font-medium text-[var(--text)] hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
                <RotateCcw size={15} aria-hidden="true" /> Retry
            </button> : null}
        </span>}
        {loading && !failed ? <span role="status" className="absolute inset-0 flex items-center justify-center bg-[var(--bg-elevated)]/80">
            <Loader2 size={20} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
            <span className="sr-only">Loading thumbnail for {photo.filename}</span>
        </span> : null}
    </span>;
}

export function EditResultPairs({ galleryId, pairs, onApply }: { galleryId: number; pairs: EditResultPair[]; onApply: (pairs: EditResultPair[]) => void }) {
    const query = useQuery({ queryKey: ['edit-result-pairing', galleryId], queryFn: () => getEditResultPairing(galleryId), staleTime: 0, gcTime: 0, refetchOnWindowFocus: false, retry: false });
    if (query.isPending) return <p role="status" className="flex items-center gap-2 py-12"><Loader2 size={18} aria-hidden="true" className="animate-spin" /> Loading pairs…</p>;
    if (query.isError) return <div role="alert"><p>{query.error.message}</p><button type="button" className={control} onClick={() => void query.refetch()}>Retry</button></div>;
    return <PairEditor key={query.dataUpdatedAt} data={query.data} initialPairs={pairs} onApply={onApply} />;
}

function PairEditor({ data, initialPairs, onApply }: { data: EditResultPairing; initialPairs: EditResultPair[]; onApply: (pairs: EditResultPair[]) => void }) {
    const validEditedIds = useMemo(() => new Set(data.edited.map((photo) => photo.driveFileId)), [data.edited]);
    const validBeforeIds = useMemo(() => new Set(data.submitted.map((photo) => photo.driveFileId)), [data.submitted]);
    const initialMap = useMemo<Record<string, string>>(() => Object.fromEntries(initialPairs
        .filter((pair) => validEditedIds.has(pair.editedDriveFileId) && validBeforeIds.has(pair.beforeDriveFileId))
        .map((pair) => [pair.editedDriveFileId, pair.beforeDriveFileId])), [initialPairs, validBeforeIds, validEditedIds]);
    const initialVariants = useMemo(() => new Set(data.edited.flatMap((photo, index) => (
        index > 0 && initialMap[photo.driveFileId] && initialMap[photo.driveFileId] === initialMap[data.edited[index - 1]!.driveFileId]
            ? [photo.driveFileId]
            : []
    ))), [data.edited, initialMap]);
    const [anchors, setAnchors] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(initialMap).filter(([editedId]) => !initialVariants.has(editedId))));
    const [manualAnchorIds, setManualAnchorIds] = useState<Set<string>>(() => new Set());
    const [variants, setVariants] = useState<Set<string>>(() => initialVariants);
    const [suppressed, setSuppressed] = useState<Set<string>>(() => new Set(data.comparisonEnabled
        ? data.edited.filter((photo) => !initialMap[photo.driveFileId]).map((photo) => photo.driveFileId)
        : []));
    const [page, setPage] = useState(0);
    const [choosing, setChoosing] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [sourcePage, setSourcePage] = useState(0);
    const [announcement, setAnnouncement] = useState('');
    const [sourceLimit, setSourceLimit] = useState(data.submitted.length);
    const [activePreset, setActivePreset] = useState<'first10' | 'all' | null>(null);
    const [isPairing, startPairing] = useTransition();
    const beforeIndexes = useMemo(() => new Map(data.submitted.map((photo, index) => [photo.driveFileId, index])), [data.submitted]);

    const resolved = useMemo(() => {
        const pairs: Record<string, string> = {};
        const sources: Record<string, 'saved' | 'manual' | 'auto' | 'variant'> = {};
        let submittedIndex = 0;
        let previousBeforeId: string | null = null;
        for (const photo of data.edited) {
            const editedId = photo.driveFileId;
            if (variants.has(editedId)) {
                if (previousBeforeId && !suppressed.has(editedId)) {
                    pairs[editedId] = previousBeforeId;
                    sources[editedId] = 'variant';
                }
                continue;
            }
            const anchor = anchors[editedId];
            if (anchor && validBeforeIds.has(anchor)) {
                previousBeforeId = anchor;
                submittedIndex = Math.max(submittedIndex, (beforeIndexes.get(anchor) ?? -1) + 1);
                if (!suppressed.has(editedId)) {
                    pairs[editedId] = anchor;
                    sources[editedId] = manualAnchorIds.has(editedId) ? 'manual' : initialMap[editedId] === anchor ? 'saved' : 'manual';
                }
                continue;
            }
            const suggestion = submittedIndex < sourceLimit ? data.submitted[submittedIndex] : undefined;
            if (!suggestion) {
                previousBeforeId = null;
                continue;
            }
            submittedIndex += 1;
            previousBeforeId = suggestion.driveFileId;
            if (!suppressed.has(editedId)) {
                pairs[editedId] = suggestion.driveFileId;
                sources[editedId] = initialMap[editedId] === suggestion.driveFileId ? 'saved' : 'auto';
            }
        }
        return { pairs, sources };
    }, [anchors, beforeIndexes, data.edited, data.submitted, initialMap, manualAnchorIds, sourceLimit, suppressed, validBeforeIds, variants]);

    const filteredSources = data.submitted.slice(0, sourceLimit).filter((photo, index) => `${index + 1} ${photo.filename}`.toLowerCase().includes(search.toLowerCase()));
    const selected = data.edited.find((photo) => photo.driveFileId === choosing);
    const appliedKey = useMemo(() => initialPairs.map((pair) => `${pair.editedDriveFileId}:${pair.beforeDriveFileId}`).sort().join('|'), [initialPairs]);
    const currentKey = Object.entries(resolved.pairs).map(([editedId, beforeId]) => `${editedId}:${beforeId}`).sort().join('|');
    const isDirty = currentKey !== appliedKey;
    const withoutBefore = data.edited.filter((photo) => !resolved.pairs[photo.driveFileId]);
    const extraEdited = Math.max(0, data.edited.length - data.submitted.length);
    const pageCount = Math.max(1, Math.ceil(data.edited.length / pageSize));

    const applyPreset = (preset: 'first10' | 'all') => {
        startPairing(() => {
            setAnchors({});
            setManualAnchorIds(new Set());
            setSuppressed(new Set());
            setSourceLimit(preset === 'first10' ? Math.min(10, data.submitted.length) : data.submitted.length);
            setActivePreset(preset);
        });
        setAnnouncement(preset === 'first10'
            ? 'First 10 sources suggested. B&W variants remain marked; review the pairs before applying.'
            : 'All sources suggested. B&W variants remain marked; review the pairs before applying.');
    };

    const changePairPage = (nextPage: number) => {
        const boundedPage = Math.min(pageCount - 1, Math.max(0, nextPage));
        setPage(boundedPage);
        const first = boundedPage * pageSize + 1;
        const last = Math.min(data.edited.length, first + pageSize - 1);
        setAnnouncement(`Page ${boundedPage + 1} of ${pageCount}. Showing edited photos ${first} to ${last}.`);
    };

    const realignGeneratedAnchorsFrom = (index: number, replacement?: [string, string]) => setAnchors((current) => {
        const next = { ...current };
        data.edited.slice(index).forEach((photo, offset) => {
            if (offset === 0 || !manualAnchorIds.has(photo.driveFileId)) delete next[photo.driveFileId];
        });
        if (replacement) next[replacement[0]] = replacement[1];
        return next;
    });

    const chooseBefore = (editedId: string, beforeId: string) => {
        const index = data.edited.findIndex((photo) => photo.driveFileId === editedId);
        realignGeneratedAnchorsFrom(index, [editedId, beforeId]);
        setManualAnchorIds((current) => new Set(current).add(editedId));
        setVariants((current) => { const next = new Set(current); next.delete(editedId); return next; });
        setSuppressed((current) => { const next = new Set(current); next.delete(editedId); return next; });
        setAnnouncement(`${data.edited[index]?.filename || 'Edited photo'} paired manually. Following suggestions were realigned.`);
        setChoosing(null);
    };

    const toggleVariant = (editedId: string) => {
        const index = data.edited.findIndex((photo) => photo.driveFileId === editedId);
        const marking = !variants.has(editedId);
        realignGeneratedAnchorsFrom(index);
        setManualAnchorIds((current) => { const next = new Set(current); next.delete(editedId); return next; });
        setVariants((current) => { const next = new Set(current); marking ? next.add(editedId) : next.delete(editedId); return next; });
        setSuppressed((current) => { const next = new Set(current); next.delete(editedId); return next; });
        setAnnouncement(`${data.edited[index]?.filename || 'Edited photo'} ${marking ? 'marked as a B&W variant' : 'changed back to a standard edit'}. Following suggestions were realigned. ${marking ? variants.size + 1 : variants.size - 1} B&W variants marked.`);
    };

    return <form id="edit-result-pairs-form" onSubmit={(event) => {
        event.preventDefault();
        if (choosing) return;
        onApply(Object.entries(resolved.pairs).map(([editedDriveFileId, beforeDriveFileId]) => ({ editedDriveFileId, beforeDriveFileId })));
    }} className="space-y-4">
        <section aria-label="Auto Pair" className="border-b border-[var(--border)] pb-4">
            <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-xs font-semibold uppercase text-[var(--text-secondary)]">Auto Pair</h3>
                <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={isPairing || !data.submitted.length} className={control} onClick={() => applyPreset('first10')}>First 10 Sources</button>
                    <button type="button" disabled={isPairing || !data.submitted.length} className={control} onClick={() => applyPreset('all')}>All Sources</button>
                </div>
                {isPairing && <span role="status" className="text-xs text-[var(--text-muted)]">Pairing…</span>}
            </div>
            {activePreset && <p role="status" aria-live="polite" className="mt-2 text-xs font-medium text-[var(--text-secondary)]">{activePreset === 'first10' ? 'Using suggestions for the first 10 sources.' : 'Using suggestions for all sources.'}</p>}
            {extraEdited > 0 && <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{activePreset === 'first10' ? 'Mark B&W variants within the first 10 sources. Remaining edited photos stay Edited Only.' : `${extraEdited} extra edited photos. Mark their B&W variants to keep the order aligned.`}</p>}
        </section>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
                <div><dt className="inline text-[var(--text-muted)]">Submitted </dt><dd className="inline font-semibold">{data.submitted.length}</dd></div>
                <div><dt className="inline text-[var(--text-muted)]">Edited </dt><dd className="inline font-semibold">{data.edited.length}</dd></div>
                <div><dt className="inline text-[var(--text-muted)]">Paired </dt><dd className="inline font-semibold text-emerald-500">{Object.keys(resolved.pairs).length}</dd></div>
                <div><dt className="inline text-[var(--text-muted)]">B&W </dt><dd className="inline font-semibold">{variants.size}</dd></div>
                <div><dt className="inline text-[var(--text-muted)]">Edited Only </dt><dd className="inline font-semibold">{withoutBefore.length}</dd></div>
            </dl>
            <span role="status" aria-live="polite" className="text-xs text-[var(--text-muted)]">{isDirty ? 'Pairing changes not applied' : 'Pairing changes applied'}</span>
        </div>
        <span role="status" aria-live="polite" className="sr-only">{announcement}</span>

        {!data.edited.length ? <section role="status" className="py-10 text-center">
            <h3 className="text-sm font-semibold">No Edited Photos Found</h3>
            <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Sync the Edited Photos folder, then reopen Manage Pairs.</p>
        </section> : !data.submitted.length ? <section role="status" className="py-10 text-center">
            <h3 className="text-sm font-semibold">No Submitted Photos Found</h3>
            <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">The client must submit a photo selection before comparison pairs can be created.</p>
        </section> : choosing ? <section aria-label="Choose Submitted Photo" className="space-y-4">
            <div className="flex items-center gap-3"><button type="button" className={control} onClick={() => setChoosing(null)} aria-label="Back to Pairs"><ChevronLeft size={18} aria-hidden="true" /></button><h3 className="min-w-0 truncate text-sm font-semibold">{selected?.filename}</h3></div>
            {activePreset === 'first10' && <p className="text-xs text-[var(--text-muted)]">Showing the first 10 submitted photos for this preset.</p>}
            <label className="flex min-h-11 items-center gap-2 rounded-md border border-[var(--border)] px-3 focus-within:border-[var(--accent)]"><Search size={16} aria-hidden="true" /><input name="submitted-photo-search" autoComplete="off" aria-label="Search Submitted Photos" value={search} onChange={(event) => { setSearch(event.target.value); setSourcePage(0); }} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Name or photo number…" /></label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {filteredSources.slice(sourcePage * pageSize, (sourcePage + 1) * pageSize).map((photo) => <button key={photo.driveFileId} type="button" aria-label={`Use ${photo.filename}`} className="min-w-0 overflow-hidden rounded-md border border-[var(--border)] text-left hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]" onClick={() => choosing && chooseBefore(choosing, photo.driveFileId)}><Thumbnail photo={photo} /><span className="block truncate p-2 text-xs">#{data.submitted.indexOf(photo) + 1} {photo.filename}</span></button>)}
            </div>
            {!filteredSources.length && <p className="py-8 text-center text-sm text-[var(--text-muted)]">No Submitted Photos Found</p>}
            <div className="flex justify-between"><button type="button" className={control} disabled={sourcePage === 0} onClick={() => setSourcePage((current) => current - 1)} aria-label="Previous Submitted Photos"><ChevronLeft size={18} aria-hidden="true" /></button><button type="button" className={control} disabled={(sourcePage + 1) * pageSize >= filteredSources.length} onClick={() => setSourcePage((current) => current + 1)} aria-label="Next Submitted Photos"><ChevronRight size={18} aria-hidden="true" /></button></div>
        </section> : <>
            <div className="divide-y divide-[var(--border)]">
                {data.edited.slice(page * pageSize, (page + 1) * pageSize).map((photo) => {
                    const editedIndex = data.edited.indexOf(photo);
                    const beforeId = resolved.pairs[photo.driveFileId];
                    const before = data.submitted.find((candidate) => candidate.driveFileId === beforeId);
                    const source = resolved.sources[photo.driveFileId];
                    const status = source === 'variant' ? 'B&W variant · Same Before as above' : source === 'saved' ? 'Saved pair' : source === 'manual' ? 'Selected manually' : source === 'auto' ? 'Auto-paired by order' : 'Edited only · No Before / After';
                    const canMarkVariant = editedIndex > 0 && Boolean(resolved.pairs[data.edited[editedIndex - 1]!.driveFileId]);
                    return <article key={photo.driveFileId} className="py-4" aria-label={`Pair ${photo.filename}`}>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="min-w-0"><Thumbnail photo={photo} /><p className="mt-2 truncate text-xs font-semibold" title={photo.filename}>{photo.filename}</p><p className="mt-1 text-xs text-[var(--text-muted)]">Edited</p></div>
                            <div className="min-w-0">{before ? <Thumbnail key={before.driveFileId} photo={before} /> : <div className="flex aspect-[4/3] items-center justify-center bg-[var(--bg-elevated)] px-3 text-center text-xs text-[var(--text-muted)]">No Before Photo</div>}<p className="mt-2 truncate text-xs" title={before?.filename}>{before ? `#${data.submitted.indexOf(before) + 1} ${before.filename}` : 'Unpaired'}</p><p className={source ? 'mt-1 text-xs text-[var(--text-muted)]' : 'mt-1 text-xs font-semibold text-amber-500'}>{status}</p></div>
                        </div>
                        {!before && <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">This photo will be published without Before / After.</p>}
                        <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" className={control} onClick={() => { setChoosing(photo.driveFileId); setSearch(''); setSourcePage(0); }}>Choose Before</button>
                            <button type="button" aria-pressed={variants.has(photo.driveFileId)} disabled={!variants.has(photo.driveFileId) && !canMarkVariant} title={!variants.has(photo.driveFileId) && !canMarkVariant ? 'A B&W variant needs a paired edited photo above it.' : undefined} className={clsx(control, variants.has(photo.driveFileId) && 'border-[var(--accent)] bg-[var(--bg-elevated)] text-[var(--accent)]')} onClick={() => toggleVariant(photo.driveFileId)}><Check size={16} aria-hidden="true" /> B&W Variant</button>
                            {before && <button type="button" className={control} aria-label={`Remove pair for ${photo.filename}`} onClick={() => { realignGeneratedAnchorsFrom(editedIndex); setManualAnchorIds((current) => { const next = new Set(current); next.delete(photo.driveFileId); return next; }); setVariants((current) => { const next = new Set(current); next.delete(photo.driveFileId); return next; }); setSuppressed((current) => new Set(current).add(photo.driveFileId)); setAnnouncement(`${photo.filename} will be published without Before / After.`); }}><X size={16} aria-hidden="true" /></button>}
                        </div>
                    </article>;
                })}
            </div>
            <nav aria-label="Pairing Pages" className="flex items-center justify-between"><button type="button" className={control} disabled={page === 0} onClick={() => changePairPage(page - 1)} aria-label="Previous Pairs"><ChevronLeft size={18} aria-hidden="true" /></button><span role="status" aria-live="polite" className="text-xs tabular-nums">{page + 1} / {pageCount}</span><button type="button" className={control} disabled={(page + 1) * pageSize >= data.edited.length} onClick={() => changePairPage(page + 1)} aria-label="Next Pairs"><ChevronRight size={18} aria-hidden="true" /></button></nav>
        </>}
    </form>;
}
