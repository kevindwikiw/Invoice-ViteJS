import { useEffect, useState, useRef } from 'react';
import { ArrowRight, Clock, Minus } from 'lucide-react';
import clsx from 'clsx';

interface TimeRangePickerProps {
    value: string;
    onChange: (value: string) => void;
    className?: string;
    id?: string;
    name?: string;
}

function toMinutes(time: string): number | null {
    if (!time || time === '??:??') return null;
    const [h, m] = time.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
}

function fromMinutes(totalMinutes: number): string {
    const clamped = Math.max(0, Math.min(24 * 60, totalMinutes));
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function calcHours(start: string, end: string): string | null {
    const startM = toMinutes(start);
    const endM = toMinutes(end);
    if (startM == null || endM == null) return null;
    const diff = endM - startM;
    if (diff <= 0) return 'Error';
    const hrs = Math.floor(diff / 60);
    const mins = diff % 60;
    return mins === 0 ? `${hrs}h` : `${hrs}h ${mins}m`;
}

function parseRange(value: string): [string, string] {
    const [start, end] = value.split(' - ');
    return start && end ? [start, end] : ['08:00', '17:00'];
}

export function TimeRangePicker({ value, onChange, className, id, name }: TimeRangePickerProps) {
    const [start, end] = parseRange(value);
    const [activeTarget, setActiveTarget] = useState<'start' | 'end' | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setActiveTarget(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const updateTime = (val: string, target: 'start' | 'end') => {
        let nStart = start;
        let nEnd = end;
        if (target === 'start') nStart = val; else nEnd = val;

        const sM = toMinutes(nStart);
        const eM = toMinutes(nEnd);

        if (sM != null && eM != null && eM <= sM) {
            nEnd = fromMinutes(sM + 60); // Auto-add 1 hour if logically wrong
        }

        onChange(`${nStart} - ${nEnd}`);
    };

    const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
    const minutes = ['00', '15', '30', '45'];
    const duration = calcHours(start, end);

    return (
        <div ref={containerRef} className={clsx('w-full relative h-[48px]', className)}>
            <div className={clsx(
                "flex h-full items-center rounded-xl border bg-transparent px-4 transition-all duration-200",
                activeTarget
                    ? "border-[var(--accent)] bg-[var(--accent)]/5 shadow-[0_0_15px_rgba(var(--accent-rgb),0.1)]"
                    : "border-[var(--border)]"
            )}>
                <button
                    type="button"
                    id={id}
                    name={name}
                    onClick={() => setActiveTarget('start')}
                    className={clsx(
                        "flex h-full min-w-0 flex-1 items-center justify-between text-left text-sm font-medium font-display transition-colors",
                        activeTarget === 'start' ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
                    )}
                >
                    <span className="truncate">{value ? start : 'TBA'}</span>
                    <Clock size={14} className={activeTarget === 'start' ? "text-[var(--accent)]" : "text-[var(--text-muted)]"} />
                </button>

                <ArrowRight size={13} className="mx-3 shrink-0 text-[var(--text-muted)]/60" />

                <button
                    type="button"
                    onClick={() => setActiveTarget('end')}
                    className={clsx(
                        "flex h-full min-w-0 flex-1 items-center justify-between text-right text-sm font-medium font-display transition-colors",
                        activeTarget === 'end' ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
                    )}
                >
                    <span className="truncate">{value ? end : 'TBA'}</span>
                    <div className="ml-2 flex shrink-0 items-center gap-1.5">
                        {value && duration && !duration.includes('Error') && (
                            <span className="text-[9px] font-black tracking-wide text-[var(--accent)]">{duration}</span>
                        )}
                        <Clock size={14} className={activeTarget === 'end' ? "text-[var(--accent)]" : "text-[var(--text-muted)]"} />
                    </div>
                </button>
            </div>

            {/* SELECTION POPOVER */}
            {activeTarget && (
                <div className="absolute left-0 right-0 top-full mt-2 z-50 bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-4 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200 ring-4 ring-black/10">
                    <div className="flex items-center justify-between mb-4 px-1">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--accent)]">Select {activeTarget} Time</h4>
                        <div className="flex gap-1">
                            <button onClick={() => setActiveTarget(null)} className="h-6 w-6 rounded-full flex items-center justify-center hover:bg-[var(--bg-elevated)] transition-colors">
                                <Minus size={12} className="text-[var(--text-muted)]" />
                            </button>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-6 gap-1 max-h-[160px] overflow-y-auto no-scrollbar py-1">
                        {hours.map(h => (
                            <button
                                key={h}
                                onClick={() => {
                                    const currentM = (activeTarget === 'start' ? start : end).split(':')[1];
                                    updateTime(`${h}:${currentM}`, activeTarget!);
                                }}
                                className={clsx(
                                    "h-8 rounded-lg text-[11px] font-mono-var font-black transition-all",
                                    (activeTarget === 'start' ? start : end).startsWith(h)
                                        ? "bg-[var(--accent)] text-[var(--bg-deep)]"
                                        : "bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)]/40 border border-transparent"
                                )}
                            >
                                {h}
                            </button>
                        ))}
                    </div>

                    <div className="flex gap-2 mt-4 pt-4 border-t border-[var(--border)]/60">
                        {minutes.map(m => (
                            <button
                                key={m}
                                onClick={() => {
                                    const currentH = (activeTarget === 'start' ? start : end).split(':')[0];
                                    updateTime(`${currentH}:${m}`, activeTarget!);
                                }}
                                className={clsx(
                                    "flex-1 h-9 rounded-xl text-[10px] font-mono-var font-black border transition-all",
                                    (activeTarget === 'start' ? start : end).endsWith(m)
                                        ? "bg-[var(--accent)]/10 border-[var(--accent)] text-[var(--accent)]"
                                        : "bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                )}
                            >
                                :{m}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
