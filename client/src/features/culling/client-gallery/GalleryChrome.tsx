import { memo, type RefObject } from 'react';
import { ChevronDown, ImageIcon, Images, Moon, ScanFace, Sun } from 'lucide-react';
import clsx from 'clsx';

import orbitLogo from '../../../assets/pdf/logo.png';

import type { GalleryTheme } from './types';

export type GalleryView = 'gallery' | 'picked' | 'selfie' | 'edit-results';

export function GalleryViewTabs({ value, galleryLabel = 'All Photos', galleryAvailable = true, editedAvailable, selfieAvailable = true, allPhotosMenuOpen = false, allPhotosButtonRef, onAllPhotos, onChange }: {
    value: GalleryView;
    galleryLabel?: string;
    galleryAvailable?: boolean;
    editedAvailable: boolean;
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
            aria-label={label}
            aria-pressed={value === view}
            disabled={view === 'edit-results' ? !editedAvailable : !galleryAvailable || (view === 'selfie' && !selfieAvailable)}
            title={view === 'edit-results' && !editedAvailable ? 'Edited photos are not published yet' : !galleryAvailable ? 'Photo selection is unavailable' : view === 'selfie' && !selfieAvailable ? 'Selfie search is unavailable' : label}
            onClick={() => view === 'gallery' ? onAllPhotos() : onChange(view)}
            aria-expanded={view === 'gallery' ? allPhotosMenuOpen : undefined}
            className={clsx('inline-flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.98] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-60 sm:gap-1.5 sm:px-3 sm:text-sm lg:text-[15px]', view === 'gallery' && 'max-sm:gap-0 max-sm:px-0.5', view === 'edit-results' && 'max-sm:px-1 max-sm:text-xs', value === view ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]' : 'border-[var(--border)] bg-transparent text-[var(--text-secondary)] hover:border-[var(--text-muted)] hover:text-[var(--text-primary)]')}
        ><Icon size={view === 'selfie' ? 16 : 14} aria-hidden="true" className={clsx('shrink-0', view === 'selfie' ? 'block' : 'hidden sm:block')} /><span className={clsx('truncate sm:hidden', view === 'selfie' && 'sr-only')}>{compactLabel}</span><span className="hidden sm:inline">{label}</span>{view === 'gallery' && <ChevronDown size={12} aria-hidden="true" className={clsx('shrink-0 transition-transform duration-150', allPhotosMenuOpen && 'rotate-180')} />}</button>)}
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
