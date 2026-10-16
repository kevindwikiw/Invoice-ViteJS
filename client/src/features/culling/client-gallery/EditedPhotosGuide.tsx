import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Download, Folder, FolderOpen, Images, X } from 'lucide-react';

import { BLACK_THEME, WHITE_THEME } from './constants';
import type { GalleryTheme } from './types';

type GuideStep = { title: string; description: string; icon: typeof Folder };

export function EditedPhotosGuide({ open, onClose, theme, hasFolders, hasArchive }: {
    open: boolean;
    onClose: () => void;
    theme: GalleryTheme;
    hasFolders: boolean;
    hasArchive: boolean;
}) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const [step, setStep] = useState(0);
    const steps: GuideStep[] = hasFolders ? [
        { title: 'Open a folder', description: 'Choose a folder to see the photos inside. Use the back arrow to return to its parent folder.', icon: Folder },
        { title: 'Switch folders', description: 'Inside a folder, use the folder button at the bottom to jump directly to another folder.', icon: FolderOpen },
        { title: 'View and download', description: hasArchive ? 'Open a photo to view or download it. Download All Photos saves the complete gallery.' : 'Open a photo to view it full size or download it.', icon: Download },
    ] : [
        { title: 'Browse your photos', description: 'Select a thumbnail to open the finished photo in the full-size viewer.', icon: Images },
        { title: 'Download your photos', description: hasArchive ? 'Download individual photos, or use Download All Photos for the complete gallery.' : 'Open a photo and use its download button to save it.', icon: Download },
    ];
    const closeGuide = () => { setStep(0); onClose(); };

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open) {
            if (!dialog.open) dialog.showModal();
            closeRef.current?.focus({ preventScroll: true });
        } else if (dialog.open) dialog.close();
        return () => { if (dialog.open) dialog.close(); };
    }, [open]);

    return createPortal(<dialog ref={dialogRef} onCancel={(event) => { event.preventDefault(); closeGuide(); }} aria-labelledby="edited-guide-title" data-testid="edited-photos-guide" style={theme === 'black' ? BLACK_THEME : WHITE_THEME} className="fixed inset-0 m-auto max-h-[calc(100dvh-24px)] w-[min(440px,calc(100vw-24px))] overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--bg-deep)] p-0 font-sans text-[var(--text-primary)] shadow-2xl backdrop:bg-black/70">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
            <div><p className="text-xs text-[var(--text-muted)]">Edited Photos guide</p><h2 id="edited-guide-title" className="mt-1 font-display text-xl leading-tight">Find your way around</h2></div>
            <button ref={closeRef} type="button" onClick={closeGuide} aria-label="Close Edited Photos guide" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><X size={17} aria-hidden="true" /></button>
        </div>
        <div className="border-b border-[var(--border)] px-5 py-4" aria-label={`Step ${step + 1} of ${steps.length}`}>
            <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-medium text-[var(--text-muted)]">
                <span className="uppercase">Step {step + 1} of {steps.length}</span>
                <span className="max-w-[65%] truncate text-right text-[var(--text-secondary)]">{steps[step].title}</span>
            </div>
            <div role="progressbar" aria-label="Guide progress" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={step + 1} className="h-1 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
            </div>
        </div>
        <div className="flex min-h-56 flex-col items-center justify-center px-6 py-8 text-center" aria-live="polite">
            {(() => { const item = steps[step]; const Icon = item.icon; return <>
                <span className="mb-5 flex h-16 w-16 items-center justify-center border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)]"><Icon size={26} strokeWidth={1.7} aria-hidden="true" /></span>
                <h3 className="font-sans text-lg font-semibold leading-tight text-[var(--text-primary)] [text-wrap:balance]">{item.title}</h3>
                <p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--text-secondary)]">{item.description}</p>
            </>; })()}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-4">
            <span className="text-xs tabular-nums text-[var(--text-muted)]">{step + 1} / {steps.length}</span>
            <div className="flex gap-2">
                {step > 0 && <button type="button" onClick={() => setStep((current) => current - 1)} className="h-11 rounded-md border border-[var(--border)] px-4 text-sm font-medium hover:bg-[var(--bg-card)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">Back</button>}
                <button type="button" onClick={() => step < steps.length - 1 ? setStep((current) => current + 1) : closeGuide()} className="inline-flex h-11 items-center gap-2 rounded-md bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--bg-deep)] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">{step < steps.length - 1 ? 'Next step' : 'View photos'}{step < steps.length - 1 && <ArrowRight size={15} aria-hidden="true" />}</button>
            </div>
        </div>
    </dialog>, document.body);
}
