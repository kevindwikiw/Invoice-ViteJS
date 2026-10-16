import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, FolderOpen, Images, Loader2, Lock, MessageCircle } from 'lucide-react';

import { getEditResultsStatus, verifyEditResultsPassword, verifyGalleryPin } from '../culling.public';
import type { PublicGallery } from '../culling.types';

import { BLACK_THEME, WHITE_THEME } from './constants';
import { OrbitLogo, ThemeToggle } from './GalleryChrome';
import { GalleryFooter } from './GalleryFooter';
import { GalleryPasswordField } from './GalleryPasswordField';
import { tokenKey } from './storage';
import type { GalleryTheme } from './types';

function AccessHeader({ theme, onToggleTheme, title, section = 'Photo Selection' }: { theme: GalleryTheme; onToggleTheme: () => void; title?: string; section?: 'Photo Selection' | 'Edited Photos' }) {
    return <header data-testid="gallery-header" className="h-20 shrink-0 border-b border-[var(--border)] bg-[var(--bg-deep)] px-2.5 sm:px-8 lg:h-16">
        <div className="mx-auto grid h-full max-w-[1600px] grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[2.75rem_1.5rem] items-center gap-x-2 py-1 lg:flex lg:py-0">
            <OrbitLogo theme={theme} />
            <div className="col-span-3 row-start-2 flex min-w-0 items-baseline gap-2 lg:ml-5">
                <span className="shrink-0 text-[11px] font-medium uppercase text-[var(--text-muted)] sm:text-xs lg:text-[13px]">{section}</span>
                <p title={title} className="min-w-0 truncate text-sm font-semibold leading-tight text-[var(--text-primary)] sm:text-[15px] lg:text-lg">{title || 'Gallery'}</p>
            </div>
            <div className="col-start-3 row-start-1 lg:ml-auto"><ThemeToggle theme={theme} onToggle={onToggleTheme} /></div>
        </div>
    </header>;
}

export function GalleryPreparingScreen({ title, theme, onToggleTheme }: { title?: string; theme: GalleryTheme; onToggleTheme?: () => void }) {
    return <main style={theme === 'black' ? BLACK_THEME : WHITE_THEME} className="flex min-h-dvh flex-col bg-[var(--bg-deep)] font-sans text-[var(--text-primary)]">
        <AccessHeader theme={theme} onToggleTheme={onToggleTheme ?? (() => undefined)} title={title} section="Edited Photos" />
        <section className="flex flex-1 items-center justify-center px-4 py-8 sm:px-5 sm:py-12">
            <div className="w-full max-w-sm border border-[var(--border)] bg-[var(--bg-card)] px-5 py-7 text-center shadow-2xl sm:px-8 sm:py-9">
                <div className="mb-7 flex justify-center"><OrbitLogo theme={theme} /></div>
                <div role="status" className="gallery-unlock-loading">
                    <h1 className="font-sans text-lg font-semibold leading-tight text-[var(--text-primary)] [text-wrap:balance]">Preparing your gallery…</h1>
                    <span className="gallery-unlock-progress mt-8" aria-hidden="true"><span /></span>
                </div>
            </div>
        </section>
        <GalleryFooter />
    </main>;
}

export function PinGate({
    galleryId,
    title,
    onUnlocked,
    onEditResultsUnlocked,
    theme,
    onToggleTheme,
    initialMode = 'gallery',
    editedSessionAvailable = false,
    onBackToEdited,
    opening = false,
    leaving = false,
    preparationError,
    onRetry,
}: {
    galleryId: string;
    title?: string;
    onUnlocked: (token: string, gallery: PublicGallery, submittedAt: number) => void;
    onEditResultsUnlocked: (token: string) => void;
    theme: GalleryTheme;
    onToggleTheme: () => void;
    initialMode?: 'gallery' | 'edited';
    editedSessionAvailable?: boolean;
    onBackToEdited?: () => void;
    opening?: boolean;
    leaving?: boolean;
    preparationError?: string;
    onRetry?: () => void;
}) {
    const submittedAtRef = useRef(0);
    const cardRef = useRef<HTMLFormElement>(null);
    const [cardHeight, setCardHeight] = useState<number | null>(null);
    const [pin, setPin] = useState('');
    const [editResultsPassword, setEditResultsPassword] = useState('');
    const [mode, setMode] = useState<'gallery' | 'edited'>(initialMode);
    const [error, setError] = useState('');
    const [contactUrl, setContactUrl] = useState<string | null>(null);
    const [lockCode, setLockCode] = useState<'GALLERY_CLOSED' | 'GALLERY_EXPIRED' | null>(null);
    const [isRateLimited, setIsRateLimited] = useState(false);
    useEffect(() => {
        setMode(initialMode);
        setError('');
    }, [initialMode]);
    const isClosed = lockCode !== null;
    const isExpired = lockCode === 'GALLERY_EXPIRED';
    const editResultsStatus = useQuery({ queryKey: ['public-edit-results-status', galleryId], queryFn: () => getEditResultsStatus(galleryId), staleTime: 60_000 });
    const lockedMessage = isExpired
        ? 'The selection deadline has ended. Please contact the admin if you need more time.'
        : isRateLimited
            ? 'Too many password attempts. Please contact the admin to unlock access.'
            : 'This gallery is currently locked. Please contact the admin to unlock access.';
    
    const verifyMutation = useMutation({
        mutationFn: () => verifyGalleryPin(galleryId, pin),
        onSuccess: (data) => {
            localStorage.setItem(tokenKey(galleryId), data.token);
            onUnlocked(data.token, data.gallery, submittedAtRef.current);
        },
        onError: (mutationError) => {
            const galleryError = mutationError as Error & { code?: string; contactUrl?: string | null; status?: number };
            setError(galleryError.status === 401 ? 'Incorrect password. Check it and try again.' : mutationError instanceof Error ? mutationError.message : 'Unable to unlock gallery.');
            if (galleryError.code === 'GALLERY_CLOSED' || galleryError.code === 'GALLERY_EXPIRED') {
                if (editResultsStatus.data?.available) {
                    setMode('edited');
                    setPin('');
                    setError('Photo Selection is no longer available. Enter your Edited Photos password.');
                } else {
                    setContactUrl(galleryError.contactUrl || null);
                    setLockCode(galleryError.code);
                }
            }
            if (galleryError.status === 429) {
                setIsRateLimited(true);
                setError('Password access is temporarily locked. Please contact the admin to unlock it.');
                fetch(`/api/public/galleries/${galleryId}/contact`).then((response) => response.ok ? response.json() : null).then((settings: { contactWhatsappUrl?: string; message?: string; requestMoreMessage?: string } | null) => {
                    if (settings?.contactWhatsappUrl) {
                        const text = (settings.message || 'Halo Kak Admin Orbit ✨\nSaya ingin meminta bantuan untuk membuka client gallery saya yaa.').replaceAll('{{gallery_url}}', window.location.href).replaceAll('{{gallery_title}}', galleryId);
                        setContactUrl(`https://wa.me/${settings.contactWhatsappUrl.replace(/\D/g, '').replace(/^0/, '62')}?text=${encodeURIComponent(text)}`);
                    }
                }).catch(() => undefined);
            }
        },
    });
    const verifyEdited = useMutation({
        mutationFn: () => verifyEditResultsPassword(galleryId, editResultsPassword),
        onSuccess: (data) => onEditResultsUnlocked(data.token),
        onError: (mutationError) => {
            const accessError = mutationError as Error & { status?: number };
            setError(accessError.status === 401 ? 'Incorrect password. Check it and try again.' : mutationError instanceof Error ? mutationError.message : 'Unable to unlock edited photos.');
        },
    });
    const pinLoading = mode === 'gallery' && verifyMutation.isPending;
    const showPinLoading = opening || pinLoading;

    return (
        <main style={theme === 'black' ? BLACK_THEME : WHITE_THEME} className="flex min-h-dvh flex-col bg-[var(--bg-deep)] font-sans text-[var(--text-primary)]">
            <AccessHeader theme={theme} onToggleTheme={onToggleTheme} title={title} section={mode === 'edited' ? 'Edited Photos' : 'Photo Selection'} />
            <section className="flex flex-1 items-center justify-center px-4 py-8 sm:px-5 sm:py-12">
                <div className="w-full max-w-sm" style={cardHeight ? { minHeight: cardHeight } : undefined}>
                <form
                    ref={cardRef}
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (opening || verifyMutation.isPending || verifyEdited.isPending) return;
                        if (mode === 'gallery' && pin.trim().length < 4) { setError('Enter at least 4 characters.'); return; }
                        if (mode === 'edited' && !editResultsPassword.trim()) { setError('Enter your password.'); return; }
                        setError('');
                        setContactUrl(null);
                        setIsRateLimited(false);
                        if (mode === 'edited') verifyEdited.mutate();
                        else { setCardHeight(cardRef.current?.offsetHeight || null); submittedAtRef.current = Date.now(); verifyMutation.mutate(); }
                    }}
                    data-phase={leaving ? 'leaving' : showPinLoading ? 'waiting' : 'idle'}
                    className="gallery-unlock-card box-border w-full max-w-sm border border-[var(--border)] bg-[var(--bg-card)] px-5 py-7 text-center shadow-2xl sm:px-8 sm:py-9"
                >
                    <div className="mb-7 flex justify-center"><OrbitLogo theme={theme} /></div>
                    <div className="gallery-unlock-content">
                    <div inert={showPinLoading} aria-busy={showPinLoading || verifyEdited.isPending} className="gallery-unlock-fields"><div>
                    <div className="mb-3 flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                        {mode === 'edited' ? <FolderOpen size={14} aria-hidden="true" /> : <Images size={14} aria-hidden="true" />}
                        <span>{mode === 'edited' ? 'Edited Gallery' : 'Photo Selection'}</span>
                    </div>
                    <h1 className="font-display text-[26px] font-medium leading-tight text-[var(--text-primary)] [text-wrap:balance]">{mode === 'edited' ? 'View Your Edited Photos' : mode === 'gallery' && (isExpired || isClosed || isRateLimited) ? isExpired ? 'Selection Closed' : isClosed ? 'Gallery Locked' : 'Access Locked' : 'Enter Password'}</h1>
                    {!isClosed && !isRateLimited && <p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-[var(--text-muted)]">{mode === 'edited' ? 'Enter your password to view and download your finished gallery.' : 'Choose your favorites to submit for editing.'}</p>}
                    
                    {mode === 'gallery' && !isClosed && !isRateLimited && (
                        <div className="mt-7"><GalleryPasswordField key="selection" label="Photo Selection password" name="selectionPassword" value={pin} onChange={(value) => { setPin(value); if (error) setError(''); }} error={error} /></div>
                    )}
                    {mode === 'edited' && (
                        <div className="mt-7"><GalleryPasswordField key="edited" label="Edited photos password" name="editedPhotosPassword" value={editResultsPassword} onChange={(value) => { setEditResultsPassword(value); if (error) setError(''); }} error={error} /></div>
                    )}
                    {mode === 'gallery' && contactUrl && <a href={contactUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs font-bold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]">Contact admin on WhatsApp</a>}
                    {mode === 'gallery' && (isClosed || isRateLimited) && (
                        <p className="mx-auto mt-6 max-w-xs text-xs leading-5 text-[var(--text-muted)]">{lockedMessage}</p>
                    )}
                    {mode === 'gallery' && isRateLimited && !isClosed && <button type="button" onClick={() => { setIsRateLimited(false); setError(''); setContactUrl(null); setPin(''); }} className="mt-4 inline-flex h-11 items-center justify-center rounded-md border border-[var(--border)] px-4 text-xs font-semibold text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">Try Password Again</button>}
                    </div></div>
                    {showPinLoading && <div className="gallery-unlock-loading" role={preparationError ? undefined : 'status'}>
                        {preparationError ? <>
                            <p role="alert" className="text-sm leading-6">{preparationError}</p>
                            <button type="button" onClick={onRetry} className="mt-4 min-h-11 rounded-md border border-[var(--border)] px-5 text-sm font-semibold hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">Retry</button>
                        </> : <h1 className="font-display text-[26px] font-medium leading-tight text-[var(--text-primary)] [text-wrap:balance]">Preparing your gallery…</h1>}
                    </div>}
                    {mode === 'gallery' && !isClosed && !isRateLimited && (
                        <div className="gallery-unlock-action relative mt-3 h-12">
                        <button type="submit" disabled={showPinLoading} className="gallery-unlock-button relative flex h-12 w-full items-center justify-center rounded-md text-xs font-bold text-[var(--bg-deep)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">
                            <span className="relative flex items-center gap-2"><Lock size={14} aria-hidden="true" />Unlock Photo Selection</span>
                        </button>
                        {showPinLoading && !preparationError && <span className="gallery-unlock-progress absolute inset-x-0 top-1/2 -translate-y-1/2" aria-hidden="true"><span /></span>}
                        </div>
                    )}
                    {mode === 'edited' && (
                        <button type="submit" disabled={verifyEdited.isPending} aria-live="polite" className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[var(--accent)] text-xs font-bold text-[var(--bg-deep)] transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-45">
                            {verifyEdited.isPending ? <Loader2 size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /> : <Lock size={14} aria-hidden="true" />} {verifyEdited.isPending ? 'Checking password…' : 'Unlock Edited Photos'}
                        </button>
                    )}
                    <div inert={showPinLoading} className="gallery-unlock-secondary"><div>
                    {editResultsStatus.data?.available && !(mode === 'gallery' && editedSessionAvailable) && <button type="button" onClick={() => { setMode((current) => current === 'gallery' ? 'edited' : 'gallery'); setError(''); }} className="mt-3 inline-flex min-h-11 items-center justify-center text-xs font-semibold text-[var(--text-secondary)] underline underline-offset-4 hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                        {mode === 'gallery' ? 'Use Edited Photos password' : 'Use Photo Selection password'}
                    </button>}
                    {mode === 'gallery' && editedSessionAvailable && onBackToEdited && <button type="button" onClick={onBackToEdited} className="mt-4 block w-full text-xs font-semibold text-[var(--text-secondary)] underline underline-offset-4">Back to Edited Photos</button>}
                    </div></div>
                    </div>
                </form>
                </div>
            </section>
            <GalleryFooter />
        </main>
    );
}

export function GalleryLockedScreen({
    title,
    expired,
    contactUrl,
    theme,
    onToggleTheme,
    hasEditResults = false,
    onAccessEditedPhotos,
}: {
    title?: string;
    expired: boolean;
    contactUrl: string | null;
    theme: GalleryTheme;
    onToggleTheme: () => void;
    hasEditResults?: boolean;
    onAccessEditedPhotos?: () => void;
}) {
    return (
        <main style={theme === 'black' ? BLACK_THEME : WHITE_THEME} className="flex min-h-dvh flex-col bg-[var(--bg-deep)] font-sans text-[var(--text-primary)]">
            <AccessHeader theme={theme} onToggleTheme={onToggleTheme} title={title} />
            <section className="flex flex-1 items-center justify-center px-5 py-12 text-center">
                <div className="box-border w-full max-w-sm border border-[var(--border)] bg-[var(--bg-card)] px-6 py-8 shadow-2xl">
                    <h1 className="font-display text-2xl font-medium">{expired ? 'Selection Closed' : 'Gallery Locked'}</h1>
                    {contactUrl && <a href={contactUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs font-bold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"><MessageCircle size={14} /> Contact admin on WhatsApp</a>}
                    {hasEditResults && onAccessEditedPhotos && <button type="button" onClick={onAccessEditedPhotos} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs font-bold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"><Download size={14} /> Access edited photos</button>}
                    <p className="mx-auto mt-6 max-w-xs text-xs leading-5 text-[var(--text-muted)]">{expired ? 'The selection deadline has ended. Please contact the admin if you need more time.' : 'This gallery is currently locked. Please contact the admin to unlock access.'}</p>
                </div>
            </section>
            <GalleryFooter />
        </main>
    );
}
