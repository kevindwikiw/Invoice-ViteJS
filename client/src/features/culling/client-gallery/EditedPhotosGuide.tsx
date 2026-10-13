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
        { title: 'Open a folder', description: 'Choose a folder to see the photos inside it. Use the back arrow to return to its parent.', icon: Folder },
        { title: 'Switch folders', description: 'Use the folder button at the bottom to jump directly to another folder.', icon: FolderOpen },
        { title: 'View and download', description: hasArchive ? 'Open a photo to view or download it. Download All saves the complete gallery as a ZIP.' : 'Open a photo to view it full size or download it.', icon: Download },
    ] : [
        { title: 'Browse your photos', description: 'Select any photo to view it full size.', icon: Images },
        { title: 'Download your photos', description: hasArchive ? 'Download individual photos, or use Download All for the complete ZIP.' : 'Open a photo and use its download button to save it.', icon: Download },
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
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3" aria-label={`Step ${step + 1} of ${steps.length}`}>
            {steps.map((item, index) => <span key={item.title} aria-current={index === step ? 'step' : undefined} className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${index === step ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}>{index + 1}</span>)}
        </div>
        <div className="flex min-h-52 flex-col justify-center px-6 py-8" aria-live="polite">
            {(() => { const item = steps[step]; const Icon = item.icon; return <><Icon size={28} aria-hidden="true" className="mb-5 text-[var(--text-secondary)]" /><h3 className="font-sans text-lg font-semibold normal-case tracking-normal text-[var(--text-primary)]">{item.title}</h3><p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--text-secondary)]">{item.description}</p></>; })()}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-4">
            <span className="text-xs tabular-nums text-[var(--text-muted)]">{step + 1} / {steps.length}</span>
            <div className="flex gap-2">
                {step > 0 && <button type="button" onClick={() => setStep((current) => current - 1)} className="h-11 rounded-md border border-[var(--border)] px-4 text-sm font-medium hover:bg-[var(--bg-card)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">Back</button>}
                <button type="button" onClick={() => step < steps.length - 1 ? setStep((current) => current + 1) : closeGuide()} className="inline-flex h-11 items-center gap-2 rounded-md bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--bg-deep)] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]">{step < steps.length - 1 ? 'Next' : 'View photos'}{step < steps.length - 1 && <ArrowRight size={15} aria-hidden="true" />}</button>
            </div>
        </div>
    </dialog>, document.body);
}
