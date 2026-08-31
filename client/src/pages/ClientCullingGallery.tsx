import { useEffect, useMemo, useState, useCallback, memo, type CSSProperties } from 'react';
import { useParams } from '@tanstack/react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, CheckSquare, ChevronLeft, ChevronRight, HelpCircle, ImageIcon, Instagram, Loader2, Lock, MessageCircle, Moon, Send, Sun, X } from 'lucide-react';
import clsx from 'clsx';

import orbitLogo from '../assets/pdf/logo.png';

import {
    calculateAddonQuote,
    galleryPreviewUrl,
    galleryThumbnailUrl,
    getPublicGalleryPhotos,
    submitGallerySelections,
    verifyGalleryPin,
    type GalleryPhoto,
    type PublicGallery,
} from '../features/culling/data';

function tokenKey(galleryId: string): string {
    return `orbit_culling_token_${galleryId}`;
}

function draftKey(galleryId: string): string {
    return `orbit_culling_selected_${galleryId}`;
}

function notesKey(galleryId: string): string {
    return `orbit_culling_notes_${galleryId}`;
}
function tutorialKey(galleryId: string): string { return `orbit_culling_tutorial_${galleryId}`; }

type GalleryTheme = 'black' | 'white';
type GalleryContactSettings = { contactWhatsappUrl?: string; message?: string; requestMoreMessage?: string };

const idrFormat = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

function galleryThemeKey(galleryId: string): string {
    return `orbit_culling_theme_${galleryId}`;
}

function readGalleryTheme(galleryId: string): GalleryTheme {
    return localStorage.getItem(galleryThemeKey(galleryId)) === 'white' ? 'white' : 'black';
}

const BLACK_THEME = {
    '--bg-deep': '#050505',
    '--bg-card': '#0d0d0d',
    '--bg-elevated': '#171717',
    '--bg-hover': '#242424',
    '--text-primary': '#ffffff',
    '--text-secondary': '#e5e5e5',
    '--text-muted': '#999999',
    '--border': '#2a2a2a',
    '--accent': '#ffffff',
    '--accent-muted': 'rgba(255, 255, 255, 0.12)',
} as CSSProperties;

const WHITE_THEME = {
    '--bg-deep': '#f7f7f5',
    '--bg-card': '#ffffff',
    '--bg-elevated': '#eeeeeb',
    '--bg-hover': '#e5e5e1',
    '--text-primary': '#111111',
    '--text-secondary': '#444444',
    '--text-muted': '#777777',
    '--border': '#d8d8d3',
    '--accent': '#111111',
    '--accent-muted': 'rgba(17, 17, 17, 0.10)',
} as CSSProperties;

const OrbitLogo = memo(function OrbitLogo({ 
    className = "", 
    theme = 'black' 
}: { 
    className?: string; 
    theme?: GalleryTheme 
}) {
    const isInverted = theme === 'white';

    return (
        <div className={`flex items-center shrink-0 ${className}`}>
            <img
                src={orbitLogo}
                alt="Orbit Logo"
                className="h-auto w-24 object-contain sm:w-28 lg:w-30"
                style={{ filter: isInverted ? 'invert(1)' : 'none' }}
            />
        </div>
    );
});

function ThemeToggle({ theme, onToggle }: { theme: GalleryTheme; onToggle: () => void }) {
    const nextTheme = theme === 'black' ? 'white' : 'black';
    return (
        <button type="button" onClick={onToggle} title={`Switch to ${nextTheme} mode`} aria-label={`Switch to ${nextTheme} mode`} className="flex h-8.5 w-8.5 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]">
            {theme === 'black' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
    );
}

function readSelectionDraft(galleryId: string): string[] {
    try {
        const raw = localStorage.getItem(draftKey(galleryId));
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

function readNotesDraft(galleryId: string): Record<string, string> {
    try {
        const parsed = JSON.parse(localStorage.getItem(notesKey(galleryId)) || '{}');
        return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
    } catch { return {}; }
}

const PhotoTile = memo(function PhotoTile({
    photo,
    selected,
    token,
    galleryId,
    index,
    onOpen,
    onToggle,
}: {
    photo: GalleryPhoto;
    selected: boolean;
    token: string;
    galleryId: string;
    index: number;
    onOpen: (index: number) => void;
    onToggle: (driveFileId: string) => void;
}) {
    return (
        <article className={clsx('group relative aspect-[4/3] overflow-hidden bg-[var(--bg-card)] transition-transform duration-200 hover:-translate-y-0.5', selected && 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg-deep)]')}>
            <button type="button" onClick={() => onOpen(index)} className="h-full w-full bg-[var(--bg-card)] text-left" aria-label={`Open ${photo.filename}`}>
                <img
                    src={galleryThumbnailUrl(galleryId, photo.driveFileId, token)}
                    alt={photo.filename}
                    loading="lazy"
                    className="h-full w-full object-cover opacity-0 transition-[opacity,transform] duration-500 group-hover:scale-[1.035]"
                    onLoad={(event) => event.currentTarget.classList.remove('opacity-0')}
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent p-3">
                    <p className="truncate text-[10px] font-semibold text-white">{photo.filename}</p>
                    <p className="mt-1 text-[8px] font-bold uppercase tracking-[0.16em] text-white/55">#{String(index + 1).padStart(3, '0')}</p>
                </div>
                <div className={clsx('pointer-events-none absolute inset-0 bg-[var(--accent-muted)] transition-opacity duration-200', selected ? 'opacity-100' : 'opacity-0')} />
            </button>
            <button
                type="button"
                onClick={() => onToggle(photo.driveFileId)}
                aria-pressed={selected}
                className={clsx('absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur transition-all duration-200', selected ? 'scale-105 border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]' : 'scale-100 border-white/35 bg-black/45 text-white/75 hover:border-white/70 hover:bg-black/60 hover:text-white')}
                aria-label={selected ? `Remove ${photo.filename}` : `Select ${photo.filename}`}
            >
                {selected ? <X size={14} strokeWidth={3} className="transition-transform duration-200" /> : <Check size={14} strokeWidth={3} className="transition-transform duration-200" />}
            </button>
        </article>
    );
});

function PinGate({
    galleryId,
    onUnlocked,
    theme,
    onToggleTheme,
}: {
    galleryId: string;
    onUnlocked: (token: string, gallery: PublicGallery) => void;
    theme: GalleryTheme;
    onToggleTheme: () => void;
}) {
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [contactUrl, setContactUrl] = useState<string | null>(null);
    const [isClosed, setIsClosed] = useState(false);
    const [isRateLimited, setIsRateLimited] = useState(false);
    
    const verifyMutation = useMutation({
        mutationFn: () => verifyGalleryPin(galleryId, pin),
        onSuccess: (data) => {
            localStorage.setItem(tokenKey(galleryId), data.token);
            onUnlocked(data.token, data.gallery);
        },
        onError: (mutationError) => {
            setError(mutationError instanceof Error ? mutationError.message : 'Unable to unlock gallery.');
            const galleryError = mutationError as Error & { code?: string; contactUrl?: string | null; status?: number };
            if (galleryError.code === 'GALLERY_CLOSED') {
                setContactUrl(galleryError.contactUrl || null);
                setIsClosed(true);
            }
            if (galleryError.status === 429) {
                setIsRateLimited(true);
                setError('PIN access is temporarily locked. Please contact the admin to unlock it.');
                fetch(`/api/public/galleries/${galleryId}/contact`).then((response) => response.ok ? response.json() : null).then((settings: { contactWhatsappUrl?: string; message?: string; requestMoreMessage?: string } | null) => {
                    if (settings?.contactWhatsappUrl) {
                        const text = (settings.message || 'Halo Kak Admin Orbit ✨\nSaya ingin meminta bantuan untuk membuka client gallery saya yaa.').replaceAll('{{gallery_url}}', window.location.href).replaceAll('{{gallery_title}}', galleryId);
                        setContactUrl(`https://wa.me/${settings.contactWhatsappUrl.replace(/\D/g, '').replace(/^0/, '62')}?text=${encodeURIComponent(text)}`);
                    }
                }).catch(() => undefined);
            }
        },
    });

    return (
        <main style={theme === 'black' ? BLACK_THEME : WHITE_THEME} className="min-h-screen bg-[var(--bg-deep)] font-sans text-[var(--text-primary)]">
            <div className="absolute right-5 top-5"><ThemeToggle theme={theme} onToggle={onToggleTheme} /></div>
            <section className="flex min-h-screen items-center justify-center px-5 py-12">
                <form
                    onSubmit={(event) => {
                        event.preventDefault();
                        setError('');
                        setContactUrl(null);
                        setIsRateLimited(false);
                        verifyMutation.mutate();
                    }}
                    className="w-full max-w-sm border border-[var(--border)] bg-[var(--bg-card)] px-6 py-10 text-center shadow-2xl"
                >
                    <div className="mb-6 flex justify-center">
                        <OrbitLogo theme={theme} />
                    </div>

                    <p className="label-xs text-[var(--accent)]">PRIVATE CLIENT GALLERY</p>
                    <h1 className="mt-3 font-display text-2xl font-medium text-[var(--text-primary)]">{isClosed ? 'Gallery Locked' : isRateLimited ? 'Access Locked' : 'Enter PIN'}</h1>
                    
                    {!isClosed && !isRateLimited && <input value={pin} onChange={(event) => setPin(event.target.value)} autoFocus placeholder="Gallery PIN" className="mt-7 h-11 rounded-lg bg-[var(--bg-deep)] px-4 text-center text-base tracking-[0.2em]" />}
                    {error && !isClosed && !isRateLimited && <p className="mt-4 text-xs leading-5 text-rose-400">{error}</p>}
                    {contactUrl && <a href={contactUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg border border-[var(--border)] text-xs font-bold text-[var(--text-primary)] hover:border-[var(--accent)]">Contact admin on WhatsApp</a>}
                    
                    {(isClosed || isRateLimited) ? (
                        <p className="mt-6 text-xs leading-5 text-[var(--text-muted)]">{isClosed ? 'This gallery is currently locked. Please contact the admin to unlock access.' : 'Too many PIN attempts. Please contact the admin to unlock access.'}</p>
                    ) : (
                        <button type="submit" disabled={verifyMutation.isPending || pin.length < 4} className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] text-[10px] font-black uppercase tracking-[0.14em] text-[var(--bg-deep)] transition-opacity disabled:opacity-45">
                            {verifyMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
                            Unlock gallery
                        </button>
                    )}
                </form>
            </section>
        </main>
    );
}

function RequestMoreModal({
    requestedCount,
    selectedCount,
    unitPrice,
    requestUrl,
    onChange,
    onClose,
}: {
    requestedCount: number;
    selectedCount: number;
    unitPrice: number;
    requestUrl: string;
    onChange: (count: number) => void;
    onClose: () => void;
}) {
    const quote = calculateAddonQuote(requestedCount, unitPrice);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true" aria-label="Request more edited photos" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <section className="w-full max-w-sm border border-[var(--border)] bg-[var(--bg-card)] p-5 text-[var(--text-primary)] shadow-2xl">
                <header className="flex items-start justify-between gap-4">
                    <div>
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">EDITING ADD-ON</p>
                        <h2 className="mt-1 font-display text-xl">Keep More Favorites</h2>
                        <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Choose how many additional photos you want Orbit to edit.</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close request more dialog" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] hover:border-[var(--accent)]"><X size={14} /></button>
                </header>

                <div className="mt-5 grid grid-cols-3 gap-2">
                    {[5, 10, 20].map((count) => {
                        const packageQuote = calculateAddonQuote(count, unitPrice);
                        const selected = requestedCount === count;
                        return (
                            <button key={count} type="button" onClick={() => onChange(count)} className={clsx('relative flex min-h-[70px] flex-col items-center justify-center rounded-lg border px-1.5 py-2 transition-[border-color,background-color,color,transform] hover:-translate-y-0.5', selected ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]' : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)]')}>
                                {count === 10 && <span className={clsx('mb-1 text-[8px] font-black uppercase tracking-[0.1em]', selected ? 'text-[var(--bg-deep)]/65' : 'text-[var(--text-primary)]')}>Popular</span>}
                                {count === 20 && <span className={clsx('mb-1 text-[8px] font-black uppercase tracking-[0.1em]', selected ? 'text-[var(--bg-deep)]/65' : 'text-[var(--text-primary)]')}>Best value</span>}
                                <strong className="text-xs">+{count} photos</strong>
                                <span className="mt-1 text-[9px] font-semibold tabular-nums">{idrFormat.format(packageQuote.total)}</span>
                            </button>
                        );
                    })}
                </div>

                <label className="mt-3 block">
                    <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Custom amount</span>
                    <input type="number" min="1" max="500" value={requestedCount} onChange={(event) => onChange(Math.min(500, Math.max(1, Number(event.currentTarget.value) || 1)))} className="mt-1.5 h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] px-3 text-sm outline-none focus:border-[var(--accent)]" />
                </label>

                <dl className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)] text-xs">
                    <div className="flex items-center justify-between py-3"><dt className="text-[var(--text-muted)]">Current selection</dt><dd className="font-semibold">{selectedCount} photos</dd></div>
                    <div className="flex items-center justify-between py-3"><dt className="text-[var(--text-muted)]">Price per photo</dt><dd className="font-semibold tabular-nums">{idrFormat.format(unitPrice)}</dd></div>
                    {quote.discountPercent > 0 && <div className="flex items-center justify-between py-3"><dt className="text-[var(--text-primary)]">Bundle discount</dt><dd className="font-semibold text-[var(--text-primary)]">Save {quote.discountPercent}% ({idrFormat.format(quote.savings)})</dd></div>}
                    <div className="flex items-center justify-between py-3"><dt className="text-[var(--text-muted)]">Estimated total</dt><dd className="flex items-center gap-2 font-bold tabular-nums">{quote.discountPercent > 0 && <span className="font-normal text-[var(--text-muted)] line-through">{idrFormat.format(quote.normalTotal)}</span>}{idrFormat.format(quote.total)}</dd></div>
                </dl>

                <a href={requestUrl} target="_blank" rel="noreferrer" onClick={onClose} className="mt-5 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] text-[10px] font-black uppercase tracking-[0.12em] text-[var(--bg-deep)] transition-opacity hover:opacity-85">
                    <MessageCircle size={14} /> Request via WhatsApp
                </a>
                <p className="mt-3 text-center text-[10px] leading-4 text-[var(--text-muted)]">The additional quota becomes active after Orbit confirms payment.</p>
            </section>
        </div>
    );
}

function SubmitConfirmationModal({
    selectedCount,
    pending,
    error,
    onConfirm,
    onClose,
}: {
    selectedCount: number;
    pending: boolean;
    error?: string;
    onConfirm: () => void;
    onClose: () => void;
}) {
    const clearsSelection = selectedCount === 0;

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !pending) onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose, pending]);

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true" aria-label={clearsSelection ? 'Clear submitted selection' : 'Submit selected photos'} onMouseDown={(event) => { if (!pending && event.target === event.currentTarget) onClose(); }}>
            <section className="w-full max-w-sm border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-2xl">
                <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
                    <div>
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">FINAL CHECK</p>
                        <h2 className="mt-1 font-display text-xl">{clearsSelection ? 'Clear selection?' : 'Submit your selection?'}</h2>
                    </div>
                    <button type="button" disabled={pending} onClick={onClose} aria-label="Close submit confirmation" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] transition-colors hover:border-[var(--accent)] disabled:opacity-40"><X size={14} /></button>
                </header>

                <div className="px-5 py-6 text-center">
                    <p className="font-display text-5xl tabular-nums text-[var(--text-primary)]">{selectedCount}</p>
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">{selectedCount === 1 ? 'Photo selected' : 'Photos selected'}</p>
                    <p className="mx-auto mt-5 max-w-xs text-xs leading-5 text-[var(--text-secondary)]">
                        {clearsSelection ? 'This removes all previously submitted photos. You can select and submit them again later.' : 'Orbit will receive these filenames and notes. You can revise your choices and submit again later.'}
                    </p>
                    {error && <div className="mt-4 flex items-start gap-2 border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-left text-xs leading-5 text-rose-300"><AlertCircle size={14} className="mt-0.5 shrink-0" />{error}</div>}
                </div>

                <footer className="grid grid-cols-2 gap-2 border-t border-[var(--border)] p-4">
                    <button type="button" disabled={pending} onClick={onClose} className="h-10 rounded-lg border border-[var(--border)] text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)] disabled:opacity-40">Cancel</button>
                    <button type="button" autoFocus disabled={pending} onClick={onConfirm} className="flex h-10 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] text-[10px] font-black uppercase tracking-[0.12em] text-[var(--bg-deep)] transition-opacity hover:opacity-85 disabled:opacity-45">
                        {pending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                        {pending ? 'Submitting' : clearsSelection ? 'Clear selection' : `Submit ${selectedCount}`}
                    </button>
                </footer>
            </section>
        </div>
    );
}

function TutorialModal({ onClose }: { onClose: () => void }) {
    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    const steps = [
        { icon: <Check size={15} />, title: 'Choose favorites', text: 'Tap the check button on any photo. A framed photo is currently selected.' },
        { icon: <X size={15} />, title: 'Changed your mind?', text: 'Tap the X on a selected photo to remove it before submitting.' },
        { icon: <CheckSquare size={15} />, title: 'Revise a submission', text: 'Open Submitted, remove or add photos, then submit again to update Orbit.' },
        { icon: <Send size={15} />, title: 'Send when ready', text: 'Review the final count and confirm. Notes added in preview are included.' },
    ];

    return (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true" aria-label="How photo selection works" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <section className="w-full max-w-md border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] shadow-2xl">
                <header className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
                    <div>
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]">ORBIT GUIDE</p>
                        <h2 className="mt-1 font-display text-xl">How selection works</h2>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close tutorial" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] transition-colors hover:border-[var(--accent)]"><X size={14} /></button>
                </header>

                <ol className="divide-y divide-[var(--border)] px-5">
                    {steps.map((step, index) => (
                        <li key={step.title} className="flex gap-3 py-4">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border)] text-[var(--text-primary)]">{step.icon}</span>
                            <div className="min-w-0">
                                <p className="text-xs font-semibold text-[var(--text-primary)]"><span className="mr-1.5 text-[var(--text-muted)]">{index + 1}.</span>{step.title}</p>
                                <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{step.text}</p>
                            </div>
                        </li>
                    ))}
                </ol>

                <footer className="border-t border-[var(--border)] p-4">
                    <button type="button" onClick={onClose} className="flex h-10 w-full items-center justify-center rounded-lg bg-[var(--accent)] text-[10px] font-black uppercase tracking-[0.12em] text-[var(--bg-deep)] transition-opacity hover:opacity-85">Start selecting</button>
                </footer>
            </section>
        </div>
    );
}

const Lightbox = memo(function Lightbox({
    galleryId,
    token,
    photos,
    currentIndex,
    selectedIds,
    onClose,
    onMove,
    onToggle,
    note,
    onNote,
}: {
    galleryId: string;
    token: string;
    photos: GalleryPhoto[];
    currentIndex: number | null;
    selectedIds: Set<string>;
    onClose: () => void;
    onMove: (index: number) => void;
    onToggle: (driveFileId: string) => void;
    note: string;
    onNote: (note: string) => void;
}) {
    const photo = currentIndex == null ? null : photos[currentIndex];
    const selected = photo ? selectedIds.has(photo.driveFileId) : false;

    useEffect(() => {
        if (!photo || currentIndex == null) return;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'ArrowLeft') onMove(Math.max(0, currentIndex - 1));
            if (event.key === 'ArrowRight') onMove(Math.min(photos.length - 1, currentIndex + 1));
            if (event.key === ' ') {
                event.preventDefault();
                onToggle(photo.driveFileId);
            }
        };
        
        document.addEventListener('keydown', handleKey);
        return () => {
            document.body.style.overflow = previousOverflow;
            document.removeEventListener('keydown', handleKey);
        };
    }, [currentIndex, onClose, onMove, onToggle, photo, photos.length]);

    if (!photo || currentIndex == null) return null;

    return (
        <div className="fixed inset-0 z-[120] bg-black/95 text-white">
            <button type="button" aria-label="Close photo preview" onClick={onClose} className="absolute right-4 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur hover:border-[var(--accent)] transition-colors">
                <X size={16} />
            </button>
            <button type="button" disabled={currentIndex === 0} aria-label="Previous photo" onClick={() => onMove(Math.max(0, currentIndex - 1))} className="absolute left-4 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur disabled:opacity-25 transition-opacity">
                <ChevronLeft size={18} />
            </button>
            <button type="button" disabled={currentIndex === photos.length - 1} aria-label="Next photo" onClick={() => onMove(Math.min(photos.length - 1, currentIndex + 1))} className="absolute right-4 top-1/2 z-30 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur disabled:opacity-25 transition-opacity">
                <ChevronRight size={18} />
            </button>

            <div className="flex h-full flex-col relative">
                <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-20 relative">
                    {currentIndex > 0 && (
                        <img 
                            src={galleryPreviewUrl(galleryId, photos[currentIndex - 1].driveFileId, token)} 
                            alt="Preload Previous" 
                            className="absolute opacity-0 pointer-events-none" 
                        />
                    )}
                    <img 
                        src={galleryPreviewUrl(galleryId, photo.driveFileId, token)} 
                        alt={photo.filename} 
                        className="z-10 max-h-full max-w-full object-contain transition-opacity duration-200" 
                    />
                    {currentIndex < photos.length - 1 && (
                        <img 
                            src={galleryPreviewUrl(galleryId, photos[currentIndex + 1].driveFileId, token)} 
                            alt="Preload Next" 
                            className="absolute opacity-0 pointer-events-none" 
                        />
                    )}
                </div>
                
                <footer className="absolute z-20 inset-x-0 bottom-0 flex flex-col gap-3 border-t border-white/10 bg-black/70 px-5 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{photo.filename}</p>
                        <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/50">{currentIndex + 1} / {photos.length}</p>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[300px]">
                        <textarea value={note} maxLength={500} onChange={(event) => onNote(event.target.value)} placeholder="Add a note for this photo..." className="min-h-16 w-full resize-y rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-xs text-white outline-none placeholder:text-white/45 focus:border-[var(--accent)] transition-colors" />
                        <button type="button" onClick={() => onToggle(photo.driveFileId)} className={clsx('flex h-10 items-center justify-center gap-2 rounded-lg px-5 text-[10px] font-black uppercase tracking-[0.14em] transition-colors', selected ? 'bg-white text-black' : 'border border-white/30 bg-black/30 text-white hover:border-white/60 hover:bg-white/10')}>
                            {selected ? <X size={14} /> : <Check size={14} />}
                            {selected ? 'Remove selection' : 'Select photo'}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
});

export default function ClientCullingGallery() {
    const { galleryId } = useParams({ from: '/culling/$galleryId' });
    const queryClient = useQueryClient();
    const [theme, setTheme] = useState<GalleryTheme>(() => readGalleryTheme(galleryId));
    const [token, setToken] = useState(() => localStorage.getItem(tokenKey(galleryId)) || '');
    const [unlockedGallery, setUnlockedGallery] = useState<PublicGallery | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(readSelectionDraft(galleryId)));
    const [notes, setNotes] = useState<Record<string, string>>(() => readNotesDraft(galleryId));
    const [page, setPage] = useState(1);
    const [showSelected, setShowSelected] = useState(false);
    const [selectionTouched, setSelectionTouched] = useState(() => readSelectionDraft(galleryId).length > 0);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const [submittedCount, setSubmittedCount] = useState<number | null>(null);
    const [showTutorial, setShowTutorial] = useState(() => Boolean(token) && !localStorage.getItem(tutorialKey(galleryId)));
    const [limitMessage, setLimitMessage] = useState('');
    const [requestSettings, setRequestSettings] = useState<GalleryContactSettings | null>(null);
    const [showRequestMore, setShowRequestMore] = useState(false);
    const [requestedCount, setRequestedCount] = useState(10);
    const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
    
    const photosQuery = useQuery({
        queryKey: ['public-gallery-photos', galleryId, token, page],
        queryFn: () => getPublicGalleryPhotos(galleryId, token, page, 60),
        enabled: !!token,
        retry: false,
        placeholderData: keepPreviousData,
        staleTime: 5 * 60 * 1000,
    });
    
    const photos = photosQuery.data?.photos || [];
    const submittedPhotos = photosQuery.data?.selectedPhotos || [];
    const visiblePhotos = showSelected ? submittedPhotos : photos;
    
    const effectiveSelectedIds = useMemo(() => {
        if (selectionTouched || selectedIds.size > 0) return selectedIds;
        return new Set(photosQuery.data?.selectedDriveFileIds || []);
    }, [photosQuery.data?.selectedDriveFileIds, selectedIds, selectionTouched]);
    
    const selectionList = useMemo(() => Array.from(effectiveSelectedIds), [effectiveSelectedIds]);
    const displayGallery = photosQuery.data?.gallery || unlockedGallery;
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
    const addonQuote = useMemo(() => calculateAddonQuote(requestedCount, addonUnitPrice), [addonUnitPrice, requestedCount]);
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
        const phone = requestSettings.contactWhatsappUrl.replace(/\D/g, '').replace(/^0/, '62');
        return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    }, [addonQuote, displayGallery?.title, galleryId, requestSettings, requestedCount, selectedCount]);
    const hasUnsavedChanges = useMemo(() => {
        if (!selectionTouched) return false;
        const submittedSet = new Set(submittedPhotos.map(p => p.driveFileId));
        if (selectedCount !== submittedSet.size) return true;
        for (const id of effectiveSelectedIds) {
            if (!submittedSet.has(id)) return true;
        }
        return false;
    }, [effectiveSelectedIds, selectedCount, selectionTouched, submittedPhotos]);

    useEffect(() => {
        if (!token) return;
        fetch(`/api/public/galleries/${galleryId}/contact`)
            .then((response) => response.ok ? response.json() : null)
            .then((settings: GalleryContactSettings | null) => setRequestSettings(settings))
            .catch(() => setRequestSettings(null));
    }, [galleryId, token]);

    const submitMutation = useMutation({
        mutationFn: () => {
            const mappedSelections = selectionList.map((driveFileId) => {
                const existingNote = submittedPhotos.find((photo) => photo.driveFileId === driveFileId)?.note ?? '';
                const currentNote = notes[driveFileId] ?? existingNote;
                return { driveFileId, note: currentNote };
            });
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
        localStorage.setItem(notesKey(galleryId), JSON.stringify(notes));
    }, [galleryId, notes, selectionList]);

    useEffect(() => {
        const totalPages = photosQuery.data?.totalPages || 0;
        if (!token || !photosQuery.data || page >= totalPages) return;
        let cancelled = false;
        const warmNextPage = async () => {
            const nextPage = await queryClient.fetchQuery({
                queryKey: ['public-gallery-photos', galleryId, token, page + 1],
                queryFn: () => getPublicGalleryPhotos(galleryId, token, page + 1, 60),
                staleTime: 5 * 60 * 1000,
            });
            if (cancelled) return;
            nextPage.photos.forEach((photo) => {
                const image = new Image();
                image.src = galleryThumbnailUrl(galleryId, photo.driveFileId, token);
            });
        };
        const idle = window.setTimeout(() => void warmNextPage(), 250);
        return () => {
            cancelled = true;
            if (typeof idle === 'number') window.clearTimeout(idle);
        };
    }, [galleryId, page, photosQuery.data, queryClient, token]);

    const handleToggleSelection = useCallback((driveFileId: string) => {
        setSubmittedCount(null);
        setSelectionTouched(true);
        setSelectedIds(() => {
            const next = new Set(effectiveSelectedIds);
            if (next.has(driveFileId)) {
                next.delete(driveFileId);
                if (!selectionLimit || next.size <= selectionLimit) setLimitMessage('');
            } else if (!selectionLimit || next.size < selectionLimit) {
                next.add(driveFileId);
                if (!selectionLimit || next.size <= selectionLimit) setLimitMessage('');
            } else {
                setLimitMessage(`You have selected ${next.size} / ${selectionLimit} photos. Remove a photo or request more edited photos.`);
                if (requestMoreUrl) setShowRequestMore(true);
            }
            return next;
        });
    }, [effectiveSelectedIds, requestMoreUrl, selectionLimit]);

    const handleOpenLightbox = useCallback((index: number) => {
        setLightboxIndex(index);
    }, []);

    const updateNote = (driveFileId: string, note: string) => {
        setNotes((current) => ({ ...current, [driveFileId]: note.slice(0, 500) }));
    };

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

    return (
        <main style={theme === 'black' ? BLACK_THEME : WHITE_THEME} className="min-h-screen bg-[var(--bg-deep)] font-sans text-[var(--text-primary)]">
            
            {/* --- LAYER 1: STICKY NAVBAR (Responsive Mobile Header) --- */}
            <header className="sticky top-0 z-40 h-13 border-b border-[var(--border)] bg-[var(--bg-deep)]/90 px-3 backdrop-blur sm:h-14 sm:px-8">
                <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-2">
                    
                    <OrbitLogo theme={theme} />

                    <div className="flex items-center gap-1.5 sm:gap-2">
                        {requestMoreUrl && shouldShowRequestMore && (
                            <button
                                type="button"
                                onClick={() => setShowRequestMore(true)}
                                className="flex h-7.5 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2 sm:h-8 sm:px-2.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"
                            >
                                <span className="hidden sm:inline">Request More</span>
                                <span className="sm:hidden">Request</span>
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setShowTutorial(true)}
                            title="How to submit"
                            className="flex h-7.5 items-center justify-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-card)] px-2 sm:h-8 sm:px-2.5 text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
                        >
                            <HelpCircle size={13} />
                            <span className="hidden sm:inline">How to submit</span>
                        </button>
                        <ThemeToggle theme={theme} onToggle={toggleTheme} />
                    </div>
                </div>
            </header>

            {/* --- LAYER 2: FLOATING TOOLBAR (Seamless Toggle & Sisa Kuota) --- */}
            <div className="sticky top-[52px] sm:top-[56px] z-30 border-b border-[var(--border)] bg-[var(--bg-deep)]/95 px-3 py-2 backdrop-blur sm:px-8">
                <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-2 overflow-x-auto no-scrollbar">
                    
                    {/* --- SISI KIRI: SEAMLESS TOGGLE BUTTON + COUNTER & SISA KUOTA --- */}
                    <div className="flex shrink-0 items-center gap-2">
                        
                        {/* Seamless Single Toggle Button (Zero Layout Shift) */}
                        <button
                            type="button"
                            onClick={() => {
                                setShowSelected((current) => !current);
                                setPage(1);
                                setLightboxIndex(null);
                            }}
                            className={clsx(
                                'relative inline-grid grid-cols-1 grid-rows-1 items-center justify-center rounded-md border px-2.5 py-1 text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.12em] transition-colors whitespace-nowrap',
                                showSelected
                                    ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]'
                                    : 'border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:border-[var(--accent)]'
                            )}
                        >
                            {/* 1. Ghost Layer: Mengunci lebar tombol berdasarkan teks terpanjang */}
                            <span className="col-start-1 row-start-1 flex items-center justify-center gap-1.5 opacity-0 pointer-events-none select-none aria-hidden">
                                <CheckSquare size={12} />
                                Submitted ({submittedCount ?? submittedPhotos.length})
                            </span>

                            {/* 2. Active Layer: Teks dinamis sesuai status */}
                            <span className="col-start-1 row-start-1 flex items-center justify-center gap-1.5">
                                {showSelected ? (
                                    <>
                                        <CheckSquare size={12} />
                                        Submitted ({submittedCount ?? submittedPhotos.length})
                                    </>
                                ) : (
                                    <>
                                        <ImageIcon size={12} />
                                        All Photos
                                    </>
                                )}
                            </span>
                        </button>

                        {/* Counter Foto Terpilih & Sisa Kuota */}
                        <span
                            className={clsx(
                                'shrink-0 rounded-md border bg-[var(--bg-card)] px-2.5 py-1 text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.12em] whitespace-nowrap',
                                isOverLimit ? 'border-rose-500/45 text-rose-400' : 'border-[var(--border)] text-[var(--text-secondary)]'
                            )}
                        >
                            Picked {selectedCount}{selectionLimit ? ` / ${selectionLimit}` : ''}
                            
                            {/* Menampilkan sisa kuota jika master limit diatur */}
                            {selectionLimit ? (
                                <span className={clsx('ml-1.5 border-l border-[var(--border)] pl-1.5 font-normal', isOverLimit ? 'text-rose-400' : 'text-[var(--text-muted)]')}>
                                    {isOverLimit ? `${overLimitCount} Over` : `${remainingSelections} Left`}
                                </span>
                            ) : (
                                <span className="ml-1.5 border-l border-[var(--border)] pl-1.5 font-normal text-[var(--text-muted)]">
                                    Unlimited
                                </span>
                            )}
                        </span>
                    </div>

                    {/* --- SISI KANAN: UNSAVED BADGE + SUBMIT BUTTON --- */}
                    <div className="flex shrink-0 items-center gap-2">
                        {hasUnsavedChanges && (
                            <span title="Your latest selection changes have not been submitted yet." className="hidden md:inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-card)] px-2 py-0.5 text-[9px] font-semibold text-[var(--text-secondary)] whitespace-nowrap">
                                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" /> Not submitted
                            </span>
                        )}
                        
                        <button 
                            type="button" 
                            disabled={submitMutation.isPending || photosQuery.isLoading} 
                            onClick={handleSubmitSelections} 
                            className={clsx(
                                "flex h-7.5 sm:h-8 items-center justify-center gap-1 rounded-md px-3 text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.12em] transition-all disabled:opacity-45 whitespace-nowrap",
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

            {/* AREA UTAMA / GRID FOTO */}
            <section className="mx-auto max-w-[1600px] px-4 pt-6 pb-12 md:px-8">
                {limitMessage && (
                    <div className="mb-4 text-xs text-[var(--text-muted)] border border-[var(--border)] p-3 rounded-lg bg-[var(--bg-card)]">
                        {limitMessage} {requestMoreUrl && <button type="button" onClick={() => setShowRequestMore(true)} className="ml-1 font-semibold underline text-[var(--text-primary)]">Request more</button>}
                    </div>
                )}
                {submittedCount !== null && (
                    <div className="mb-5 flex items-center gap-3 border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-primary)]">
                        <Check size={16} />
                        {submittedCount} filenames submitted.
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
                ) : photosQuery.isError ? (
                    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
                        <AlertCircle size={30} className="mb-4 text-[var(--text-muted)]" />
                        <p className="font-display text-2xl text-[var(--text-primary)]">Gallery session expired</p>
                        <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--text-muted)]">The gallery was reopened or your session expired. Enter the PIN again to continue.</p>
                        <button type="button" onClick={() => { localStorage.removeItem(tokenKey(galleryId)); setToken(''); }} className="mt-6 flex h-10 items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-5 text-[10px] font-black uppercase tracking-[0.14em] text-[var(--bg-deep)] transition-opacity hover:opacity-85"><Lock size={14} /> Enter PIN again</button>
                    </div>
                ) : !visiblePhotos.length ? (
                    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
                        {showSelected ? <CheckSquare size={30} className="mb-4 text-[var(--text-muted)]" /> : <ImageIcon size={30} className="mb-4 text-[var(--text-muted)]" />}
                        <p className="font-display text-2xl text-[var(--text-primary)]">{showSelected ? 'No submitted selections' : 'No photos synced yet'}</p>
                        <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--text-muted)]">{showSelected ? 'Select photos from the gallery to see them here.' : 'The studio needs to sync this Drive folder before selection opens.'}</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 md:gap-3 xl:grid-cols-5 2xl:grid-cols-6">
                        {visiblePhotos.map((photo, index) => (
                            <PhotoTile
                                key={photo.driveFileId}
                                photo={photo}
                                selected={effectiveSelectedIds.has(photo.driveFileId)}
                                token={token}
                                galleryId={galleryId}
                                index={(page - 1) * 60 + index}
                                onOpen={handleOpenLightbox}
                                onToggle={handleToggleSelection}
                            />
                        ))}
                    </div>
                )}
                
                {!showSelected && !photosQuery.isLoading && !photosQuery.isError && photosQuery.data && photosQuery.data.totalPages > 1 && (
                    <nav className="mt-8 flex items-center justify-center gap-4" aria-label="Gallery pages">
                        <button type="button" disabled={page === 1} onClick={() => { setPage((current) => current - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] px-4 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] disabled:opacity-35"><ChevronLeft size={14} /> Previous</button>
                        <span className="text-xs text-[var(--text-muted)]">Page {page} of {photosQuery.data.totalPages}</span>
                        <button type="button" disabled={page === photosQuery.data.totalPages} onClick={() => { setPage((current) => current + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] px-4 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] disabled:opacity-35">Next <ChevronRight size={14} /></button>
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
                token={token}
                photos={visiblePhotos}
                currentIndex={lightboxIndex}
                selectedIds={effectiveSelectedIds}
                onClose={() => setLightboxIndex(null)}
                onMove={setLightboxIndex}
                onToggle={handleToggleSelection}
                note={lightboxIndex == null || !visiblePhotos[lightboxIndex] ? '' : notes[visiblePhotos[lightboxIndex].driveFileId] ?? submittedPhotos.find((photo) => photo.driveFileId === visiblePhotos[lightboxIndex].driveFileId)?.note ?? ''}
                onNote={(note) => { if (lightboxIndex != null && visiblePhotos[lightboxIndex]) updateNote(visiblePhotos[lightboxIndex].driveFileId, note); }}
            />

            {showRequestMore && requestMoreUrl && (
                <RequestMoreModal
                    requestedCount={requestedCount}
                    selectedCount={selectedCount}
                    unitPrice={addonUnitPrice}
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
            
            {showTutorial && <TutorialModal onClose={closeTutorial} />}
        </main>
    );
}
