import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Instagram } from 'lucide-react';

export function GalleryFooter({ className }: { className?: string }) {
    const [currentYear, setCurrentYear] = useState<number | null>(null);

    useEffect(() => setCurrentYear(new Date().getFullYear()), []);

    return <footer data-testid="gallery-footer" className={clsx('mt-auto border-t border-[var(--border)] px-4 py-4 font-sans text-xs leading-5 text-[var(--text-muted)] md:px-8', className)}>
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-2 sm:gap-3">
            <p className="min-w-0 whitespace-nowrap"><span className="sm:hidden">&copy; {currentYear ?? ''} The Orbit Photo</span><span className="hidden sm:inline">&copy; {currentYear ?? ''} The Orbit Photo. All rights reserved.</span></p>
            <a href="https://www.instagram.com/theorbitphoto/" target="_blank" rel="noreferrer" aria-label="@theorbitphoto on Instagram" className="inline-flex min-h-11 items-center gap-2 font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                <Instagram size={16} aria-hidden="true" /> @theorbitphoto
            </a>
        </div>
    </footer>;
}
