import { useEffect, useRef } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import clsx from 'clsx';

export type SubmissionStatus = 'ready' | 'dirty' | 'pending' | 'submitted';

const STATUS_LABELS = {
    ready: 'Select photos',
    dirty: 'Not submitted',
    pending: 'Submitting…',
    submitted: 'Submitted',
} as const;

export const submissionStatusLabel = (status: SubmissionStatus) => STATUS_LABELS[status];

export function SubmissionAction({ status, disabled, opening, overLimit, clearsSelection, onReview }: {
    status: SubmissionStatus;
    disabled: boolean;
    opening: boolean;
    overLimit: boolean;
    clearsSelection: boolean;
    onReview: () => void;
}) {
    const pending = status === 'pending';
    const busy = pending || opening;
    const actionRef = useRef<HTMLButtonElement>(null);
    const previousStatusRef = useRef(status);

    useEffect(() => {
        const previousStatus = previousStatusRef.current;
        previousStatusRef.current = status;
        if (previousStatus === status || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const actionAnimation = actionRef.current?.animate([
            { transform: 'translateY(2px) scale(0.99)' },
            { transform: 'translateY(0) scale(1)' },
        ], { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
        return () => {
            actionAnimation?.cancel();
        };
    }, [status]);

    return (
        <button
            ref={actionRef}
            data-testid="submission-action"
            type="button"
            disabled={disabled}
            aria-busy={busy}
            onClick={onReview}
            className={clsx(
                'flex min-h-11 w-[9.5rem] shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-[var(--border)] px-3 text-xs font-semibold transition-[color,background-color,opacity,transform] duration-150 active:scale-[0.97] disabled:opacity-45 disabled:active:scale-100 motion-reduce:transition-none sm:w-44 sm:px-4 sm:text-sm',
                overLimit ? 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/15' : 'bg-[var(--accent)] text-[var(--bg-deep)] hover:opacity-90',
            )}
        >
            {busy ? <Loader2 aria-hidden="true" size={15} className="animate-spin motion-reduce:animate-none" /> : null}
            {opening ? 'Opening review…' : clearsSelection ? 'Review Changes' : 'Review Selection'}
            {!busy && <ArrowRight aria-hidden="true" size={15} />}
        </button>
    );
}
