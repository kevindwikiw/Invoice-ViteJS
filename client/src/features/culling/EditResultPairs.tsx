import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, ImageOff, Loader2, Search, X } from 'lucide-react';
import { getEditResultPairing } from './culling.admin';
import type { EditResultPair, EditResultPairing, PairingPhoto } from './culling.types';

const control = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 text-sm font-medium disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[var(--accent)]';

function Thumbnail({ photo }: { photo: PairingPhoto }) {
    const [failed, setFailed] = useState(false);
    return <span className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-[var(--bg-elevated)]">
        {photo.thumbnailUrl && !failed ? <img src={photo.thumbnailUrl} alt={photo.filename} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-contain" /> : <ImageOff size={24} aria-label="Thumbnail unavailable" />}
    </span>;
}

export function EditResultPairs({ galleryId, pairs, onApply }: { galleryId: number; pairs: EditResultPair[]; onApply: (pairs: EditResultPair[]) => void }) {
    const query = useQuery({ queryKey: ['edit-result-pairing', galleryId], queryFn: () => getEditResultPairing(galleryId), staleTime: 0, gcTime: 0, refetchOnWindowFocus: false, retry: false });
    if (query.isPending) return <p role="status" className="flex items-center gap-2 py-12"><Loader2 size={18} className="animate-spin" /> Loading Pairs...</p>;
    if (query.isError) return <div role="alert"><p>{query.error.message}</p><button type="button" className={control} onClick={() => void query.refetch()}>Retry</button></div>;
    return <PairEditor key={query.dataUpdatedAt} data={query.data} initialPairs={pairs} onApply={onApply} />;
}

function PairEditor({ data, initialPairs, onApply }: { data: EditResultPairing; initialPairs: EditResultPair[]; onApply: (pairs: EditResultPair[]) => void }) {
    const [confirmed, setConfirmed] = useState<Record<string, string>>(() => Object.fromEntries(initialPairs.filter((pair) => data.edited.some((p) => p.driveFileId === pair.editedDriveFileId) && data.submitted.some((p) => p.driveFileId === pair.beforeDriveFileId)).map((pair) => [pair.editedDriveFileId, pair.beforeDriveFileId])));
    const [suppressed, setSuppressed] = useState<Set<string>>(new Set());
    const [page, setPage] = useState(0);
    const [choosing, setChoosing] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [sourcePage, setSourcePage] = useState(0);
    const equalCounts = data.edited.length > 0 && data.edited.length === data.submitted.length;
    const suggestions = useMemo(() => equalCounts ? Object.fromEntries(data.edited.flatMap((photo, index) => confirmed[photo.driveFileId] || suppressed.has(photo.driveFileId) ? [] : [[photo.driveFileId, data.submitted[index]!.driveFileId]])) : {}, [data, equalCounts, confirmed, suppressed]);
    const sources = data.submitted.filter((p, index) => `${index + 1} ${p.filename}`.toLowerCase().includes(search.toLowerCase()));
    const selected = data.edited.find((p) => p.driveFileId === choosing);
    const confirm = (editedId: string, beforeId: string) => setConfirmed((current) => ({ ...current, [editedId]: beforeId }));
    const pageSize = 12;

    return <form id="edit-result-pairs-form" onSubmit={(event) => { event.preventDefault(); if (choosing) return; onApply(Object.entries(confirmed).map(([editedDriveFileId, beforeDriveFileId]) => ({ editedDriveFileId, beforeDriveFileId }))); }} className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-4">
            <p className="text-sm text-[var(--text-secondary)]">{Object.keys(confirmed).length} Confirmed <span className="text-[var(--text-muted)]">/ {data.edited.length} Edited</span></p>
            {!choosing && Object.keys(suggestions).length > 0 && <button type="button" className={control} onClick={() => setConfirmed((current) => ({ ...suggestions, ...current }))}><Check size={16} /> Confirm All ({Object.keys(suggestions).length})</button>}
        </div>
        {choosing ? <section aria-label="Choose Submitted Photo" className="space-y-4">
            <div className="flex items-center gap-3"><button type="button" className={control} onClick={() => setChoosing(null)} aria-label="Back to Pairs"><ChevronLeft size={18} /></button><h3 className="min-w-0 truncate text-sm font-semibold">{selected?.filename}</h3></div>
            <label className="flex min-h-11 items-center gap-2 rounded-md border border-[var(--border)] px-3"><Search size={16} /><input autoFocus aria-label="Search Submitted Photos" value={search} onChange={(e) => { setSearch(e.target.value); setSourcePage(0); }} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Name or photo number" /></label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {sources.slice(sourcePage * pageSize, (sourcePage + 1) * pageSize).map((photo) => <button key={photo.driveFileId} type="button" aria-label={`Use ${photo.filename}`} className="min-w-0 overflow-hidden rounded-md border border-[var(--border)] text-left focus-visible:outline-2 focus-visible:outline-[var(--accent)]" onClick={() => { confirm(choosing, photo.driveFileId); setChoosing(null); }}><Thumbnail photo={photo} /><span className="block truncate p-2 text-xs">#{data.submitted.indexOf(photo) + 1} {photo.filename}</span></button>)}
            </div>
            {!sources.length && <p className="py-8 text-center text-sm text-[var(--text-muted)]">No Submitted Photos Found</p>}
            <div className="flex justify-between"><button type="button" className={control} disabled={sourcePage === 0} onClick={() => setSourcePage((p) => p - 1)} aria-label="Previous Submitted Photos"><ChevronLeft size={18} /></button><button type="button" className={control} disabled={(sourcePage + 1) * pageSize >= sources.length} onClick={() => setSourcePage((p) => p + 1)} aria-label="Next Submitted Photos"><ChevronRight size={18} /></button></div>
        </section> : <>
            {!equalCounts && <p className="text-sm text-[var(--text-muted)]">{data.submitted.length} Submitted / {data.edited.length} Edited</p>}
            <div className="divide-y divide-[var(--border)]">
                {data.edited.slice(page * pageSize, (page + 1) * pageSize).map((photo) => {
                    const beforeId = confirmed[photo.driveFileId] || suggestions[photo.driveFileId];
                    const before = data.submitted.find((p) => p.driveFileId === beforeId);
                    return <article key={photo.driveFileId} className="py-4" aria-label={`Pair ${photo.filename}`}>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="min-w-0"><Thumbnail photo={photo} /><p className="mt-2 truncate text-xs font-semibold" title={photo.filename}>{photo.filename}</p><p className="mt-1 text-xs text-[var(--text-muted)]">Edited</p></div>
                            <div className="min-w-0">{before ? <Thumbnail key={before.driveFileId} photo={before} /> : <div className="flex aspect-[4/3] items-center justify-center bg-[var(--bg-elevated)] text-xs text-[var(--text-muted)]">No Before Photo</div>}<p className="mt-2 truncate text-xs" title={before?.filename}>{before ? `#${data.submitted.indexOf(before) + 1} ${before.filename}` : 'Unpaired'}</p><p className="mt-1 text-xs text-[var(--text-muted)]">{confirmed[photo.driveFileId] ? 'Confirmed' : before ? 'Suggested by Order' : 'No Comparison'}</p></div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" className={control} onClick={() => { setChoosing(photo.driveFileId); setSearch(''); setSourcePage(0); }}>Choose Before</button>
                            {!confirmed[photo.driveFileId] && before && <button type="button" className={control} onClick={() => confirm(photo.driveFileId, before.driveFileId)}><Check size={16} /> Confirm</button>}
                            {before && <button type="button" className={control} aria-label={`Remove pair for ${photo.filename}`} onClick={() => { setConfirmed((current) => { const next = { ...current }; delete next[photo.driveFileId]; return next; }); setSuppressed((current) => new Set(current).add(photo.driveFileId)); }}><X size={16} /></button>}
                        </div>
                    </article>;
                })}
            </div>
            <nav aria-label="Pairing Pages" className="flex items-center justify-between"><button type="button" className={control} disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous Pairs"><ChevronLeft size={18} /></button><span className="text-xs">{page + 1} / {Math.max(1, Math.ceil(data.edited.length / pageSize))}</span><button type="button" className={control} disabled={(page + 1) * pageSize >= data.edited.length} onClick={() => setPage((p) => p + 1)} aria-label="Next Pairs"><ChevronRight size={18} /></button></nav>
        </>}
    </form>;
}
