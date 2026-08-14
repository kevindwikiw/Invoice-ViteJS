import {
    useEffect,
    useId,
    useRef,
    type ReactNode,
} from 'react';
import { X, type LucideIcon } from 'lucide-react';

interface ModalShellProps {
    open: boolean;
    title: string;
    description?: string;
    icon?: LucideIcon;
    children: ReactNode;
    footer?: ReactNode;
    onClose: () => void;
}

export function ModalShell({
    open,
    title,
    description,
    icon: Icon,
    children,
    footer,
    onClose,
}: ModalShellProps) {
    const titleId = useId();
    const descriptionId = useId();
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const panel = panelRef.current;
        const firstFocusable = panel?.querySelector<HTMLElement>(
            'input, select, button, textarea, [tabindex]:not([tabindex="-1"])',
        );
        firstFocusable?.focus();

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            previouslyFocused?.focus();
        };
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={description ? descriptionId : undefined}
                className="w-full max-w-md overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl animate-in zoom-in-95 duration-150"
            >
                <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-6 py-5">
                    <div className="flex min-w-0 items-start gap-3">
                        {Icon && (
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[var(--accent)]">
                                <Icon size={17} />
                            </div>
                        )}
                        <div className="min-w-0">
                            <h2 id={titleId} className="font-display text-lg font-semibold text-[var(--text-primary)]">
                                {title}
                            </h2>
                            {description && (
                                <p id={descriptionId} className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                                    {description}
                                </p>
                            )}
                        </div>
                    </div>
                    <button
                        type="button"
                        aria-label="Close dialog"
                        onClick={onClose}
                        className="rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                    >
                        <X size={17} />
                    </button>
                </div>
                <div className="px-6 py-5">{children}</div>
                {footer && (
                    <div className="flex items-center justify-end gap-3 border-t border-[var(--border)] px-6 py-4">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
}

