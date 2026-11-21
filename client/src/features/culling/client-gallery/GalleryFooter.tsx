import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Instagram } from 'lucide-react';

export function GalleryFooter({ className, navigation }: { className?: string; navigation?: ReactNode }) {
    const [currentYear, setCurrentYear] = useState<number | null>(null);

    useEffect(() => setCurrentYear(new Date().getFullYear()), []);

    return <footer data-testid="gallery-footer" className={clsx('mt-auto border-t border-[var(--border)] px-4 font-sans text-xs leading-5 text-[var(--text-muted)] md:px-8', navigation ? 'relative z-20 py-3' : 'py-4', className)}>
        <div className={clsx('mx-auto max-w-[1600px] items-center', navigation ? 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]' : 'flex justify-between gap-2 sm:gap-3')}>
            {navigation && <div className="col-span-2 min-w-0 lg:col-span-1 lg:row-start-1 lg:justify-self-start">{navigation}</div>}
            <p className={clsx('min-w-0 whitespace-nowrap', navigation && 'lg:col-start-2 lg:row-start-1')}><span className="sm:hidden">&copy; {currentYear ?? ''} The Orbit Photo</span><span className="hidden sm:inline">&copy; {currentYear ?? ''} The Orbit Photo. All rights reserved.</span></p>
            <a href="https://www.instagram.com/theorbitphoto/" target="_blank" rel="noreferrer" aria-label="@theorbitphoto on Instagram" className={clsx('inline-flex min-h-11 items-center gap-2 font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]', navigation && 'justify-self-end lg:col-start-3 lg:row-start-1')}>
                <Instagram size={16} aria-hidden="true" /> @theorbitphoto
            </a>
        </div>
    </footer>;
}
