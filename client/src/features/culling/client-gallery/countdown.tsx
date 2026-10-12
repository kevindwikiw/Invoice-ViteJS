import { Clock3 } from 'lucide-react';
import clsx from 'clsx';

import { useSelectionCountdown } from './useSelectionCountdown';

export function CountdownLabel({ countdown, compact = false }: { countdown: ReturnType<typeof useSelectionCountdown>; compact?: boolean }) {
    if (countdown.remainingMs === null) return null;
    const urgent = countdown.remainingMs <= 24 * 60 * 60 * 1000;
    const time = `${String(countdown.hours).padStart(2, '0')}:${String(countdown.minutes).padStart(2, '0')}:${String(countdown.seconds).padStart(2, '0')}`;
    const mobileLabel = countdown.days > 0 ? `${countdown.days}d ${time}` : time;
    const desktopLabel = countdown.days > 0
        ? `${countdown.days}d ${String(countdown.hours).padStart(2, '0')}h ${String(countdown.minutes).padStart(2, '0')}m ${String(countdown.seconds).padStart(2, '0')}s`
        : time;

    return (
        <span data-testid="gallery-countdown" className={clsx('inline-flex shrink-0 items-center gap-1 whitespace-nowrap px-0.5 text-xs font-normal leading-none tabular-nums sm:text-[13px] lg:text-[15px]', !compact && 'min-h-11', urgent ? 'text-rose-500' : 'text-[var(--text-muted)]')} title="Selection time remaining">
            <Clock3 data-testid="gallery-countdown-icon" size={14} aria-hidden="true" className="shrink-0" />
            <span data-testid="gallery-countdown-value" className="sm:hidden">{mobileLabel}</span>
            <span data-testid="gallery-countdown-value-desktop" className="hidden sm:inline">{desktopLabel}</span>
        </span>
    );
}
