import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import clsx from 'clsx';
import './gallery-modal.css';

export function GalleryModal({ title, close, children, footer, busy = false, widthClass = 'max-w-2xl', maxHeightClass = 'max-h-[90dvh]', layerClass = 'z-[100]', style }: {
    title: string;
    close: () => void;
    children: ReactNode;
    footer?: ReactNode;
    busy?: boolean;
    widthClass?: string;
    maxHeightClass?: string;
    layerClass?: string;
    style?: CSSProperties;
}) {
    const overlayRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const latest = useRef({ close, busy });
    const closing = useRef(false);
    useLayoutEffect(() => { latest.current = { close, busy }; });

    const dismiss = () => {
        if (latest.current.busy || closing.current) return;
        closing.current = true;
        const overlay = overlayRef.current;
        const panel = panelRef.current;
        if (!overlay || !panel || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            latest.current.close();
            return;
        }
        overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' });
        const animation = panel.animate([{ transform: 'none' }, { transform: 'translateY(6px) scale(.99)' }], { duration: 120, fill: 'forwards', easing: 'ease-out' });
        void animation.finished.then(() => { if (panel.isConnected) latest.current.close(); }).catch(() => {});
    };
    const dismissRef = useRef(dismiss);
    useLayoutEffect(() => { dismissRef.current = dismiss; });

    useLayoutEffect(() => {
        const panel = panelRef.current!;
        const opener = document.activeElement as HTMLElement | null;
        const scrollY = window.scrollY;
        const body = document.body;
        const previous = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow, paddingRight: body.style.paddingRight };
        const scrollbar = window.innerWidth - document.documentElement.clientWidth;
        body.style.position = 'fixed';
        body.style.top = `-${scrollY}px`;
        body.style.width = '100%';
        body.style.overflow = 'hidden';
        if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
        panel.focus({ preventScroll: true });

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                if (!latest.current.busy) latest.current.close();
            }
            if (event.key !== 'Tab') return;
            const elements = [...panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]')].filter((element) => element.getClientRects().length > 0);
            const first = elements[0];
            const last = elements.at(-1);
            if (!first || !last) { event.preventDefault(); panel.focus(); return; }
            if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            Object.assign(body.style, previous);
            window.scrollTo({ top: scrollY, behavior: 'instant' });
            if (opener?.isConnected) opener.focus({ preventScroll: true });
        };
    }, []);

    return createPortal(
        <div ref={overlayRef} style={style} className={clsx('gallery-modal-overlay fixed inset-0 flex items-center justify-center bg-black/60 p-4', layerClass)} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => { if (event.target === event.currentTarget) dismissRef.current(); }}>
            <div ref={panelRef} tabIndex={-1} className={clsx('gallery-modal-panel flex w-full min-w-0 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl outline-none', maxHeightClass, widthClass)}>
                <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-6">
                    <h2 className="min-w-0 break-words text-base font-semibold text-[var(--text-primary)]">{title}</h2>
                    <button type="button" disabled={busy} onClick={dismiss} aria-label={`Close ${title}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-40"><X size={18} /></button>
                </header>
                <div className="gallery-modal-scroll min-h-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">{children}</div>
                {footer && <footer className="gallery-modal-footer flex shrink-0 items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 sm:px-6">{footer}</footer>}
            </div>
        </div>, document.body,
    );
}
