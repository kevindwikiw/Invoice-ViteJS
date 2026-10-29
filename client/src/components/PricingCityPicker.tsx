import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

type PricingCityPickerProps = {
    value: string;
    cities: string[];
    onChange: (city: string) => void;
};

export function PricingCityPicker({ value, cities, onChange }: PricingCityPickerProps) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const closeOutside = (event: MouseEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', closeOutside);
        return () => document.removeEventListener('mousedown', closeOutside);
    }, [open]);

    return (
        <div ref={containerRef} className="event-city-picker relative shrink-0">
            <button
                id="pricing-city"
                type="button"
                aria-label="Kota Acara"
                aria-expanded={open}
                aria-haspopup="listbox"
                onClick={() => setOpen((previous) => !previous)}
                className="flex h-full w-full items-center justify-between gap-1 text-left font-display text-sm font-medium text-[var(--text-primary)]"
            >
                <span className="truncate">{value || 'Kota'}</span>
                <ChevronDown size={14} className="shrink-0 text-[var(--text-muted)]" />
            </button>
            {open && (
                <div className="absolute left-0 top-full z-50 mt-3 min-w-44 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-3 shadow-2xl ring-4 ring-black/10">
                    <div className="mb-2 px-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--accent)]">Kota Acara</div>
                    <div role="listbox" aria-label="Pilih Kota Acara" className="space-y-1">
                        {cities.length ? cities.map((city) => (
                            <button
                                key={city}
                                type="button"
                                role="option"
                                aria-selected={value.toLocaleLowerCase('id-ID') === city.toLocaleLowerCase('id-ID')}
                                onClick={() => { onChange(city); setOpen(false); }}
                                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left font-display text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--accent)]/10 aria-selected:bg-[var(--accent)]/10 aria-selected:text-[var(--accent)]"
                            >
                                {city}
                                {value.toLocaleLowerCase('id-ID') === city.toLocaleLowerCase('id-ID') && <Check size={14} />}
                            </button>
                        )) : <p className="px-2 py-1 text-xs text-[var(--text-muted)]">Belum ada kota di tarif paket</p>}
                    </div>
                </div>
            )}
        </div>
    );
}
