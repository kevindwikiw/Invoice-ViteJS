import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Minus } from 'lucide-react';
import clsx from 'clsx';

interface DatePickerProps {
    value: string; // YYYY-MM-DD
    onChange: (value: string) => void;
    className?: string;
    id?: string;
    name?: string;
}

function parseLocalDate(value: string): Date {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function formatLocalDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function DatePicker({ value, onChange, className, id, name }: DatePickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    
    // Parse initial value
    const initialDate = value ? parseLocalDate(value) : new Date();
    const [viewDate, setViewDate] = useState(initialDate);
    
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
    const firstDayOfMonth = (y: number, m: number) => new Date(y, m, 1).getDay();

    const handleDateSelect = (d: number) => {
        const newDate = new Date(year, month, d);
        onChange(formatLocalDate(newDate));
        setIsOpen(false);
    };

    const changeMonth = (offset: number) => {
        setViewDate(new Date(year, month + offset, 1));
    };

    const calendarDays = [];
    const totalDays = daysInMonth(year, month);
    const startOffset = firstDayOfMonth(year, month);

    // Empty slots for start offset
    for (let i = 0; i < startOffset; i++) {
        calendarDays.push(null);
    }
    // Real days
    for (let i = 1; i <= totalDays; i++) {
        calendarDays.push(i);
    }

    const isSelected = (d: number | null) => {
        if (!d || !value) return false;
        const selDate = parseLocalDate(value);
        return selDate.getDate() === d && selDate.getMonth() === month && selDate.getFullYear() === year;
    };

    const isToday = (d: number | null) => {
        if (!d) return false;
        const today = new Date();
        return today.getDate() === d && today.getMonth() === month && today.getFullYear() === year;
    };

    const formatDateDisplay = () => {
        if (!value) return "TBA / TBD";
        const d = parseLocalDate(value);
        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    return (
        <div ref={containerRef} className={clsx("relative w-full h-[48px]", className)}>
            <button
                type="button"
                id={id}
                name={name}
                onClick={() => setIsOpen(!isOpen)}
                className={clsx(
                    "flex h-full w-full items-center justify-between rounded-xl border bg-transparent px-4 text-left text-sm font-medium font-display transition-all duration-200",
                    isOpen
                        ? "border-[var(--accent)] bg-[var(--accent)]/5 text-[var(--text-primary)] shadow-[0_0_15px_rgba(var(--accent-rgb),0.1)]"
                        : "border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--accent)]/40"
                )}
            >
                <span className="leading-none">{formatDateDisplay()}</span>
                <Calendar size={14} className={isOpen ? "text-[var(--accent)]" : "text-[var(--text-muted)]"} />
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 right-0 mt-2 p-4 bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-2xl z-[100] animate-in fade-in slide-in-from-top-2 duration-200 ring-4 ring-black/10">
                    {/* Header: Title & Close */}
                    <div className="flex items-center justify-between mb-4 px-1">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--accent)]">Select Event Date</h4>
                        <button onClick={() => setIsOpen(false)} className="h-6 w-6 rounded-full flex items-center justify-center hover:bg-[var(--bg-elevated)] transition-colors">
                            <Minus size={12} className="text-[var(--text-muted)]" />
                        </button>
                    </div>

                    {/* Month/Year Selector */}
                    <div className="flex items-center justify-between mb-4 px-1 bg-[var(--bg-elevated)]/30 rounded-xl p-2">
                        <button onClick={() => changeMonth(-1)} className="p-1 hover:bg-[var(--bg-elevated)] rounded-lg text-[var(--text-muted)] transition-colors">
                            <ChevronLeft size={16} />
                        </button>
                        <div className="flex flex-col items-center">
                            <span className="text-[10px] font-black uppercase tracking-widest text-[var(--accent)]">{year}</span>
                            <span className="text-sm font-bold text-[var(--text-primary)]">{months[month]}</span>
                        </div>
                        <button onClick={() => changeMonth(1)} className="p-1 hover:bg-[var(--bg-elevated)] rounded-lg text-[var(--text-muted)] transition-colors">
                            <ChevronRight size={16} />
                        </button>
                    </div>

                    {/* Weekday Names */}
                    <div className="grid grid-cols-7 gap-1 mb-2">
                        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                            <div key={d} className="text-[8px] font-black uppercase text-center text-[var(--text-muted)] tracking-tighter py-1">{d}</div>
                        ))}
                    </div>

                    {/* Days Grid */}
                    <div className="grid grid-cols-7 gap-1">
                        {calendarDays.map((d, i) => (
                            <div key={i} className="aspect-square">
                                {d ? (
                                    <button
                                        onClick={() => handleDateSelect(d)}
                                        className={clsx(
                                            "w-full h-full flex items-center justify-center rounded-lg text-xs font-mono-var transition-all",
                                            isSelected(d)
                                                ? "bg-[var(--accent)] text-[var(--bg-deep)] font-black shadow-lg"
                                                : isToday(d)
                                                    ? "bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/30 font-black"
                                                    : "bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)]/30 border border-transparent"
                                        )}
                                    >
                                        {d}
                                    </button>
                                ) : (
                                    <div className="w-full h-full" />
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Footer Actions */}
                    <div className="mt-4 pt-4 border-t border-[var(--border)] flex justify-between items-center">
                        <button 
                            onClick={() => {
                                const today = new Date();
                                setViewDate(today);
                                onChange(formatLocalDate(today));
                                setIsOpen(false);
                            }}
                            className="text-[9px] font-black uppercase tracking-widest text-[var(--accent)] hover:underline"
                        >
                            Today
                        </button>
                        <button 
                            onClick={() => setIsOpen(false)}
                            className="text-[9px] font-black uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        >
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
