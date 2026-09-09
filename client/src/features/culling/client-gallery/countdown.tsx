import { Clock3 } from 'lucide-react';
import clsx from 'clsx';

import { useSelectionCountdown } from './useSelectionCountdown';

export function CountdownLabel({ countdown }: { countdown: ReturnType<typeof useSelectionCountdown> }) {
    if (countdown.remainingMs === null) return null;
    const urgent = countdown.remainingMs <= 24 * 60 * 60 * 1000;
    const mobileLabel = countdown.days > 0
        ? `${countdown.days}d ${countdown.hours}h`
        : `${String(countdown.hours).padStart(2, '0')}:${String(countdown.minutes).padStart(2, '0')}:${String(countdown.seconds).padStart(2, '0')}`;
    const desktopLabel = `${String(countdown.days).padStart(2, '0')}d : ${String(countdown.hours).padStart(2, '0')}h : ${String(countdown.minutes).padStart(2, '0')}m : ${String(countdown.seconds).padStart(2, '0')}s`;

    return (
        <span className={clsx('flex h-7 shrink-0 items-center gap-1 rounded-md border bg-[var(--bg-card)] px-1.5 text-[9px] font-bold tabular-nums sm:h-8 sm:gap-1.5 sm:px-2.5 sm:text-[10px]', urgent ? 'border-rose-500/45 text-rose-400' : 'border-[var(--border)] text-[var(--text-secondary)]')} title="Selection time remaining">
            <Clock3 size={12} />
            <span className="sm:hidden">{mobileLabel}</span>
            <span className="hidden sm:inline">{desktopLabel}</span>
        </span>
    );
}
