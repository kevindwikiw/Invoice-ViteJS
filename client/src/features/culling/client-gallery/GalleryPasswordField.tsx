import { useEffect, useId, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export function GalleryPasswordField({ label, name, value, onChange, error }: {
    label: string;
    name: string;
    value: string;
    onChange: (value: string) => void;
    error?: string;
}) {
    const id = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (error) inputRef.current?.focus({ preventScroll: true });
    }, [error]);

    return <div className="text-left">
        <label htmlFor={id} className="mb-2 block text-xs font-semibold text-[var(--text-secondary)]">{label}</label>
        <div className="relative">
            <input
                ref={inputRef}
                id={id}
                name={name}
                type={visible ? 'text' : 'password'}
                value={value}
                onChange={(event) => onChange(event.currentTarget.value.slice(0, 64))}
                autoComplete="current-password"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${id}-error` : undefined}
                className="h-12 w-full rounded-md border border-[var(--border)] bg-[var(--bg-deep)] pl-3 pr-12 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]/30"
            />
            <button
                type="button"
                onClick={() => setVisible((current) => !current)}
                aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
                aria-pressed={visible}
                aria-controls={id}
                className="absolute right-0 top-0 flex h-12 w-12 items-center justify-center text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
                {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
        </div>
        <div className="min-h-5 pt-1">
            {error && <p id={`${id}-error`} role="alert" className="text-xs leading-4 text-rose-400">{error}</p>}
        </div>
    </div>;
}
