import { memo, type ReactNode, type RefObject } from 'react';
import { ChevronDown, ImageIcon, Images, Moon, ScanFace, Sun } from 'lucide-react';
import clsx from 'clsx';

import orbitLogo from '../../../assets/pdf/logo.png';

import type { GalleryTheme } from './types';

export type GalleryView = 'gallery' | 'picked' | 'selfie' | 'edit-results';

export function GalleryHeader({ section, title, theme, utilities }: {
    section: 'Photo Selection' | 'Edited Photos';
    title?: string;
    theme: GalleryTheme;
    utilities: ReactNode;
}) {
    return <header data-testid="gallery-header" className="sticky top-0 z-40 h-20 select-none border-b border-[var(--border)] bg-[var(--bg-deep)] px-2.5 sm:px-8 lg:h-16">
        <div className="mx-auto grid h-full max-w-[1600px] min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[2.75rem_1.5rem] items-center gap-x-2 py-1 lg:flex lg:py-0">
            <OrbitLogo theme={theme} />
            <GalleryHeaderIdentity section={section} title={title} />
            <div data-testid="header-utilities" className="col-start-3 row-start-1 flex shrink-0 items-center gap-1 sm:ml-2 sm:gap-2 lg:ml-auto lg:gap-0">{utilities}</div>
        </div>
    </header>;
}

export function GalleryHeaderIdentity({ section, title }: { section: 'Photo Selection' | 'Edited Photos'; title?: string }) {
    const eventTitle = title?.trim() || 'Your Gallery';
    return <div className="col-span-3 row-start-2 flex min-w-0 items-baseline gap-2 lg:ml-5">
        <span className="shrink-0 text-[11px] font-medium uppercase text-[var(--text-muted)] sm:text-xs lg:text-[13px]">{section}</span>
        <h1 className="min-w-0 truncate font-sans text-sm font-semibold leading-tight text-[var(--text-primary)] sm:text-[15px] lg:text-lg" title={eventTitle}>{eventTitle}</h1>
    </div>;
}

export function GalleryViewTabs({ value, galleryLabel = 'All Photos', galleryAvailable = true, galleryUnavailableAction = false, editedAvailable, editedExpired = false, selfieAvailable = galleryAvailable, deliveryOnly = false, allPhotosMenuOpen = false, allPhotosButtonRef, onAllPhotos, onChange }: {
    value: GalleryView;
    galleryLabel?: string;
    galleryAvailable?: boolean;
    galleryUnavailableAction?: boolean;
    editedAvailable: boolean;
    editedExpired?: boolean;
    selfieAvailable?: boolean;
    deliveryOnly?: boolean;
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
    const visibleViews = views.filter((view) => (!deliveryOnly || view.value !== 'gallery') && (view.value !== 'selfie' || selfieAvailable));
    const layout = deliveryOnly
        ? selfieAvailable ? 'grid-cols-[minmax(50px,1fr)_44px] sm:grid-cols-[auto_auto]' : 'grid-cols-1 sm:grid-cols-1'
        : selfieAvailable ? 'grid-cols-[minmax(44px,1fr)_minmax(50px,1.3fr)_44px] sm:grid-cols-[9rem_auto_auto]' : 'grid-cols-[minmax(44px,1fr)_minmax(50px,1.3fr)] sm:grid-cols-[9rem_auto]';
    return <nav aria-label="Gallery views" className={clsx('grid w-full min-w-0 gap-1 sm:w-auto sm:flex-none', layout)}>
        {visibleViews.map(({ value: view, label, compactLabel, Icon }) => <button
            key={view}
            ref={view === 'gallery' ? allPhotosButtonRef : undefined}
            type="button"
            aria-label={view === 'edit-results' && editedExpired ? 'Edited Photos access expired' : label}
            aria-pressed={value === view}
            disabled={view === 'edit-results' ? !editedAvailable : view === 'selfie' ? !selfieAvailable : !galleryAvailable && !galleryUnavailableAction}
            title={view === 'selfie' ? selfieAvailable ? label : 'Selfie search is unavailable' : view === 'edit-results' ? editedExpired ? 'Edited Photos access expired' : !editedAvailable ? 'Edited photos are not published yet' : label : !galleryAvailable ? 'Ask Team Orbit to reopen Photo Selection' : label}
            onClick={() => view === 'gallery' ? onAllPhotos() : onChange(view)}
            aria-expanded={view === 'gallery' ? allPhotosMenuOpen : undefined}
            className={clsx('inline-flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition-[color,background-color,border-color,transform] duration-150 enabled:active:scale-[0.98] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] sm:gap-1.5 sm:px-3 sm:text-sm lg:text-[15px]', view === 'gallery' && 'max-sm:gap-0 max-sm:px-0.5', view === 'edit-results' && 'max-sm:px-1 max-sm:text-xs', (view === 'edit-results' && !editedAvailable) || (view === 'gallery' && !galleryAvailable && !galleryUnavailableAction) ? 'cursor-not-allowed border-[var(--border)] bg-transparent text-[var(--text-muted)] opacity-60' : value === view ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]' : 'border-[var(--border)] bg-transparent text-[var(--text-secondary)] enabled:hover:border-[var(--text-muted)] enabled:hover:text-[var(--text-primary)]')}
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
            {theme === 'black' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
        </button>
    );
}
