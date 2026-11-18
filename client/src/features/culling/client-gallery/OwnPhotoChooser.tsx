import { useEffect, useRef, useState } from 'react';
import { Check, ScanFace, X } from 'lucide-react';
import clsx from 'clsx';

export type OwnPhotoCategory = 'female' | 'male';
export type OwnPhotoSensitivity = 'strict' | 'balanced' | 'wide';

const sensitivityOptions: Array<{ value: OwnPhotoSensitivity; label: string; description: string }> = [
    { value: 'strict', label: 'Ketat', description: 'Hasil dengan kecocokan paling yakin.' },
    { value: 'balanced', label: 'Normal', description: 'Seimbang antara jumlah dan kecocokan.' },
    { value: 'wide', label: 'Luas', description: 'Lebih banyak kandidat untuk diperiksa.' },
];

export function OwnPhotoChooser({ category, sensitivity, onApply, onClear, onClose }: {
    category: OwnPhotoCategory | null;
    sensitivity: OwnPhotoSensitivity;
    onApply: (category: OwnPhotoCategory, sensitivity: OwnPhotoSensitivity) => void;
    onClear?: () => void;
    onClose: () => void;
}) {
    const [selectedCategory, setSelectedCategory] = useState<OwnPhotoCategory | null>(category);
    const [selectedSensitivity, setSelectedSensitivity] = useState<OwnPhotoSensitivity>(sensitivity);
    const dialogRef = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        dialogRef.current?.focus({ preventScroll: true });
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }
            if (event.key !== 'Tab') return;
            const controls = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
            if (!controls?.length) return;
            const first = controls[0]!;
            const last = controls[controls.length - 1]!;
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
            previousFocus?.focus({ preventScroll: true });
        };
    }, []);

    const selectedDescription = sensitivityOptions.find((option) => option.value === selectedSensitivity)?.description;

    return <div className="fixed inset-0 z-[120] flex items-end justify-center overscroll-contain bg-black/70 sm:items-center sm:p-4" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="own-photo-title" aria-describedby="own-photo-description" className="max-h-[min(92dvh,680px)] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl border border-[var(--border)] bg-[var(--bg-deep)] px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-[var(--text-primary)] shadow-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] sm:rounded-2xl sm:p-6">
            <div aria-hidden="true" className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--text-muted)] opacity-50 sm:hidden" />
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <h2 id="own-photo-title" className="font-sans text-xl font-semibold leading-tight [text-wrap:balance]">Foto Sendiri</h2>
                    <p id="own-photo-description" className="mt-1.5 text-sm leading-5 text-[var(--text-secondary)]">Cari foto Cewe atau Cowo tanpa pasangannya.</p>
                </div>
                <button type="button" aria-label="Tutup Foto Sendiri" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"><X size={18} aria-hidden="true" /></button>
            </div>

            <div className="mt-6">
                <p id="own-photo-person-label" className="mb-2 text-sm font-semibold">Siapa yang dicari?</p>
                <div role="group" aria-labelledby="own-photo-person-label" className="grid grid-cols-2 gap-2">
                    {(['female', 'male'] as const).map((person) => {
                        const selected = selectedCategory === person;
                        return <button key={person} type="button" aria-pressed={selected} onClick={() => setSelectedCategory(person)} className={clsx('flex min-h-24 flex-col items-start justify-between rounded-xl border p-3 text-left transition-[background-color,border-color] hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]', selected ? 'border-[var(--accent)] bg-[var(--accent-muted)]' : 'border-[var(--border)] bg-[var(--bg-card)]')}>
                            <span className="flex w-full items-center justify-between gap-2"><ScanFace size={18} aria-hidden="true" className={selected ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'} />{selected && <Check size={16} aria-hidden="true" className="text-[var(--accent)]" />}</span>
                            <span><span className="block text-sm font-semibold">Foto {person === 'female' ? 'Cewe' : 'Cowo'}</span><span className="mt-0.5 block text-xs text-[var(--text-secondary)]">Tanpa {person === 'female' ? 'Cowo' : 'Cewe'}</span></span>
                        </button>;
                    })}
                </div>
            </div>

            <div className="mt-6 border-t border-[var(--border)] pt-5">
                <p id="own-photo-sensitivity-label" className="mb-2 text-sm font-semibold">Tingkat kecocokan</p>
                <div role="group" aria-labelledby="own-photo-sensitivity-label" className="grid grid-cols-3 gap-2">
                    {sensitivityOptions.map((option) => <button key={option.value} type="button" aria-pressed={selectedSensitivity === option.value} onClick={() => setSelectedSensitivity(option.value)} className={clsx('min-h-11 rounded-md border px-2 text-xs font-semibold transition-[background-color,border-color] hover:border-[var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]', selectedSensitivity === option.value ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg-deep)]' : 'border-[var(--border)] text-[var(--text-secondary)]')}>{option.label}</button>)}
                </div>
                <p className="mt-2 min-h-5 text-xs leading-5 text-[var(--text-secondary)]" role="status" aria-live="polite">{selectedDescription}</p>
            </div>

            <p className="mt-4 text-xs leading-5 text-[var(--text-muted)]">Foto bersama tamu boleh muncul. Sistem mengecualikan foto jika wajah pasangan dikenali.</p>
            <div className="mt-6 flex items-center gap-3">
                {category && onClear && <button type="button" onClick={onClear} className="min-h-11 shrink-0 rounded-md px-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">Hapus filter</button>}
                <button type="button" disabled={!selectedCategory} onClick={() => { if (selectedCategory) onApply(selectedCategory, selectedSensitivity); }} className="min-h-12 flex-1 rounded-md bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--bg-deep)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40">{selectedCategory ? 'Tampilkan Foto ' + (selectedCategory === 'female' ? 'Cewe' : 'Cowo') : 'Pilih Cewe atau Cowo'}</button>
            </div>
        </div>
    </div>;
}
