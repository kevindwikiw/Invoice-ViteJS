import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, ChevronLeft, ChevronRight, ImageOff, Loader2, Search, X } from 'lucide-react';
import { getEditResultPairing } from './culling.admin';
import type { EditResultPair, EditResultPairing, PairingPhoto } from './culling.types';

const control = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 text-sm font-medium hover:border-[var(--accent)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[var(--accent)]';
const pageSize = 12;

function Thumbnail({ photo }: { photo: PairingPhoto }) {
    const [failed, setFailed] = useState(false);
    return <span className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-[var(--bg-elevated)]">
        {photo.thumbnailUrl && !failed ? <img src={photo.thumbnailUrl} alt={photo.filename} width={photo.width || 400} height={photo.height || 300} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-contain" /> : <><ImageOff size={24} aria-hidden="true" /><span className="sr-only">Thumbnail unavailable</span></>}
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
    const [variants, setVariants] = useState<Set<string>>(() => initialVariants);
    const [suppressed, setSuppressed] = useState<Set<string>>(new Set());
    const [page, setPage] = useState(0);
    const [choosing, setChoosing] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [sourcePage, setSourcePage] = useState(0);
    const [pairingError, setPairingError] = useState('');
    const [announcement, setAnnouncement] = useState('');
    const [focusEditedId, setFocusEditedId] = useState<string | null>(null);
    const rowRefs = useRef(new Map<string, HTMLElement>());
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
                    sources[editedId] = initialMap[editedId] === anchor ? 'saved' : 'manual';
                }
                continue;
            }
            const suggestion = data.submitted[submittedIndex];
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
    }, [anchors, beforeIndexes, data.edited, data.submitted, initialMap, suppressed, validBeforeIds, variants]);

    const filteredSources = data.submitted.filter((photo, index) => `${index + 1} ${photo.filename}`.toLowerCase().includes(search.toLowerCase()));
    const selected = data.edited.find((photo) => photo.driveFileId === choosing);
    const appliedKey = useMemo(() => initialPairs.map((pair) => `${pair.editedDriveFileId}:${pair.beforeDriveFileId}`).sort().join('|'), [initialPairs]);
    const currentKey = Object.entries(resolved.pairs).map(([editedId, beforeId]) => `${editedId}:${beforeId}`).sort().join('|');
    const isDirty = currentKey !== appliedKey;
    const needsReview = data.edited.filter((photo) => !resolved.pairs[photo.driveFileId]);

    const clearAnchorsFrom = (index: number, replacement?: [string, string]) => setAnchors((current) => {
        const next = { ...current };
        for (const photo of data.edited.slice(index)) delete next[photo.driveFileId];
        if (replacement) next[replacement[0]] = replacement[1];
        return next;
    });

    const chooseBefore = (editedId: string, beforeId: string) => {
        const index = data.edited.findIndex((photo) => photo.driveFileId === editedId);
        clearAnchorsFrom(index, [editedId, beforeId]);
        setVariants((current) => { const next = new Set(current); next.delete(editedId); return next; });
        setSuppressed((current) => { const next = new Set(current); next.delete(editedId); return next; });
        setPairingError('');
        setAnnouncement(`${data.edited[index]?.filename || 'Edited photo'} paired manually. Following suggestions were realigned.`);
        setChoosing(null);
    };

    const toggleVariant = (editedId: string) => {
        const index = data.edited.findIndex((photo) => photo.driveFileId === editedId);
        const marking = !variants.has(editedId);
        clearAnchorsFrom(index);
        setVariants((current) => { const next = new Set(current); marking ? next.add(editedId) : next.delete(editedId); return next; });
        setSuppressed((current) => { const next = new Set(current); next.delete(editedId); return next; });
        setPairingError('');
        setAnnouncement(`${data.edited[index]?.filename || 'Edited photo'} ${marking ? 'marked as a B&W variant' : 'changed back to a standard edit'}. Following suggestions were realigned.`);
    };

    useEffect(() => {
        if (!focusEditedId) return;
        const frame = requestAnimationFrame(() => {
            rowRefs.current.get(focusEditedId)?.focus({ preventScroll: false });
            setFocusEditedId(null);
        });
        return () => cancelAnimationFrame(frame);
    }, [focusEditedId, page]);

    return <form id="edit-result-pairs-form" onSubmit={(event) => {
        event.preventDefault();
        if (choosing) return;
        if (needsReview.length) {
            const first = needsReview[0]!;
            setPairingError(`${needsReview.length} edited ${needsReview.length === 1 ? 'photo needs' : 'photos need'} a pair. Mark B&W variants so every edited photo has a Before photo.`);
            setPage(Math.floor(data.edited.findIndex((photo) => photo.driveFileId === first.driveFileId) / pageSize));
            setFocusEditedId(first.driveFileId);
            return;
        }
        onApply(Object.entries(resolved.pairs).map(([editedDriveFileId, beforeDriveFileId]) => ({ editedDriveFileId, beforeDriveFileId })));
    }} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
                <div><dt className="inline text-[var(--text-muted)]">Submitted </dt><dd className="inline font-semibold">{data.submitted.length}</dd></div>
                <div><dt className="inline text-[var(--text-muted)]">Edited </dt><dd className="inline font-semibold">{data.edited.length}</dd></div>
                <div><dt className="inline text-[var(--text-muted)]">Paired </dt><dd className="inline font-semibold text-emerald-500">{Object.keys(resolved.pairs).length}</dd></div>
                <div><dt className="inline text-[var(--text-muted)]">B&W </dt><dd className="inline font-semibold">{variants.size}</dd></div>
                <div><dt className="inline text-[var(--text-muted)]">Needs Review </dt><dd className="inline font-semibold text-amber-500">{needsReview.length}</dd></div>
            </dl>
            <span role="status" aria-live="polite" className="text-xs text-[var(--text-muted)]">{isDirty ? 'Pairing changes not applied' : 'Pairing changes applied'}</span>
        </div>
        <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
        {pairingError && <p role="alert" className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">{pairingError}</p>}

        {choosing ? <section aria-label="Choose Submitted Photo" className="space-y-4">
            <div className="flex items-center gap-3"><button type="button" className={control} onClick={() => setChoosing(null)} aria-label="Back to Pairs"><ChevronLeft size={18} aria-hidden="true" /></button><h3 className="min-w-0 truncate text-sm font-semibold">{selected?.filename}</h3></div>
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
                    const status = source === 'variant' ? 'B&W variant · Same Before as above' : source === 'saved' ? 'Saved pair' : source === 'manual' ? 'Selected manually' : source === 'auto' ? 'Auto-paired by order' : 'Needs review';
                    const canMarkVariant = editedIndex > 0 && Boolean(resolved.pairs[data.edited[editedIndex - 1]!.driveFileId]);
                    return <article key={photo.driveFileId} ref={(element) => { if (element) rowRefs.current.set(photo.driveFileId, element); else rowRefs.current.delete(photo.driveFileId); }} tabIndex={-1} className="scroll-mt-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]" aria-label={`Pair ${photo.filename}`}>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="min-w-0"><Thumbnail photo={photo} /><p className="mt-2 truncate text-xs font-semibold" title={photo.filename}>{photo.filename}</p><p className="mt-1 text-xs text-[var(--text-muted)]">Edited</p></div>
                            <div className="min-w-0">{before ? <Thumbnail key={before.driveFileId} photo={before} /> : <div className="flex aspect-[4/3] items-center justify-center bg-[var(--bg-elevated)] px-3 text-center text-xs text-[var(--text-muted)]">No Before Photo</div>}<p className="mt-2 truncate text-xs" title={before?.filename}>{before ? `#${data.submitted.indexOf(before) + 1} ${before.filename}` : 'Unpaired'}</p><p className={source ? 'mt-1 text-xs text-[var(--text-muted)]' : 'mt-1 text-xs font-semibold text-amber-500'}>{status}</p></div>
                        </div>
                        {!before && <p className="mt-3 text-xs leading-5 text-amber-500">No source photo left. Mark the matching B&W version above to realign these pairs.</p>}
                        <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" className={control} onClick={() => { setChoosing(photo.driveFileId); setSearch(''); setSourcePage(0); }}>Choose Before</button>
                            <button type="button" aria-pressed={variants.has(photo.driveFileId)} disabled={!variants.has(photo.driveFileId) && !canMarkVariant} title={!variants.has(photo.driveFileId) && !canMarkVariant ? 'A B&W variant needs a paired edited photo above it.' : undefined} className={clsx(control, variants.has(photo.driveFileId) && 'border-[var(--accent)] bg-[var(--bg-elevated)] text-[var(--accent)]')} onClick={() => toggleVariant(photo.driveFileId)}><Check size={16} aria-hidden="true" /> B&W Variant</button>
                            {before && <button type="button" className={control} aria-label={`Remove pair for ${photo.filename}`} onClick={() => { clearAnchorsFrom(editedIndex); setVariants((current) => { const next = new Set(current); next.delete(photo.driveFileId); return next; }); setSuppressed((current) => new Set(current).add(photo.driveFileId)); setPairingError(''); }}><X size={16} aria-hidden="true" /></button>}
                        </div>
                    </article>;
                })}
            </div>
            <nav aria-label="Pairing Pages" className="flex items-center justify-between"><button type="button" className={control} disabled={page === 0} onClick={() => setPage((current) => current - 1)} aria-label="Previous Pairs"><ChevronLeft size={18} aria-hidden="true" /></button><span className="text-xs tabular-nums">{page + 1} / {Math.max(1, Math.ceil(data.edited.length / pageSize))}</span><button type="button" className={control} disabled={(page + 1) * pageSize >= data.edited.length} onClick={() => setPage((current) => current + 1)} aria-label="Next Pairs"><ChevronRight size={18} aria-hidden="true" /></button></nav>
        </>}
    </form>;
}
