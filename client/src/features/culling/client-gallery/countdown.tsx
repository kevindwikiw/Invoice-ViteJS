import { Clock3 } from 'lucide-react';
import clsx from 'clsx';

import { useSelectionCountdown } from './useSelectionCountdown';

export function CountdownLabel({ countdown }: { countdown: ReturnType<typeof useSelectionCountdown> }) {
    if (countdown.remainingMs === null) return null;
    const urgent = countdown.remainingMs <= 24 * 60 * 60 * 1000;
    const mobileLabel = countdown.days > 0
        ? `${countdown.days}d ${countdown.hours}h`
        : `${String(countdown.hours).padStart(2, '0')}:${String(countdown.minutes).padStart(2, '0')}:${String(countdown.seconds).padStart(2, '0')}`;
    const desktopLabel = `${String(countdown.days).padStart(2, '0')}d ${String(countdown.hours).padStart(2, '0')}h ${String(countdown.minutes).padStart(2, '0')}m ${String(countdown.seconds).padStart(2, '0')}s`;

    return (
        <span data-testid="gallery-countdown" className={clsx('inline-flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap px-0.5 text-[11px] font-normal leading-none tabular-nums', urgent ? 'text-rose-500' : 'text-[var(--text-muted)]')} title="Selection time remaining">
            <Clock3 data-testid="gallery-countdown-icon" size={12} className="shrink-0" />
            <span data-testid="gallery-countdown-value" className="sm:hidden">{mobileLabel}</span>
            <span data-testid="gallery-countdown-value-desktop" className="hidden sm:inline">{desktopLabel}</span>
        </span>
    );
}
