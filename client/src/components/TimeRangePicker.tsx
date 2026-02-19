import { useState, useEffect } from 'react';
import { Clock, ArrowRight } from 'lucide-react';
import clsx from 'clsx';

interface TimeRangePickerProps {
    value: string;
    onChange: (value: string) => void;
    className?: string;
}

export function TimeRangePicker({ value, onChange, className }: TimeRangePickerProps) {
    // Parse initial value "HH:mm - HH:mm"
    const [start, setStart] = useState('');
    const [end, setEnd] = useState('');

    useEffect(() => {
        if (!value) {
            setStart('');
            setEnd('');
            return;
        }
        const parts = value.split(' - ');
        if (parts.length === 2) {
            setStart(parts[0]);
            setEnd(parts[1]);
        } else {
            // If random text, try to put it in start or just ignore
            setStart(value);
        }
    }, [value]);

    const handleUpdate = (newStart: string, newEnd: string) => {
        setStart(newStart);
        setEnd(newEnd);

        if (newStart || newEnd) {
            onChange(`${newStart || '??:??'} - ${newEnd || '??:??'}`);
        } else {
            onChange('');
        }
    };

    return (
        <div className={clsx("flex items-center gap-2", className)}>
            <div className="relative flex-1">
                <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                    type="time"
                    value={start}
                    onChange={(e) => handleUpdate(e.target.value, end)}
                    className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg pl-9 pr-2 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none transition-colors [color-scheme:dark]"
                />
            </div>

            <ArrowRight size={14} className="text-[var(--text-muted)]" />

            <div className="relative flex-1">
                <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                    type="time"
                    value={end}
                    onChange={(e) => handleUpdate(start, e.target.value)}
                    className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg pl-9 pr-2 py-2.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none transition-colors [color-scheme:dark]"
                />
            </div>


        </div>
    );
}
