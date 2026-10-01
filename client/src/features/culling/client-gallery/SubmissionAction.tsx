import { useEffect, useRef } from 'react';
import { Check, Circle, Loader2, Send } from 'lucide-react';
import clsx from 'clsx';

export type SubmissionStatus = 'ready' | 'dirty' | 'pending' | 'submitted';

const STATUS_CONTENT = {
    ready: { label: 'Ready to submit', Icon: Circle },
    dirty: { label: 'Not submitted', Icon: Circle },
    pending: { label: 'Submitting', Icon: Loader2 },
    submitted: { label: 'Submitted', Icon: Check },
} as const;

export function SubmissionAction({ status, disabled, overLimit, onSubmit }: {
    status: SubmissionStatus;
    disabled: boolean;
    overLimit: boolean;
    onSubmit: () => void;
}) {
    const { label, Icon } = STATUS_CONTENT[status];
    const pending = status === 'pending';
    const actionRef = useRef<HTMLDivElement>(null);
    const statusRef = useRef<HTMLSpanElement>(null);
    const previousStatusRef = useRef(status);

    useEffect(() => {
        const previousStatus = previousStatusRef.current;
        previousStatusRef.current = status;
        if (previousStatus === status || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        const actionAnimation = actionRef.current?.animate([
            { transform: 'translateY(2px) scale(0.99)' },
            { transform: 'translateY(0) scale(1)' },
        ], { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
        const statusAnimation = statusRef.current?.animate([
            { opacity: 0.35, transform: 'translateY(3px)' },
            { opacity: 1, transform: 'translateY(0)' },
        ], { duration: 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });

        return () => {
            actionAnimation?.cancel();
            statusAnimation?.cancel();
        };
    }, [status]);

    return (
        <div
            ref={actionRef}
            data-testid="submission-action"
            className="flex h-11 w-[188px] shrink-0 items-stretch overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-card)] sm:w-[228px]"
        >
            <span
                ref={statusRef}
                data-testid="submission-status"
                role="status"
                className={clsx(
                    'flex min-w-0 flex-1 items-center gap-1 whitespace-nowrap px-2 text-[10px] font-medium sm:gap-1.5 sm:px-3 sm:text-[11px]',
                    status === 'dirty' ? 'text-[var(--accent)]' : status === 'submitted' ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]',
                )}
            >
                <Icon size={status === 'dirty' ? 7 : 11} fill={status === 'dirty' ? 'currentColor' : 'none'} className={clsx('shrink-0', pending && 'animate-spin motion-reduce:animate-none')} />
                <span className="truncate">{label}</span>
            </span>

            <button
                type="button"
                disabled={disabled}
                onClick={onSubmit}
                className={clsx(
                    'flex w-[88px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap px-2 text-[13px] font-semibold transition-[color,background-color,opacity,transform] duration-150 active:scale-[0.97] disabled:opacity-45 disabled:active:scale-100 motion-reduce:transition-none sm:w-24',
                    overLimit ? 'bg-rose-500/10 text-rose-400 hover:bg-rose-500/15' : 'bg-[var(--accent)] text-[var(--bg-deep)] hover:opacity-90',
                )}
            >
                {pending ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" /> : <Send size={13} />}
                Submit
            </button>
        </div>
    );
}
