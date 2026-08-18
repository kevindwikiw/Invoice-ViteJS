import { useState, useMemo, memo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '../context/auth';
import { fetchWithAuth } from '../lib/api';
import { useToast } from '../context/ToastContext';
import {
    TrendingUp, TrendingDown, ChevronLeft, ChevronRight, ChevronUp, ChevronDown,
    Loader2, Edit2, MapPin, Award, ArrowUpRight, X, Sparkles
} from 'lucide-react';
import clsx from 'clsx';
import {
    PAGE_SHELL_CLASS,
} from '../constants/uiContract';
import { FORM_LABEL_CLASS, PANEL_CARD_CLASS } from '../constants/invoice';

const UNSPECIFIED_VENUES = new Set([
    '',
    '-',
    'unknown',
    'unknown venue',
    'unspecified venue',
    'no venue specified',
]);

// Types matches backend response
export type Booking = {
    id: number;
    amount: number;
    venue: string;
    client_name: string;
    date_obj: string;
    year: number;
    month: number;
    day: number;
    month_name: string;
    date_str: string;
};

export type Item = {
    name: string;
    qty: number;
    year: number;
    month: number;
};

export type AnalyticsData = {
    bookings: Booking[];
    items: Item[];
    meta: {
        total_loaded: number;
        monthly_target: number;
        unique_clients: string[];
        unique_venues: string[];
    };
};

const KPI_CARD_CLASS = `${PANEL_CARD_CLASS} p-6 flex flex-col justify-between hover:border-[var(--accent)]/40 transition-colors`;

// Utility for IDR formatting
const formatPrice = (n: number) => new Intl.NumberFormat('id-ID').format(n);

// === MEME ARRAYS FOR EACH MONTH (12 UNIQUE MEMES) ===
const SUCCESS_MEMES = [
    { emoji: '🐱', text: 'YEAY!' },
    { emoji: '😻', text: 'STONKS!' },
    { emoji: '😼', text: 'OTW RICH' },
    { emoji: '😹', text: 'SULTAN!' },
    { emoji: '🦁', text: 'GOAT!' },
    { emoji: '😽', text: 'BOS MUDA' },
    { emoji: '🐈', text: 'SPEEDRUN' },
    { emoji: '🚀', text: 'TO MOON' },
    { emoji: '👑', text: 'KING!' },
    { emoji: '🔥', text: 'GACOR!' },
    { emoji: '💸', text: 'MONEY!' },
    { emoji: '🎅', text: 'NAISU!' },
];

const BELOW_MEMES = [
    { emoji: '🙀', text: 'DIKIT LG!' },
    { emoji: '🏃', text: 'NGEJAR!' },
    { emoji: '👀', text: 'LUMAYAN' },
    { emoji: '🤏', text: 'DIKIT LG' },
    { emoji: '⚡', text: 'NEARLY!' },
    { emoji: '💪', text: 'BISA YUK' },
    { emoji: '🔥', text: 'GAS KEJAR' },
    { emoji: '😼', text: 'PELAN2' },
    { emoji: '📈', text: 'ALMOST' },
    { emoji: '🐾', text: 'MERANGKAK' },
    { emoji: '🤏', text: 'HAMPIIR' },
    { emoji: '🎯', text: 'KEJAR!' },
];

const ZERO_MEMES = [
    { emoji: '😿', text: 'SEPI BGT' },
    { emoji: '💤', text: 'NGANTUK' },
    { emoji: '🫣', text: 'BELUM ADA' },
    { emoji: '😾', text: 'NANGIS' },
    { emoji: '🙈', text: 'MIE INSTAN' },
    { emoji: '🐱', text: 'PLS ORDER' },
    { emoji: '💤', text: 'REHAT' },
    { emoji: '💸', text: 'PUASA' },
    { emoji: '🥲', text: 'SEMANGAT' },
    { emoji: '🙀', text: 'GAWAT' },
    { emoji: '🫠', text: 'MELELEH' },
    { emoji: '❄️', text: 'DINGIN' },
];

// === CUSTOM CHART COMPONENT (Zero Dependencies, Optimised) ===
const RevenueChart = memo(({ data, target }: { data: { month: string; amount: number }[], target: number }) => {
    const rawMax = Math.max(...data.map(d => d.amount), target, 1);

    const calculateTicks = (max: number) => {
        const roughStep = max / 4;
        const power = Math.floor(Math.log10(roughStep));
        const base = Math.pow(10, power);
        const unit = roughStep / base;

        let niceUnit = 1;
        if (unit >= 2) niceUnit = 2;
        if (unit >= 5) niceUnit = 5;

        const step = niceUnit * base;
        const niceMax = Math.ceil(max / step) * step;

        const ticks = [];
        for (let v = 0; v <= niceMax; v += step) {
            ticks.push(v);
        }
        return { max: niceMax, ticks: ticks.reverse() };
    };

    const { max: maxVal, ticks } = calculateTicks(rawMax);

    return (
        <div className="relative mt-4 h-64 w-full select-none sm:h-80">

            {/* Y-Axis Labels (Left Margin) */}
            <div className="absolute top-4 bottom-8 left-0 w-10 flex flex-col justify-between text-[10px] text-[var(--text-muted)] pointer-events-none font-mono-var">
                {ticks.map((tick) => {
                    const bottomPos = (tick / maxVal) * 100;
                    return (
                        <div key={tick} className="absolute right-0 -translate-y-1/2" style={{ bottom: `${bottomPos}%` }}>
                            {new Intl.NumberFormat('id-ID', { notation: "compact", compactDisplay: "short" }).format(tick)}
                        </div>
                    );
                })}
            </div>

            {/* Shared Plot Area for Grid Lines, Target Line & Bars */}
            <div className="absolute top-4 bottom-8 left-12 right-4">
                
                {/* Y-Axis Grid Lines */}
                <div className="absolute inset-0 pointer-events-none">
                    {ticks.map((tick) => {
                        const bottomPos = (tick / maxVal) * 100;
                        return (
                            <div key={tick} className="w-full h-px bg-[var(--border)] border-dashed border-b absolute left-0 opacity-40" style={{ bottom: `${bottomPos}%` }} />
                        );
                    })}
                </div>

                {/* Target Line */}
                {target > 0 && maxVal > 0 && (
                    <div
                        className="absolute left-0 right-0 border-t border-dashed border-[var(--accent)] z-20 opacity-80 pointer-events-none"
                        style={{ bottom: `${(target / maxVal) * 100}%` }}
                    >
                        <span className="label-2xs text-[var(--accent)] bg-[var(--bg-card)] px-2 py-0.5 rounded border border-[var(--border)] absolute right-0 -bottom-3 font-bold shadow-sm">
                            TARGET: {new Intl.NumberFormat('id-ID', { notation: "compact", compactDisplay: "short" }).format(target)}
                        </span>
                    </div>
                )}

                {/* Bars Layer */}
                <div className="absolute inset-0 flex items-end justify-between z-10">
                    {data.map((d, i) => {
                        const height = (d.amount / maxVal) * 100;
                        const isTargetMet = d.amount >= target && target > 0;
                        const splitPercent = isTargetMet ? (1 - (target / d.amount)) * 100 : 0;

                        // Pick unique meme for month
                        const meme = isTargetMet
                            ? SUCCESS_MEMES[i % 12]
                            : (d.amount === 0 ? ZERO_MEMES[i % 12] : BELOW_MEMES[i % 12]);

                        return (
                            <div
                                key={i}
                                className="flex-1 flex flex-col justify-end items-center group relative h-full px-1"
                            >
                                {/* Tooltip */}
                                <div className="hidden group-hover:block absolute bottom-full mb-2 z-[60] bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] text-xs rounded-xl p-3 shadow-2xl whitespace-nowrap pointer-events-none">
                                    <div className="font-bold text-sm mb-1 font-display">{d.month}</div>
                                    <div className="text-[var(--accent)] font-mono-var text-base font-bold">
                                        {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(d.amount)}
                                    </div>
                                    <div className="label-2xs text-[var(--text-muted)] mt-1.5 border-t border-[var(--border)] pt-1">
                                        {isTargetMet ? "Target Met 🎉" : `${((d.amount / (target || 1)) * 100).toFixed(0)}% of target`}
                                    </div>
                                </div>

                                {/* Floating Unique Cat Meme Badge */}
                                <div
                                    className={clsx(
                                        "absolute z-30 pointer-events-none hidden flex-col items-center transition-all duration-300 sm:flex",
                                        isTargetMet && "animate-bounce"
                                    )}
                                    style={{ bottom: height > 0 ? `calc(${height}% + 6px)` : '8px' }}
                                >
                                    <span className={clsx(
                                        "bg-[var(--bg-card)] border px-2 py-0.5 rounded-full text-[9px] font-extrabold shadow-md flex items-center gap-1 whitespace-nowrap transition-all",
                                        isTargetMet
                                            ? "border-emerald-500/50 text-emerald-400"
                                            : (d.amount === 0 ? "border-[var(--border)] text-[var(--text-muted)] opacity-60" : "border-[var(--accent)]/40 text-[var(--accent)]")
                                    )}>
                                        <span>{meme.emoji}</span> {meme.text}
                                    </span>
                                </div>

                                {/* Two-Tone Seamless Split Bar */}
                                <div
                                    className={clsx(
                                        "w-full max-w-[48px] rounded-t-lg transition-all duration-300 ease-out relative group-hover:brightness-110",
                                        height < 1 ? "min-h-[2px]" : ""
                                    )}
                                    style={{
                                        height: `${height}%`,
                                        background: isTargetMet
                                            ? `linear-gradient(to bottom, #10b981 0%, #10b981 ${splitPercent}%, var(--accent) ${splitPercent}%, var(--accent) 100%)`
                                            : 'var(--accent)',
                                        opacity: isTargetMet ? 0.95 : 0.75
                                    }}
                                />

                                {/* X-Axis Label */}
                                <div className="absolute -bottom-6 w-full text-center text-[8px] font-bold text-[var(--text-muted)] sm:text-[10px]">
                                    {d.month.substring(0, 3)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
});

// === HEATMAP COMPONENT (Optimized 60FPS Render) ===
const CalendarHeatmap = memo(({ bookings, year }: { bookings: Booking[], year: number }) => {
    const [hoveredIso, setHoveredIso] = useState<string | null>(null);

    const days = useMemo(() => {
        const d = [];
        const start = new Date(year, 0, 1);
        const end = new Date(year, 11, 31);

        const counts: Record<string, { count: number; items: Booking[] }> = {};
        bookings.forEach(b => {
            let dateStr = b.date_str;
            if (!dateStr && b.date_obj) {
                dateStr = b.date_obj.split('T')[0];
            }

            if (b.year === year && dateStr) {
                if (!counts[dateStr]) counts[dateStr] = { count: 0, items: [] };
                counts[dateStr].count++;
                counts[dateStr].items.push(b);
            }
        });

        for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
            const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

            d.push({
                date: new Date(dt),
                iso,
                data: counts[iso] || { count: 0, items: [] }
            });
        }
        return d;
    }, [bookings, year]);

    const maxCount = Math.max(...days.map(d => d.data.count), 1);

    const getIntensity = (count: number) => {
        if (count === 0) return 'bg-[var(--bg-elevated)]/40 hover:bg-[var(--bg-hover)]';
        const ratio = count / maxCount;
        if (ratio <= 0.25) return 'bg-emerald-200 dark:bg-emerald-900/40 border border-emerald-500/20';
        if (ratio <= 0.5) return 'bg-emerald-300 dark:bg-emerald-800/60 border border-emerald-500/30';
        if (ratio <= 0.75) return 'bg-emerald-400 dark:bg-emerald-600/80 border border-emerald-500/50';
        return 'bg-emerald-500 dark:bg-emerald-500 border border-emerald-400';
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 12 }).map((_, m) => {
                const monthDays = days.filter(d => d.date.getMonth() === m);
                const monthName = new Date(year, m, 1).toLocaleString('default', { month: 'long' });
                const firstDayIndex = monthDays[0]?.date.getDay() ?? 0;

                return (
                    <div key={m} className="bg-[var(--bg-elevated)]/30 border border-[var(--border)] rounded-xl p-3.5">
                        <div className="label-xs text-[var(--accent)] mb-3 font-bold">{monthName}</div>
                        <div className="grid grid-cols-7 gap-1">
                            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                                <div key={i} className="label-2xs text-center text-[var(--text-muted)] opacity-60">{d}</div>
                            ))}
                            {Array.from({ length: firstDayIndex }).map((_, i) => (
                                <div key={`pad-${i}`} />
                            ))}
                            {monthDays.map(day => (
                                <div
                                    key={day.iso}
                                    onMouseEnter={() => setHoveredIso(day.iso)}
                                    onMouseLeave={() => setHoveredIso(null)}
                                    className={clsx(
                                        "aspect-square rounded text-[9px] flex items-center justify-center cursor-pointer transition-transform duration-100 hover:scale-125 relative group",
                                        getIntensity(day.data.count),
                                        day.data.count > 0
                                            ? "text-[var(--text-primary)] font-bold shadow-sm"
                                            : "text-[var(--text-muted)] opacity-50 hover:opacity-100 font-medium"
                                    )}
                                >
                                    {day.date.getDate()}

                                    {/* Luxury Hover Popover Tooltip - Conditionally Rendered for 60FPS Speed */}
                                    {hoveredIso === day.iso && (
                                        <div className="flex flex-col absolute bottom-full mb-2.5 left-1/2 -translate-x-1/2 z-[70] bg-[var(--bg-card)] border border-[var(--border)] p-3.5 rounded-2xl shadow-2xl whitespace-nowrap min-w-[180px] pointer-events-none animate-in fade-in zoom-in-95 duration-100">
                                            <div className="flex items-center justify-between gap-3 pb-2 border-b border-[var(--border)]/60">
                                                <span className="label-xs text-[var(--accent)] font-bold font-display">
                                                    {day.date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </span>
                                                {day.data.count > 0 ? (
                                                    <span className="label-2xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                                                        {day.data.count} {day.data.count === 1 ? 'Booking' : 'Bookings'}
                                                    </span>
                                                ) : (
                                                    <span className="label-2xs text-[var(--text-muted)] opacity-60">Available</span>
                                                )}
                                            </div>

                                            {day.data.count === 0 ? (
                                                <div className="text-[11px] text-[var(--text-muted)] italic pt-1.5 text-center">
                                                    No events booked for this date
                                                </div>
                                            ) : (
                                                <div className="space-y-2 pt-2">
                                                    {day.data.items.map(item => (
                                                        <div key={item.id} className="space-y-1">
                                                            <div className="text-xs font-bold text-[var(--text-primary)] font-display flex items-center justify-between gap-3">
                                                                <span className="truncate">{item.client_name}</span>
                                                                <span className="text-[10px] font-bold text-[var(--accent)] font-mono-var shrink-0">
                                                                    {formatPrice(item.amount)}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                                                                <MapPin size={10} className="text-[var(--accent)] shrink-0" />
                                                                <span className="truncate">{item.venue || 'No Venue Specified'}</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
});

// === TARGET EDIT MODAL ===
function TargetEditModal({ currentTarget, onClose, onSave, loading }: { currentTarget: number; onClose: () => void; onSave: (val: number) => void; loading: boolean }) {
    const [targetVal, setTargetVal] = useState(currentTarget);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
            <div className="w-full max-w-md bg-[var(--bg-card)] border border-[var(--border)] rounded-[28px] p-6 sm:p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-150 space-y-6 relative overflow-hidden" onClick={e => e.stopPropagation()}>
                
                <div className="flex items-center justify-between border-b border-[var(--border)]/50 pb-4">
                    <div className="border-l-2 border-[var(--accent)] pl-4">
                        <h3 className="text-xl text-[var(--text-primary)] font-medium font-display tracking-tight">Set Monthly Target</h3>
                        <div className="label-xs text-[var(--accent)] mt-1 tracking-[0.2em]">ANALYTICAL BENCHMARK</div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-[var(--bg-hover)] rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-3">
                    <label htmlFor="monthly-target-input" className={FORM_LABEL_CLASS}>Monthly Target (IDR)</label>
                    <div className="relative">
                        <span className="absolute left-5 top-1/2 -translate-y-1/2 label-xs font-bold text-[var(--accent)] opacity-60 pointer-events-none">IDR</span>
                        <input
                            id="monthly-target-input"
                            name="monthlyTarget"
                            aria-label="Monthly Target in IDR"
                            type="text"
                            autoFocus
                            className="w-full bg-[var(--bg-elevated)]/50 border border-[var(--border)] rounded-2xl pl-14 pr-5 py-4 text-xl font-bold text-[var(--text-primary)] font-display text-right outline-none focus:border-[var(--accent)] focus:bg-[var(--bg-elevated)] transition-colors tracking-tight"
                            value={targetVal > 0 ? formatPrice(targetVal) : ''}
                            onChange={e => setTargetVal(Number(e.target.value.replace(/\D/g, '')))}
                            placeholder="50.000.000"
                        />
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] italic">
                        Monthly benchmark target for revenue chart performance lines.
                    </p>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                    <button onClick={onClose} className="px-5 py-3 label-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
                        Cancel
                    </button>
                    <button
                        onClick={() => onSave(targetVal)}
                        disabled={loading || targetVal <= 0}
                        className="px-6 py-3 bg-[var(--accent)] text-[var(--bg-deep)] rounded-xl label-xs font-bold shadow-lg hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 transition-all flex items-center gap-2"
                    >
                        {loading && <Loader2 size={14} className="animate-spin" />}
                        <span>Save Target</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function Analytics() {
    const navigate = useNavigate();
    const { hasPermission } = useAuth();
    const { addToast } = useToast();
    const queryClient = useQueryClient();
    const canViewAnalytics = hasPermission('view_market_insights');
    const currentYear = new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState(currentYear);

    // Quick Jump State
    const [jumpMonth, setJumpMonth] = useState<number>(new Date().getMonth() + 1);
    const [jumpEventId, setJumpEventId] = useState<number | null>(null);

    // Target Modal & Inline Drawer States
    const [showTargetModal, setShowTargetModal] = useState(false);
    const [showPackageBreakdown, setShowPackageBreakdown] = useState(false);
    const [showVenueBreakdown, setShowVenueBreakdown] = useState(false);
    const breakdownRef = useRef<HTMLDivElement>(null);
    const venueRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (showPackageBreakdown && breakdownRef.current) {
            breakdownRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [showPackageBreakdown]);

    useEffect(() => {
        if (showVenueBreakdown && venueRef.current) {
            venueRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [showVenueBreakdown]);

    // Mutation to update target
    const updateTargetMutation = useMutation({
        mutationFn: async (newTarget: number) => {
            const res = await fetchWithAuth('/analytics/target', {
                method: 'PUT',
                body: JSON.stringify({ target: newTarget })
            });
            if (!res.ok) throw new Error('Failed to update target');
            return res.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['analytics'] });
            setShowTargetModal(false);
            addToast('Monthly target updated successfully!', 'success');
        },
        onError: (error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            addToast(`Failed to update target: ${message}`, 'error');
        }
    });

    // Fetch Data
    const { data, isLoading, error } = useQuery<AnalyticsData>({
        queryKey: ['analytics'],
        queryFn: async () => {
            const res = await fetchWithAuth('/analytics');
            if (!res.ok) throw new Error('Failed to load analytics');
            return res.json();
        },
        staleTime: 1000 * 60 * 5,
        gcTime: 1000 * 60 * 30,
        enabled: canViewAnalytics,
    });

    // Process Data based on selection
    const processedData = useMemo(() => {
        if (!data || !data.bookings) return null;

        const bookings: Booking[] = [];
        const prevYearBookings: Booking[] = [];

        for (const b of data.bookings) {
            if (b.year === selectedYear) bookings.push(b);
            else if (b.year === selectedYear - 1) prevYearBookings.push(b);
        }

        const totalRevenue = bookings.reduce((sum, b) => sum + b.amount, 0);
        const prevRevenue = prevYearBookings.reduce((sum, b) => sum + b.amount, 0);

        const growth = prevRevenue > 0
            ? ((totalRevenue - prevRevenue) / prevRevenue) * 100
            : 0;

        const monthlyRevenue = Array(12).fill(0);
        bookings.forEach(b => {
            if (b.month >= 1 && b.month <= 12) {
                monthlyRevenue[b.month - 1] += b.amount;
            }
        });

        const months = monthlyRevenue.map((amt, i) => ({
            month: new Date(2000, i, 1).toLocaleString('default', { month: 'short' }),
            amount: amt
        }));

        const venues: Record<string, number> = {};
        bookings.forEach(b => {
            let vName = (b.venue || '').trim();
            if (!vName || vName.toLowerCase() === 'unknown') {
                vName = 'Unspecified Venue';
            }
            venues[vName] = (venues[vName] || 0) + 1;
        });

        const totalEventsCount = bookings.length;
        const allVenueBreakdown = Object.entries(venues)
            .map(([name, count]) => ({
                name,
                count,
                percentage: totalEventsCount > 0 ? (count / totalEventsCount) * 100 : 0
            }))
            .sort((a, b) => b.count - a.count);

        const leadingSpecifiedVenue = allVenueBreakdown.find(
            (venue) => !UNSPECIFIED_VENUES.has(venue.name.trim().toLocaleLowerCase('id-ID')),
        );
        const topVenue = leadingSpecifiedVenue
            ? [leadingSpecifiedVenue.name, leadingSpecifiedVenue.count] as [string, number]
            : ['No venue recorded', 0] as [string, number];

        const yearItems = data.items.filter(i => i.year === selectedYear);
        const packageCounts: Record<string, number> = {};

        yearItems.forEach(i => {
            const rawName = (i.name || '').trim();
            const itemQty = i.qty || 1;

            if (!rawName) return;

            // Extract all sub-titles inside bundle description (e.g. **Full-day Wedding**, **Half-Day Wedding**)
            const boldMatches = Array.from(rawName.matchAll(/\*\*([^*]+)\*\*/g)).map(m => m[1].trim());
            
            let titles: string[] = [];
            if (boldMatches.length > 0) {
                titles = boldMatches;
            } else {
                let clean = rawName.split('\n')[0].trim();
                clean = clean.replace(/\*\*/g, '').replace(/^[-*#]\s*/, '').trim();
                if (!clean || clean.toLowerCase() === 'unknown package' || clean.toLowerCase() === 'unknown') {
                    clean = 'Custom Item';
                }
                titles = [clean];
            }

            titles.forEach(title => {
                if (title) {
                    packageCounts[title] = (packageCounts[title] || 0) + itemQty;
                }
            });
        });

        const totalUnitsBooked = Object.values(packageCounts).reduce((a, b) => a + b, 0);

        const allPackageBreakdown = Object.entries(packageCounts)
            .map(([name, qty]) => ({
                name,
                qty,
                percentage: totalUnitsBooked > 0 ? (qty / totalUnitsBooked) * 100 : 0
            }))
            .sort((a, b) => b.qty - a.qty);

        const topPackage = allPackageBreakdown[0]
            ? [allPackageBreakdown[0].name, allPackageBreakdown[0].qty] as [string, number]
            : ['-', 0] as [string, number];

        const isNewRevenue = prevRevenue === 0;

        return {
            totalRevenue,
            prevRevenue,
            growth,
            isNewRevenue,
            months,
            topVenue,
            allVenueBreakdown,
            topPackage,
            allPackageBreakdown,
            totalUnitsBooked,
            bookings,
            count: bookings.length
        };

    }, [data, selectedYear]);

    if (!canViewAnalytics) {
        return (
            <div className={`${PAGE_SHELL_CLASS} text-[var(--text-primary)]`}>
                <div className="max-w-7xl mx-auto">
                    <div className={`${PANEL_CARD_CLASS} p-10 text-center`}>
                        <h1 className="text-2xl text-[var(--text-primary)] mb-2 font-display">
                            Access Denied
                        </h1>
                        <p className="text-[var(--text-muted)] text-sm">You don't have permission to view market insights.</p>
                    </div>
                </div>
            </div>
        );
    }

    if (isLoading) return <div className="h-screen flex items-center justify-center bg-[var(--bg-deep)]"><Loader2 className="animate-spin text-[var(--accent)]" /></div>;
    if (error) return <div className="p-8 text-red-500">Error loading analytics: {(error as Error).message}</div>;
    if (!processedData || !data) return null;

    const { totalRevenue, growth, isNewRevenue, months, topVenue, allVenueBreakdown, topPackage, allPackageBreakdown, totalUnitsBooked, bookings, count } = processedData;
    const target = data.meta.monthly_target || 50000000;

    return (
        <div className={`${PAGE_SHELL_CLASS} text-[var(--text-primary)]`}>
            <div className="mx-auto max-w-7xl space-y-6">

                {/* Header Area - Matches CreateInvoice & Packages 100% */}
                <div className="mb-10">
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                        <div className="flex-1 min-w-0">
                            <h1 className="text-2xl sm:text-3xl md:text-4xl text-[var(--text-primary)] mb-2 font-medium tracking-tight font-display">
                                Analytics & Market Insights
                            </h1>
                            <div className="label-xs text-[var(--text-muted)] font-sans flex flex-wrap items-center gap-3 tracking-[0.2em]">
                                <span>STANDARD OPERATING PROCEDURE: ANALYTICS & MARKET INSIGHTS</span>
                                <span className={clsx(
                                    "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 label-2xs tracking-[0.14em]",
                                    isNewRevenue
                                        ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 font-bold"
                                        : (growth >= 0
                                            ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                                            : "text-rose-400 bg-rose-500/10 border border-rose-500/20")
                                )}>
                                    {isNewRevenue ? (
                                        <>New Revenue Record 🎉</>
                                    ) : (
                                        <>
                                            {growth >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                            {Math.abs(growth).toFixed(1)}% YoY Growth
                                        </>
                                    )}
                                </span>
                            </div>
                        </div>

                        {/* Year Pagination Button - Matches + Create Packages in Packages.tsx 100% */}
                        <div className="flex items-center bg-[var(--accent)] text-[var(--bg-deep)] rounded-lg px-2 py-1 shrink-0 label-xs font-bold transition-all">
                            <button
                                onClick={() => setSelectedYear(y => y - 1)}
                                className="p-1 rounded hover:bg-black/10 transition-colors text-[var(--bg-deep)] flex items-center justify-center"
                                title="Previous Year"
                            >
                                <ChevronLeft size={14} />
                            </button>
                            <span className="px-2.5 py-1 label-xs font-bold tracking-wider select-none text-[var(--bg-deep)] min-w-[48px] text-center">
                                {selectedYear}
                            </span>
                            <button
                                onClick={() => setSelectedYear(y => y + 1)}
                                className="p-1 rounded hover:bg-black/10 transition-colors text-[var(--bg-deep)] flex items-center justify-center"
                                title="Next Year"
                            >
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* KPI Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {/* Revenue Card */}
                    <div className={KPI_CARD_CLASS}>
                        <div className="flex flex-col gap-2">
                            <span className={FORM_LABEL_CLASS}>REVENUE ({selectedYear})</span>
                            <div className="text-2xl font-semibold tracking-tight text-[var(--accent)] font-display tabular-nums">
                                {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(totalRevenue)}
                            </div>
                        </div>
                        <div className="pt-4">
                            <div className="border-t border-dashed border-[var(--border)] opacity-50 mb-3" />
                            <div className="flex items-center justify-between">
                                <span className={clsx(
                                    "label-2xs font-bold px-2 py-0.5 rounded",
                                    isNewRevenue
                                        ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                                        : (growth >= 0 ? "text-emerald-400 bg-emerald-500/10" : "text-rose-400 bg-rose-500/10")
                                )}>
                                    {isNewRevenue ? "New Revenue 🎉" : `${Math.abs(growth).toFixed(0)}% vs Last Year`}
                                </span>
                                <span className="label-2xs text-[var(--text-muted)] opacity-60">Total revenue</span>
                            </div>
                        </div>
                    </div>

                    {/* Total Invoices */}
                    <div className={KPI_CARD_CLASS}>
                        <div className="flex flex-col gap-2">
                            <span className={FORM_LABEL_CLASS}>TOTAL INVOICES</span>
                            <div className="text-2xl font-semibold tracking-tight text-[var(--text-primary)] font-display">
                                {count}
                            </div>
                        </div>
                        <div className="label-xs text-[var(--text-muted)] pt-4 border-t border-[var(--border)]">
                            Projects booked in {selectedYear}
                        </div>
                    </div>

                    {/* Top Venue - Interactive Button Card */}
                    <div
                        onClick={() => setShowVenueBreakdown(prev => !prev)}
                        className={clsx(
                            KPI_CARD_CLASS,
                            "cursor-pointer hover:border-[var(--accent)] hover:shadow-lg transition-all group relative overflow-hidden",
                            showVenueBreakdown && "border-[var(--accent)] bg-[var(--accent)]/5 shadow-md"
                        )}
                    >
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <span className={FORM_LABEL_CLASS + " flex items-center gap-1.5 cursor-pointer"}>
                                    <MapPin size={12} className="text-[var(--accent)]" /> TOP VENUE
                                </span>
                                <span className="label-2xs text-[var(--accent)] flex items-center gap-1 font-bold">
                                    {showVenueBreakdown ? 'Collapse' : 'Expand'} {showVenueBreakdown ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </span>
                            </div>
                            <div className="text-2xl font-semibold tracking-tight text-[var(--text-primary)] font-display truncate" title={topVenue[0]}>
                                {topVenue[0]}
                            </div>
                        </div>
                        <div className="label-xs text-[var(--text-muted)] pt-4 border-t border-[var(--border)] flex items-center justify-between">
                            <span>{topVenue[1]} Events hosted</span>
                            <span className="text-[var(--accent)] font-bold text-[10px] uppercase tracking-wider flex items-center gap-0.5">
                                {showVenueBreakdown ? 'Hide Drawer ▲' : 'View Drawer ▼'}
                            </span>
                        </div>
                    </div>

                    {/* Top Package - Interactive Button Card */}
                    <div
                        onClick={() => setShowPackageBreakdown(prev => !prev)}
                        className={clsx(
                            KPI_CARD_CLASS,
                            "cursor-pointer hover:border-[var(--accent)] hover:shadow-lg transition-all group relative overflow-hidden",
                            showPackageBreakdown && "border-[var(--accent)] bg-[var(--accent)]/5 shadow-md"
                        )}
                    >
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <span className={FORM_LABEL_CLASS + " flex items-center gap-1.5 cursor-pointer"}>
                                    <Award size={12} className="text-[var(--accent)]" /> TOP PACKAGE
                                </span>
                                <span className="label-2xs text-[var(--accent)] flex items-center gap-1 font-bold">
                                    {showPackageBreakdown ? 'Collapse' : 'Expand'} {showPackageBreakdown ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </span>
                            </div>
                            <div className="text-2xl font-semibold tracking-tight text-[var(--text-primary)] font-display truncate" title={topPackage[0]}>
                                {topPackage[0]}
                            </div>
                        </div>
                        <div className="label-xs text-[var(--text-muted)] pt-4 border-t border-[var(--border)] flex items-center justify-between">
                            <span>{topPackage[1]} Units booked</span>
                            <span className="text-[var(--accent)] font-bold text-[10px] uppercase tracking-wider flex items-center gap-0.5">
                                {showPackageBreakdown ? 'Hide Drawer ▲' : 'View Drawer ▼'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Inline Expandable Venue Performance Breakdown Drawer */}
                {showVenueBreakdown && (
                    <div ref={venueRef} className="animate-in slide-in-from-top-4 fade-in duration-300">
                        <div className={`${PANEL_CARD_CLASS} p-6 sm:p-8 space-y-6 border-l-4 border-l-[var(--accent)] shadow-xl relative`}>
                            {/* Drawer Header */}
                            <div className="flex items-center justify-between border-b border-[var(--border)]/60 pb-4">
                                <div className="border-l-2 border-[var(--accent)] pl-3">
                                    <h3 className="text-xl font-medium tracking-tight text-[var(--text-primary)] font-display flex items-center gap-2 normal-case">
                                        <MapPin size={18} className="text-[var(--accent)]" /> Venue Performance Breakdown ({selectedYear})
                                    </h3>
                                    <div className="label-xs text-[var(--accent)] mt-1 tracking-[0.2em]">
                                        TOTAL {allVenueBreakdown.length} VENUES HOSTED ({count} TOTAL EVENTS)
                                    </div>
                                </div>
                                <button
                                    onClick={() => setShowVenueBreakdown(false)}
                                    className="px-3 py-1.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] label-2xs font-bold text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)]/50 transition-colors flex items-center gap-1.5 shrink-0"
                                >
                                    <span>Hide Drawer</span> <ChevronUp size={14} />
                                </button>
                            </div>

                            {/* Grid of Venue Breakdown Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {allVenueBreakdown.length === 0 ? (
                                    <div className="col-span-full text-center py-8 text-sm text-[var(--text-muted)] italic">
                                        No venues recorded for {selectedYear}
                                    </div>
                                ) : (
                                    allVenueBreakdown.map((v, idx) => (
                                        <div key={idx} className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-3 hover:border-[var(--accent)]/40 transition-all group">
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="font-bold text-sm text-[var(--text-primary)] font-display truncate" title={v.name}>
                                                    {v.name}
                                                </span>
                                                <span className="label-2xs font-extrabold text-[var(--accent)] bg-[var(--accent)]/10 px-2.5 py-1 rounded-full border border-[var(--accent)]/20 shrink-0">
                                                    {v.count} {v.count === 1 ? 'Event' : 'Events'}
                                                </span>
                                            </div>

                                            {/* Progress Bar */}
                                            <div className="space-y-1 pt-1">
                                                <div className="flex items-center justify-between label-2xs text-[var(--text-muted)]">
                                                    <span>Share of Total Events</span>
                                                    <span className="font-bold text-[var(--accent)]">{v.percentage.toFixed(1)}%</span>
                                                </div>
                                                <div className="w-full h-1.5 bg-[var(--bg-deep)] rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-[var(--accent)] rounded-full transition-all duration-500 group-hover:brightness-125"
                                                        style={{ width: `${v.percentage}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Inline Expandable Package Breakdown Drawer */}
                {showPackageBreakdown && (
                    <div ref={breakdownRef} className="animate-in slide-in-from-top-4 fade-in duration-300">
                        <div className={`${PANEL_CARD_CLASS} p-6 sm:p-8 space-y-6 border-l-4 border-l-[var(--accent)] shadow-xl relative`}>
                            {/* Drawer Header */}
                            <div className="flex items-center justify-between border-b border-[var(--border)]/60 pb-4">
                                <div className="border-l-2 border-[var(--accent)] pl-3">
                                    <h3 className="text-xl font-medium tracking-tight text-[var(--text-primary)] font-display flex items-center gap-2 normal-case">
                                        <Award size={18} className="text-[var(--accent)]" /> Package Performance Breakdown ({selectedYear})
                                    </h3>
                                    <div className="label-xs text-[var(--accent)] mt-1 tracking-[0.2em]">
                                        TOTAL {allPackageBreakdown.length} PACKAGE TYPES BOOKED ({totalUnitsBooked} TOTAL UNITS)
                                    </div>
                                </div>
                                <button
                                    onClick={() => setShowPackageBreakdown(false)}
                                    className="px-3 py-1.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] label-2xs font-bold text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--accent)]/50 transition-colors flex items-center gap-1.5 shrink-0"
                                >
                                    <span>Hide Drawer</span> <ChevronUp size={14} />
                                </button>
                            </div>

                            {/* Grid of Package Breakdown Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {allPackageBreakdown.length === 0 ? (
                                    <div className="col-span-full text-center py-8 text-sm text-[var(--text-muted)] italic">
                                        No package items recorded for {selectedYear}
                                    </div>
                                ) : (
                                    allPackageBreakdown.map((pkg, idx) => (
                                        <div key={idx} className="bg-[var(--bg-elevated)]/40 border border-[var(--border)] rounded-xl p-4 space-y-3 hover:border-[var(--accent)]/40 transition-all group">
                                            <div className="flex items-center justify-between gap-3">
                                                <span className="font-bold text-sm text-[var(--text-primary)] font-display truncate" title={pkg.name}>
                                                    {pkg.name}
                                                </span>
                                                <span className="label-2xs font-extrabold text-[var(--accent)] bg-[var(--accent)]/10 px-2.5 py-1 rounded-full border border-[var(--accent)]/20 shrink-0">
                                                    {pkg.qty} {pkg.qty === 1 ? 'Unit' : 'Units'}
                                                </span>
                                            </div>

                                            {/* Progress Bar */}
                                            <div className="space-y-1 pt-1">
                                                <div className="flex items-center justify-between label-2xs text-[var(--text-muted)]">
                                                    <span>Booking Share</span>
                                                    <span className="font-bold text-[var(--accent)]">{pkg.percentage.toFixed(1)}%</span>
                                                </div>
                                                <div className="w-full h-1.5 bg-[var(--bg-deep)] rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-[var(--accent)] rounded-full transition-all duration-500 group-hover:brightness-125"
                                                        style={{ width: `${pkg.percentage}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Pro Tip Banner */}
                            <div className="bg-[var(--bg-elevated)]/60 border border-[var(--border)] rounded-xl p-4 flex items-center gap-3.5 mt-2">
                                <div className="w-8 h-8 rounded-lg bg-[var(--accent)]/15 border border-[var(--accent)]/30 flex items-center justify-center text-[var(--accent)] shrink-0">
                                    <Sparkles size={16} />
                                </div>
                                <div className="text-xs text-[var(--text-muted)] leading-relaxed">
                                    <span className="font-bold text-[var(--text-primary)]">Info Rincian Paket:</span> Statistik ini menghitung paket & sub-judul (misal <span className="text-[var(--accent)] font-semibold">Full-day Wedding</span>, <span className="text-[var(--accent)] font-semibold">Half-Day Wedding</span>, <span className="text-[var(--accent)] font-semibold">Pre-wedding</span>) langsung dari invoice Anda. Invoice yang berisi item custom akan dikelompokkan ke <span className="font-medium text-[var(--text-primary)]">Layanan Custom / General</span>.
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Charts Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className={`lg:col-span-3 ${PANEL_CARD_CLASS} p-6 sm:p-8 space-y-4`}>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)]/50 pb-4">
                            <div className="border-l-2 border-[var(--accent)] pl-4 text-left">
                                <h2 className="text-xl font-medium tracking-tight text-[var(--text-primary)] font-display normal-case">Revenue Trends</h2>
                                <div className="label-xs text-[var(--accent)] mt-1 tracking-[0.2em]">
                                    MONTHLY PERFORMANCE VS TARGET
                                </div>
                            </div>

                            <div className="text-right">
                                <div className="label-xs text-[var(--text-muted)] tracking-[0.15em] mb-1">Monthly Target</div>
                                <button
                                    onClick={() => setShowTargetModal(true)}
                                    className="flex items-center justify-end gap-2 group cursor-pointer"
                                >
                                    <span className="text-lg font-bold text-[var(--accent)] font-display">
                                        {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(target)}
                                    </span>
                                    <Edit2 size={12} className="text-[var(--text-muted)] opacity-50 group-hover:opacity-100 transition-opacity" />
                                </button>
                            </div>
                        </div>

                        <RevenueChart data={months} target={target} />
                    </div>
                </div>

                {/* Heatmap & Quick Jump */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className={`lg:col-span-2 ${PANEL_CARD_CLASS} p-6 sm:p-8 space-y-6`}>
                        <div className="border-l-2 border-[var(--accent)] pl-4 text-left">
                            <h2 className="text-xl font-medium tracking-tight text-[var(--text-primary)] font-display normal-case">Event Calendar</h2>
                            <div className="label-xs text-[var(--accent)] mt-1 tracking-[0.2em]">
                                BOOKING DENSITY & ANNUAL DISTRIBUTION
                            </div>
                        </div>
                        <CalendarHeatmap bookings={bookings} year={selectedYear} />
                    </div>

                    <div className={`${PANEL_CARD_CLASS} p-6 sm:p-8 space-y-6 flex flex-col justify-between`}>
                        <div className="space-y-6">
                            <div className="border-l-2 border-[var(--accent)] pl-4 text-left">
                                <h2 className="text-xl font-medium tracking-tight text-[var(--text-primary)] font-display normal-case">Quick Actions</h2>
                                <div className="label-xs text-[var(--accent)] mt-1 tracking-[0.2em]">
                                    JUMP TO EVENT INVOICE
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label htmlFor="jump-filter-month" className={FORM_LABEL_CLASS + " mb-2"}>Filter Month</label>
                                    <select
                                        id="jump-filter-month"
                                        name="jumpFilterMonth"
                                        aria-label="Filter Month for Event Invoice"
                                        className="w-full bg-[var(--bg-elevated)]/50 border border-[var(--border)] rounded-2xl px-4 py-3 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors"
                                        value={jumpMonth}
                                        onChange={(e) => {
                                            setJumpMonth(Number(e.target.value));
                                            setJumpEventId(null);
                                        }}
                                    >
                                        {Array.from({ length: 12 }, (_, i) => (
                                            <option key={i + 1} value={i + 1}>
                                                {new Date(2000, i, 1).toLocaleString('default', { month: 'long' })}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label htmlFor="jump-select-event" className={FORM_LABEL_CLASS + " mb-2"}>Select Event</label>
                                    <select
                                        id="jump-select-event"
                                        name="jumpSelectEvent"
                                        aria-label="Select Event Invoice to Jump to"
                                        className="w-full bg-[var(--bg-elevated)]/50 border border-[var(--border)] rounded-2xl px-4 py-3 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] transition-colors disabled:opacity-50"
                                        value={jumpEventId || ''}
                                        onChange={(e) => setJumpEventId(Number(e.target.value))}
                                        disabled={bookings.filter(b => b.month === jumpMonth).length === 0}
                                    >
                                        <option value="">
                                            {bookings.filter(b => b.month === jumpMonth).length === 0
                                                ? 'No events in this month'
                                                : '-- Select Event --'}
                                        </option>
                                        {bookings
                                            .filter(b => b.month === jumpMonth)
                                            .map(b => (
                                                <option key={b.id} value={b.id}>
                                                    {b.date_str} - {b.client_name}
                                                </option>
                                            ))
                                        }
                                    </select>
                                </div>
                            </div>
                        </div>

                        <button
                            className="w-full bg-[var(--accent)] text-[var(--bg-deep)] label-xs font-bold py-3.5 px-4 rounded-xl hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-4"
                            onClick={() => {
                                if (jumpEventId) {
                                    navigate({ to: '/create', search: { editId: jumpEventId } });
                                }
                            }}
                            disabled={!jumpEventId}
                        >
                            <span>Edit Invoice</span> <ArrowUpRight size={14} />
                        </button>
                    </div>
                </div>

            </div>

            {/* Target Edit Modal */}
            {showTargetModal && (
                <TargetEditModal
                    currentTarget={target}
                    onClose={() => setShowTargetModal(false)}
                    onSave={(val) => updateTargetMutation.mutate(val)}
                    loading={updateTargetMutation.isPending}
                />
            )}
        </div>
    );
}
