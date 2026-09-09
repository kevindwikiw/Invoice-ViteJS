import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Lock, MessageCircle } from 'lucide-react';
import clsx from 'clsx';

import { verifyGalleryPin } from '../culling.public';
import type { PublicGallery } from '../culling.types';

import { BLACK_THEME, WHITE_THEME } from './constants';
import { OrbitLogo, ThemeToggle } from './GalleryChrome';
import { tokenKey } from './storage';
import type { GalleryTheme } from './types';

export function PinGate({
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
    const [lockCode, setLockCode] = useState<'GALLERY_CLOSED' | 'GALLERY_EXPIRED' | null>(null);
    const [isRateLimited, setIsRateLimited] = useState(false);
    const isClosed = lockCode !== null;
    const isExpired = lockCode === 'GALLERY_EXPIRED';
    const lockedMessage = isExpired
        ? 'The selection deadline has ended. Please contact the admin if you need more time.'
        : isRateLimited
            ? 'Too many PIN attempts. Please contact the admin to unlock access.'
            : 'This gallery is currently locked. Please contact the admin to unlock access.';
    
    const verifyMutation = useMutation({
        mutationFn: () => verifyGalleryPin(galleryId, pin),
        onSuccess: (data) => {
            localStorage.setItem(tokenKey(galleryId), data.token);
            onUnlocked(data.token, data.gallery);
        },
        onError: (mutationError) => {
            setError(mutationError instanceof Error ? mutationError.message : 'Unable to unlock gallery.');
            const galleryError = mutationError as Error & { code?: string; contactUrl?: string | null; status?: number };
            if (galleryError.code === 'GALLERY_CLOSED' || galleryError.code === 'GALLERY_EXPIRED') {
                setContactUrl(galleryError.contactUrl || null);
                setLockCode(galleryError.code);
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
                    className="box-border h-[330px] w-full max-w-sm border border-[var(--border)] bg-[var(--bg-card)] px-6 py-10 text-center shadow-2xl"
                >
                    <div className="mb-6 flex justify-center">
                        <OrbitLogo theme={theme} />
                    </div>

                    <p className="label-xs text-[var(--accent)]">PRIVATE CLIENT GALLERY</p>
                    <h1 className="mt-3 font-display text-2xl font-medium text-[var(--text-primary)]">{isExpired ? 'Selection Closed' : isClosed ? 'Gallery Locked' : isRateLimited ? 'Access Locked' : 'Enter PIN'}</h1>
                    
                    {!isClosed && !isRateLimited && (
                        <div className="relative mt-7">
                            <input
                                value={pin}
                                onChange={(event) => {
                                    setPin(event.target.value.slice(0, 64));
                                    if (error) setError('');
                                }}
                                autoFocus
                                placeholder="Gallery PIN"
                                className="h-11 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-deep)] px-4 text-center text-base tracking-[0.2em] text-[var(--text-primary)] outline-none transition-colors placeholder:tracking-[0.2em] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
                            />
                            <p aria-live="polite" className={clsx('absolute left-0 right-0 top-full mt-1 text-xs leading-5 text-rose-400 transition-opacity duration-200', error ? 'opacity-100' : 'opacity-0')}>
                                {error || ' '}
                            </p>
                        </div>
                    )}
                    {contactUrl && <a href={contactUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs font-bold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]">Contact admin on WhatsApp</a>}
                    {(isClosed || isRateLimited) && (
                        <p className="mx-auto mt-6 max-w-xs text-xs leading-5 text-[var(--text-muted)]">{lockedMessage}</p>
                    )}
                    
                    {!isClosed && !isRateLimited && (
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

export function GalleryLockedScreen({
    expired,
    contactUrl,
    theme,
    onToggleTheme,
}: {
    expired: boolean;
    contactUrl: string | null;
    theme: GalleryTheme;
    onToggleTheme: () => void;
}) {
    return (
        <main style={theme === 'black' ? BLACK_THEME : WHITE_THEME} className="min-h-screen bg-[var(--bg-deep)] font-sans text-[var(--text-primary)]">
            <div className="absolute right-5 top-5"><ThemeToggle theme={theme} onToggle={onToggleTheme} /></div>
            <section className="flex min-h-screen items-center justify-center px-5 py-12 text-center">
                <div className="box-border h-[330px] w-full max-w-sm border border-[var(--border)] bg-[var(--bg-card)] px-6 py-10 shadow-2xl">
                    <div className="mb-6 flex justify-center"><OrbitLogo theme={theme} /></div>
                    <p className="label-xs text-[var(--accent)]">PRIVATE CLIENT GALLERY</p>
                    <h1 className="mt-3 font-display text-2xl font-medium">{expired ? 'Selection Closed' : 'Gallery Locked'}</h1>
                    {contactUrl && <a href={contactUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-xs font-bold text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]"><MessageCircle size={14} /> Contact admin on WhatsApp</a>}
                    <p className="mx-auto mt-6 max-w-xs text-xs leading-5 text-[var(--text-muted)]">{expired ? 'The selection deadline has ended. Please contact the admin if you need more time.' : 'This gallery is currently locked. Please contact the admin to unlock access.'}</p>
                </div>
            </section>
        </main>
    );
}
