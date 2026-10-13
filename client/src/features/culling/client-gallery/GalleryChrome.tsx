import { memo, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { ChevronDown, ImageIcon, Images, Moon, ScanFace, Sun } from 'lucide-react';
import clsx from 'clsx';

import orbitLogo from '../../../assets/pdf/logo.png';

import type { GalleryTheme } from './types';

export type GalleryView = 'gallery' | 'picked' | 'selfie' | 'edit-results';

export function GalleryHeaderIdentity({ section, title }: { section: 'Photo Selection' | 'Edited Photos'; title?: string }) {
    const eventTitle = title?.trim() || 'Your Gallery';
    return <div className="col-span-3 row-start-2 flex min-w-0 items-baseline gap-2 lg:ml-5">
        <span className="shrink-0 text-[11px] font-medium uppercase text-[var(--text-muted)] sm:text-xs lg:text-[13px]">{section}</span>
        {section === 'Edited Photos' ? <ExpandableEventTitle title={eventTitle} /> : <h1 className="min-w-0 truncate font-sans text-sm font-semibold leading-tight text-[var(--text-primary)] sm:text-[15px] lg:text-lg" title={eventTitle}>{eventTitle}</h1>}
    </div>;
}

function ExpandableEventTitle({ title }: { title: string }) {
    const [titleOpen, setTitleOpen] = useState(false);
    const titleId = useId();
    const titleRef = useRef<HTMLButtonElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!titleOpen) return;
        const closeOutside = (event: PointerEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) setTitleOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setTitleOpen(false);
            titleRef.current?.focus({ preventScroll: true });
        };
        document.addEventListener('pointerdown', closeOutside);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOutside);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [titleOpen]);
    return <div ref={containerRef} className="min-w-0">
            <h1 className="min-w-0 font-sans text-sm font-semibold leading-tight text-[var(--text-primary)] sm:text-[15px] lg:text-lg">
                <button ref={titleRef} type="button" aria-expanded={titleOpen} aria-controls={titleOpen ? titleId : undefined} onClick={() => setTitleOpen((open) => !open)} title="Show full event title" className="inline-flex max-w-full min-w-0 items-center gap-1 text-left hover:underline hover:underline-offset-2 focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                    <span className="min-w-0 truncate">{title}</span><ChevronDown size={12} aria-hidden="true" className={clsx('shrink-0 transition-transform duration-150 motion-reduce:transition-none', titleOpen && 'rotate-180')} />
                </button>
            </h1>
            {titleOpen && <div id={titleId} role="region" aria-label="Full event title" className="fixed left-2.5 right-2.5 top-20 z-[80] mx-auto max-w-lg rounded-md border border-[var(--border)] bg-[var(--bg-deep)] p-3 text-sm font-semibold leading-5 text-[var(--text-primary)] shadow-lg [overflow-wrap:anywhere] lg:top-16">{title}</div>}
    </div>;
}

export function GalleryViewTabs({ value, galleryLabel = 'All Photos', galleryAvailable = true, editedAvailable, editedExpired = false, selfieAvailable = true, allPhotosMenuOpen = false, allPhotosButtonRef, onAllPhotos, onChange }: {
    value: GalleryView;
    galleryLabel?: string;
    galleryAvailable?: boolean;
    editedAvailable: boolean;
    editedExpired?: boolean;
    selfieAvailable?: boolean;
    allPhotosMenuOpen?: boolean;
    allPhotosButtonRef?: RefObject<HTMLButtonElement | null>;
    onAllPhotos: () => void;
    onChange: (view: GalleryView) => void;
}) {
    const views = [
        { value: 'gallery', label: galleryLabel, compactLabel: galleryLabel === 'All Photos' ? 'All' : galleryLabel === 'Picked' ? 'Pick' : galleryLabel === 'Submitted' ? 'Sent' : galleryLabel, Icon: ImageIcon },
        { value: 'edit-results', label: 'Edited Photos', compactLabel: 'Edited', Icon: Images },
        { value: 'selfie', label: 'Selfie', compactLabel: '', Icon: ScanFace },
    ] as const;
    return <nav aria-label="Gallery views" className="grid w-full min-w-0 grid-cols-[minmax(44px,1fr)_minmax(50px,1.3fr)_44px] gap-1 sm:w-auto sm:flex-none sm:grid-cols-[9rem_auto_auto]">
        {views.map(({ value: view, label, compactLabel, Icon }) => <button
            key={view}
            ref={view === 'gallery' ? allPhotosButtonRef : undefined}
            type="button"
            aria-label={view === 'edit-results' && editedExpired ? 'Edited Photos access expired' : label}
            aria-pressed={value === view}
            disabled={view === 'edit-results' ? !editedAvailable : !galleryAvailable || (view === 'selfie' && !selfieAvailable)}
            title={view === 'edit-results' && editedExpired ? 'Edited Photos access expired' : view === 'edit-results' && !editedAvailable ? 'Edited photos are not published yet' : !galleryAvailable ? 'Photo selection is unavailable' : view === 'selfie' && !selfieAvailable ? 'Selfie search is unavailable' : label}
            onClick={() => view === 'gallery' ? onAllPhotos() : onChange(view)}
            aria-expanded={view === 'gallery' ? allPhotosMenuOpen : undefined}
            className={clsx('inline-flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition-[color,background-color,border-color,transform] duration-150 enabled:active:scale-[0.98] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] sm:gap-1.5 sm:px-3 sm:text-sm lg:text-[15px]', view === 'gallery' && 'max-sm:gap-0 max-sm:px-0.5', view === 'edit-results' && 'max-sm:px-1 max-sm:text-xs', view === 'edit-results' && !editedAvailable ? 'cursor-not-allowed border-[var(--border)] bg-transparent text-[var(--text-muted)] opacity-60' : value === view ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]' : 'border-[var(--border)] bg-transparent text-[var(--text-secondary)] enabled:hover:border-[var(--text-muted)] enabled:hover:text-[var(--text-primary)]')}
        ><Icon size={view === 'selfie' ? 16 : 14} aria-hidden="true" className={clsx('shrink-0', view === 'selfie' ? 'block' : 'hidden sm:block')} /><span className={clsx('truncate sm:hidden', view === 'selfie' && 'sr-only')}>{view === 'edit-results' && editedExpired ? 'Expired' : compactLabel}</span><span className="hidden sm:inline">{view === 'edit-results' && editedExpired ? 'Edited Photos expired' : label}</span>{view === 'gallery' && <ChevronDown size={12} aria-hidden="true" className={clsx('shrink-0 transition-transform duration-150', allPhotosMenuOpen && 'rotate-180')} />}</button>)}
    </nav>;
}

export const OrbitLogo = memo(function OrbitLogo({ 
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
                width={791}
                height={296}
                className="h-auto w-20 object-contain sm:w-28 lg:w-30"
                style={{ filter: isInverted ? 'invert(1)' : 'none' }}
            />
        </div>
    );
});

export function ThemeToggle({ theme, onToggle }: { theme: GalleryTheme; onToggle: () => void }) {
    const nextTheme = theme === 'black' ? 'white' : 'black';
    return (
        <button type="button" onClick={onToggle} title={`Switch to ${nextTheme} mode`} aria-label={`Switch to ${nextTheme} mode`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-[color,background-color,transform] duration-150 hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] active:scale-[0.97] motion-reduce:transition-none">
            {theme === 'black' ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
        </button>
    );
}
