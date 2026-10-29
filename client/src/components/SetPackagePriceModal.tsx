import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { PackageData } from '../types/invoice';

type SetPackagePriceModalProps = {
    pkg: PackageData;
    city: string;
    year: number;
    onSave: (price: number) => Promise<void>;
    onClose: () => void;
};

export function SetPackagePriceModal({ pkg, city, year, onSave, onClose }: SetPackagePriceModalProps) {
    const [draft, setDraft] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const closeRef = useRef(onClose);
    const savingRef = useRef(saving);

    useEffect(() => {
        closeRef.current = onClose;
        savingRef.current = saving;
    }, [onClose, saving]);

    useEffect(() => {
        const previousFocus = document.activeElement as HTMLElement | null;
        inputRef.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !savingRef.current) closeRef.current();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            previousFocus?.focus();
        };
    }, []);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const price = Number(draft);
        if (draft === '' || !Number.isSafeInteger(price) || price < 0 || (year === 2026 && price === 0 && pkg.category !== 'Free / Complimentary')) {
            setError('Masukkan harga paket yang valid.');
            inputRef.current?.focus();
            return;
        }
        setSaving(true);
        setError('');
        try {
            await onSave(price);
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Gagal menyimpan harga. Coba lagi.');
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/65 p-4">
            <div role="dialog" aria-modal="true" aria-labelledby="set-package-price-title" className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-[var(--text-primary)] shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <p className="label-xs text-[var(--accent)]">{city} · {year}</p>
                        <h2 id="set-package-price-title" className="mt-1 font-display text-2xl font-medium">Isi harga paket</h2>
                        <p className="mt-1 truncate text-sm text-[var(--text-secondary)]" title={pkg.name}>{pkg.name}</p>
                    </div>
                    <button type="button" onClick={onClose} disabled={saving} aria-label="Tutup" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"><X size={17} aria-hidden="true" /></button>
                </div>
                <form onSubmit={submit} className="mt-6">
                    <label htmlFor="new-package-price" className="label-xs text-[var(--text-muted)]">Harga {city} {year}</label>
                    <div className="mt-2 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-deep)] px-4 focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/20">
                        <span className="text-sm font-semibold text-[var(--accent)]">Rp</span>
                        <input ref={inputRef} id="new-package-price" name="packagePrice" type="text" inputMode="numeric" autoComplete="off" value={draft === '' ? '' : Number(draft).toLocaleString('id-ID')} onChange={(event) => setDraft(event.target.value.replace(/\D/g, ''))} placeholder="Masukkan harga" className="set-package-price-input h-12 min-w-0 flex-1 text-right font-display text-lg font-semibold tabular-nums" />
                    </div>
                    {year > 2026 && pkg.price > 0 && <p className="mt-2 text-xs text-[var(--text-muted)]">Harga umum 2026: Rp {pkg.price.toLocaleString('id-ID')}</p>}
                    {error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}
                    <div className="mt-6 flex items-center justify-end gap-3">
                        <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">Batal</button>
                        <button type="submit" disabled={saving} className="rounded-lg bg-[var(--accent)] px-4 py-2.5 text-xs font-bold text-[var(--bg-deep)] transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-card)]">{saving ? 'Menyimpan…' : 'Simpan & Tambahkan'}</button>
                    </div>
                </form>
            </div>
        </div>,
        document.body,
    );
}
