import { useState, useMemo, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { fetchWithAuth } from '../context/auth';
import {
    Calendar, TrendingUp, TrendingDown, DollarSign, Package, MapPin,
    ArrowUpRight, ChevronLeft, ChevronRight,
    Loader2, Target, Edit2, Save
} from 'lucide-react';
import clsx from 'clsx';

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

// === CUSTOM CHART COMPONENT (Zero Dependencies, Optimised) ===
const RevenueChart = memo(({ data, target }: { data: { month: string; amount: number }[], target: number }) => {
    // Smart Scale Calculation
    const rawMax = Math.max(...data.map(d => d.amount), target, 1);

    // Calculate nice ticks for Y-Axis
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
        <div className="w-full h-80 relative mt-4 select-none">
            {/* Y-Axis Grid Lines */}
            <div className="absolute inset-0 flex flex-col justify-end text-xs text-[var(--text-muted)] pointer-events-none pl-10 pr-2">
                {ticks.map((tick) => {
                    const bottomPos = (tick / maxVal) * 100;
                    return (
                        <div key={tick} className="flex items-center w-full absolute left-0 pr-2" style={{ bottom: `${bottomPos}%` }}>
                            <span className="w-10 text-right pr-2 -ml-2">
                                {new Intl.NumberFormat('id-ID', { notation: "compact", compactDisplay: "short" }).format(tick)}
                            </span>
                            {/* Fixed Gridline: Removed ml-10 */}
                            <div className="w-full h-px bg-[var(--border)] border-dashed border-b ml-2" />
                        </div>
                    );
                })}
            </div>

            {/* Target Line */}
            {target > 0 && maxVal > 0 && (
                <div
                    className="absolute w-full border-t-2 border-dashed border-red-500/50 z-10 pl-10 pr-2"
                    style={{ bottom: `${(target / maxVal) * 100}%`, height: '2px' }}
                >
                    <span className="text-xs text-red-500 font-bold bg-[var(--bg-card)] px-2 py-0.5 rounded border border-red-500/20 absolute right-2 -bottom-3">
                        TARGET: {new Intl.NumberFormat('id-ID', { notation: "compact", compactDisplay: "short" }).format(target)}
                    </span>
                </div>
            )}

            {/* Bars */}
            <div className="absolute inset-0 flex items-end justify-between pl-12 pr-4 pt-6 pb-0">
                {data.map((d, i) => {
                    const height = (d.amount / maxVal) * 100;
                    const isTargetMet = d.amount >= target;

                    return (
                        <div
                            key={i}
                            className="flex-1 flex flex-col justify-end items-center group relative h-full px-1"
                        >
                            {/* CSS-Only Tooltip using group-hover */}
                            <div className="hidden group-hover:block absolute bottom-full mb-2 z-[60] bg-[var(--bg-deep)] border border-[var(--border)] text-[var(--text-primary)] text-xs rounded-lg p-3 shadow-xl whitespace-nowrap pointer-events-none">
                                <div className="font-bold text-sm mb-1">{d.month}</div>
                                <div className="text-[var(--accent)] font-mono text-base font-bold">
                                    {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(d.amount)}
                                </div>
                                <div className="text-[10px] text-[var(--text-muted)] mt-1 border-t border-[var(--border)] pt-1">
                                    {isTargetMet ? "Target Met 🎉" : `${((d.amount / (target || 1)) * 100).toFixed(0)}% of target`}
                                </div>
                            </div>

                            {/* Bar with valid CSS Gradient (Compatibility Fix) */}
                            <div
                                className={clsx(
                                    "w-full max-w-[50px] rounded-t-sm transition-all duration-500 ease-out relative group-hover:brightness-110",
                                    height < 1 ? "min-h-[2px]" : ""
                                )}
                                style={{
                                    height: `${height}%`,
                                    background: `linear-gradient(to bottom, var(--accent) 0%, transparent 120%)`,
                                    opacity: isTargetMet ? 1 : 0.7
                                }}
                            >
                                {/* Top Glow */}
                                {isTargetMet && <div className="absolute top-0 inset-x-0 h-[2px] bg-white/50 shadow-[0_0_15px_var(--accent)]" />}
                            </div>

                            {/* X-Axis Label */}
                            <div className="absolute -bottom-6 text-[10px] uppercase font-bold text-[var(--text-muted)] w-full text-center">
                                {d.month.substring(0, 3)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

// === HEATMAP COMPONENT ===
const CalendarHeatmap = memo(({ bookings, year }: { bookings: Booking[], year: number }) => {
    // Generate full year days
    const days = useMemo(() => {
        const d = [];
        const start = new Date(year, 0, 1);
        const end = new Date(year, 11, 31);

        // Map bookings to dates (Local YYYY-MM-DD)
        const counts: Record<string, { count: number; items: Booking[] }> = {};
        bookings.forEach(b => {
            // Create local date string safely from [year, month, day] if available, or parse safely
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

        // Loop days
        for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
            // Local ISO date: YYYY-MM-DD
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
        if (count === 0) return 'bg-[var(--bg-elevated)]';
        const ratio = count / maxCount;
        if (ratio <= 0.25) return 'bg-emerald-200 dark:bg-emerald-900/40';
        if (ratio <= 0.5) return 'bg-emerald-300 dark:bg-emerald-800/60';
        if (ratio <= 0.75) return 'bg-emerald-400 dark:bg-emerald-600/80';
        return 'bg-emerald-500 dark:bg-emerald-500';
    };

    // Render by Month
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 12 }).map((_, m) => {
                const monthDays = days.filter(d => d.date.getMonth() === m);
                const monthName = new Date(year, m, 1).toLocaleString('default', { month: 'long' });

                // Safe guard for first day
                const firstDayIndex = monthDays[0]?.date.getDay() ?? 0;

                return (
                    <div key={m} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3">
                        <div className="text-xs font-bold text-[var(--accent)] mb-2 uppercase tracking-wider">{monthName}</div>
                        <div className="grid grid-cols-7 gap-1">
                            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                                <div key={i} className="text-[9px] text-center text-[var(--text-muted)] font-mono">{d}</div>
                            ))}
                            {/* Padding for start day */}
                            {Array.from({ length: firstDayIndex }).map((_, i) => (
                                <div key={`pad-${i}`} />
                            ))}
                            {monthDays.map(day => (
                                <div
                                    key={day.iso}
                                    className={clsx(
                                        "aspect-square rounded-sm text-[8px] flex items-center justify-center cursor-pointer transition-all hover:scale-125 relative group",
                                        getIntensity(day.data.count),
                                        day.data.count > 0 ? "text-[var(--text-primary)] font-bold" : "text-transparent"
                                    )}
                                >
                                    {day.date.getDate()}

                                    {/* Tooltip */}
                                    <div className="hidden group-hover:block absolute bottom-full mb-1 z-[60] bg-[var(--bg-deep)] border border-[var(--border)] p-2 rounded shadow-xl whitespace-nowrap min-w-[120px] user-select-none pointer-events-none right-0 md:left-1/2 md:-translate-x-1/2">
                                        <div className="font-bold text-[var(--accent)] mb-1">{day.date.toLocaleDateString()}</div>
                                        {day.data.count === 0 ? (
                                            <div className="text-[var(--text-muted)]">No Events</div>
                                        ) : (
                                            day.data.items.map(i => (
                                                <div key={i.id} className="text-[var(--text-primary)] flex justify-between gap-2">
                                                    <span>{i.client_name}</span>
                                                    <span className="text-[var(--text-muted)]">{i.venue}</span>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
});

export default function Analytics() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const currentYear = new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState(currentYear);

    // Quick Jump State
    const [jumpMonth, setJumpMonth] = useState<number>(new Date().getMonth() + 1);
    const [jumpEventId, setJumpEventId] = useState<number | null>(null);

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
            setIsEditingTargetKpi(false);
            setIsEditingTargetChart(false);
        }
    });

    const [isEditingTargetKpi, setIsEditingTargetKpi] = useState(false);
    const [tempTargetKpi, setTempTargetKpi] = useState<string>('');

    const [isEditingTargetChart, setIsEditingTargetChart] = useState(false);
    const [tempTargetChart, setTempTargetChart] = useState<string>('');

    // Fetch Data
    const { data, isLoading, error } = useQuery<AnalyticsData>({
        queryKey: ['analytics'],
        queryFn: async () => {
            const res = await fetchWithAuth('/analytics');
            if (!res.ok) throw new Error('Failed to load analytics');
            return res.json();
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
        gcTime: 1000 * 60 * 30, // 30 minutes
    });

    // Process Data based on selection (Optimized)
    const processedData = useMemo(() => {
        if (!data || !data.bookings) return null;

        // Optimized Aggregation
        const bookings: Booking[] = [];
        const prevYearBookings: Booking[] = [];

        // Single pass filtering
        for (const b of data.bookings) {
            if (b.year === selectedYear) bookings.push(b);
            else if (b.year === selectedYear - 1) prevYearBookings.push(b);
        }

        const totalRevenue = bookings.reduce((sum, b) => sum + b.amount, 0);
        const prevRevenue = prevYearBookings.reduce((sum, b) => sum + b.amount, 0);

        // Growth
        const growth = prevRevenue > 0
            ? ((totalRevenue - prevRevenue) / prevRevenue) * 100
            : 0;

        // Monthly Buckets (Single pass)
        const monthlyRevenue = Array(12).fill(0);
        bookings.forEach(b => {
            if (b.month >= 1 && b.month <= 12) {
                monthlyRevenue[b.month - 1] += b.amount;
            }
        });

        // Map to Chart Data
        const months = monthlyRevenue.map((amt, i) => ({
            month: new Date(2000, i, 1).toLocaleString('default', { month: 'short' }),
            amount: amt
        }));

        // Top Venue
        const venues: Record<string, number> = {};
        bookings.forEach(b => {
            venues[b.venue] = (venues[b.venue] || 0) + 1;
        });
        const topVenue = Object.entries(venues).sort((a, b) => b[1] - a[1])[0] || ['-', 0];

        // Top Package (approx from items)
        const yearItems = data.items.filter(i => i.year === selectedYear);
        const packages: Record<string, number> = {};
        yearItems.forEach(i => {
            packages[i.name] = (packages[i.name] || 0) + i.qty;
        });
        const topPackage = Object.entries(packages).sort((a, b) => b[1] - a[1])[0] || ['-', 0];

        return {
            totalRevenue,
            prevRevenue,
            growth,
            months,
            topVenue,
            topPackage,
            bookings,
            count: bookings.length
        };

    }, [data, selectedYear]);

    if (isLoading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-[var(--accent)]" /></div>;
    if (error) return <div className="p-8 text-red-500">Error loading analytics: {(error as Error).message}</div>;
    if (!processedData || !data) return null;

    const { totalRevenue, growth, months, topVenue, topPackage, bookings, count } = processedData;
    const target = data.meta.monthly_target || 50000000;

    return (
        <div className="min-h-screen bg-[var(--bg-deep)] text-[var(--text-primary)] p-6 md:p-10 font-sans">
            <div className="max-w-7xl mx-auto space-y-10">
                {/* Header */}
                {/* Header */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-[var(--accent-muted)] rounded-xl">
                            <TrendingUp className="h-8 w-8 text-[var(--accent)]" />
                        </div>
                        <div>
                            <h1 className="text-4xl text-[var(--text-primary)] mb-1" style={{ fontFamily: 'var(--font-display)' }}>
                                Analytics Dashboard
                            </h1>
                            <div className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
                                <span className={clsx("flex items-center gap-1.5 font-medium", growth >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                    {growth >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                    {Math.abs(growth).toFixed(1)}% Growth
                                </span>
                                <span className="w-1 h-1 bg-[var(--text-muted)] rounded-full opacity-50" />
                                <span>{new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(totalRevenue)} Revenue</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-1 self-start md:self-auto">
                        <button
                            onClick={() => setSelectedYear(y => y - 1)}
                            className="p-1.5 hover:text-[var(--accent)] transition-colors"
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <span className="font-bold px-3 min-w-[60px] text-center text-sm">{selectedYear}</span>
                        <button
                            onClick={() => setSelectedYear(y => y + 1)}
                            className="p-1.5 hover:text-[var(--accent)] transition-colors"
                        >
                            <ChevronRight size={16} />
                        </button>
                    </div>
                </div>

                {/* KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {/* Revenue Card - with EDIT button */}
                    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 hover:border-[var(--accent)]/30 transition-colors group relative">
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">Total Revenue</h3>
                            <div className="p-2 bg-[var(--accent)]/10 text-[var(--accent)] rounded-lg"><DollarSign size={18} /></div>
                        </div>
                        <div className="text-2xl font-light text-[var(--text-primary)] mb-2">
                            {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(totalRevenue)}
                        </div>
                        {/* Target Progress */}
                        <div className="mt-4 pt-4 border-t border-[var(--border)] dashed">
                            {isEditingTargetKpi ? (
                                <div className="flex items-center gap-2 animate-in fade-in">
                                    <input
                                        autoFocus
                                        className="w-full bg-[var(--bg-elevated)] text-[var(--text-primary)] text-xs p-1 rounded border border-[var(--accent)] outline-none invalid:border-red-500"
                                        value={tempTargetKpi}
                                        onChange={e => setTempTargetKpi(e.target.value)}
                                        placeholder="Target (IDR)..."
                                        type="number"
                                        min="0"
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') {
                                                const val = Number(tempTargetKpi);
                                                if (tempTargetKpi !== '' && !isNaN(val) && val >= 0) {
                                                    updateTargetMutation.mutate(val);
                                                }
                                            }
                                            if (e.key === 'Escape') setIsEditingTargetKpi(false);
                                        }}
                                    />
                                    <button
                                        onClick={() => {
                                            const val = Number(tempTargetKpi);
                                            if (tempTargetKpi !== '' && !isNaN(val) && val >= 0) {
                                                updateTargetMutation.mutate(val);
                                            }
                                        }}
                                        className="text-emerald-500 hover:bg-emerald-500/10 p-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                                        disabled={!tempTargetKpi || Number(tempTargetKpi) < 0 || isNaN(Number(tempTargetKpi))}
                                    >
                                        <Save size={14} />
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between text-xs">
                                    <span className={clsx("font-bold", growth >= 0 ? "text-emerald-500" : "text-rose-500")}>
                                        {growth >= 0 ? '↗' : '↘'} {Math.abs(growth).toFixed(0)}% vs Last Year
                                    </span>
                                    <button
                                        onClick={() => {
                                            setTempTargetKpi(String(data.meta.monthly_target || 50000000));
                                            setIsEditingTargetKpi(true);
                                        }}
                                        className="text-[var(--text-muted)] hover:text-[var(--accent)] flex items-center gap-1 transition-colors opacity-0 group-hover:opacity-100"
                                    >
                                        Target <Edit2 size={10} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 hover:border-[var(--accent)]/30 transition-colors">
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">Invoices</h3>
                            <div className="p-2 bg-blue-500/10 text-blue-500 rounded-lg"><Target size={18} /></div>
                        </div>
                        <div className="text-2xl font-light text-[var(--text-primary)] mb-2">{count}</div>
                        <div className="text-xs text-[var(--text-muted)] mt-4 pt-4 border-t border-[var(--border)]">Projects in {selectedYear}</div>
                    </div>

                    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 hover:border-[var(--accent)]/30 transition-colors">
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">Top Venue</h3>
                            <div className="p-2 bg-purple-500/10 text-purple-500 rounded-lg"><MapPin size={18} /></div>
                        </div>
                        <div className="text-xl font-medium text-[var(--text-primary)] mb-2 line-clamp-1" title={topVenue[0]}>{topVenue[0]}</div>
                        <div className="text-xs text-[var(--text-muted)] mt-4 pt-4 border-t border-[var(--border)]">{topVenue[1]} Events hosted</div>
                    </div>

                    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 hover:border-[var(--accent)]/30 transition-colors">
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-widest">Top Package</h3>
                            <div className="p-2 bg-amber-500/10 text-amber-500 rounded-lg"><Package size={18} /></div>
                        </div>
                        <div className="text-xl font-medium text-[var(--text-primary)] mb-2 line-clamp-1" title={topPackage[0]}>{topPackage[0]}</div>
                        <div className="text-xs text-[var(--text-muted)] mt-4 pt-4 border-t border-[var(--border)]">{topPackage[1]} Units sold</div>
                    </div>
                </div>

                {/* Charts Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Revenue Chart */}
                    <div className="lg:col-span-3 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-8">
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h3 className="text-xl text-[var(--text-primary)] mb-1" style={{ fontFamily: 'var(--font-display)' }}>Revenue Trends</h3>
                                <p className="text-sm text-[var(--text-muted)]">Monthly performance vs Target</p>
                            </div>
                            <div className="text-right">
                                <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-1">Monthly Target</div>
                                {isEditingTargetChart ? (
                                    <div className="flex items-center justify-end gap-2 animate-in fade-in">
                                        <input
                                            autoFocus
                                            className="w-32 bg-[var(--bg-elevated)] text-[var(--text-primary)] text-right text-sm p-1 rounded border border-[var(--accent)] outline-none invalid:border-red-500"
                                            value={tempTargetChart}
                                            onChange={e => setTempTargetChart(e.target.value)}
                                            placeholder="Target..."
                                            type="number"
                                            min="0"
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') {
                                                    const val = Number(tempTargetChart);
                                                    if (tempTargetChart !== '' && !isNaN(val) && val >= 0) {
                                                        updateTargetMutation.mutate(val);
                                                    }
                                                }
                                                if (e.key === 'Escape') setIsEditingTargetChart(false);
                                            }}
                                        />
                                        <button
                                            onClick={() => {
                                                const val = Number(tempTargetChart);
                                                if (tempTargetChart !== '' && !isNaN(val) && val >= 0) {
                                                    updateTargetMutation.mutate(val);
                                                }
                                            }}
                                            className="text-emerald-500 hover:bg-emerald-500/10 p-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                                            disabled={!tempTargetChart || Number(tempTargetChart) < 0 || isNaN(Number(tempTargetChart))}
                                        >
                                            <Save size={16} />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-end gap-2 group cursor-pointer" onClick={() => {
                                        setTempTargetChart(String(target));
                                        setIsEditingTargetChart(true);
                                    }}>
                                        <span className="text-lg font-light text-[var(--accent)]">
                                            {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(target)}
                                        </span>
                                        <Edit2 size={12} className="text-[var(--text-muted)] opacity-50 group-hover:opacity-100 transition-opacity" />
                                    </div>
                                )}
                            </div>
                        </div>

                        <RevenueChart data={months} target={target} />
                    </div>
                </div>

                {/* Heatmap & Quick Jump */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-8">
                        <div className="flex items-center gap-3 mb-6">
                            <Calendar className="text-[var(--accent)]" size={20} />
                            <h3 className="text-xl text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>Event Calendar</h3>
                        </div>
                        <CalendarHeatmap bookings={bookings} year={selectedYear} />
                    </div>

                    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-8">
                        <div className="flex items-center gap-3 mb-6">
                            <ArrowUpRight className="text-[var(--accent)]" size={20} />
                            <h3 className="text-xl text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-display)' }}>Quick Actions</h3>
                        </div>

                        <div className="space-y-6">
                            <div>
                                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest block mb-2">Filter Month</label>
                                <select
                                    className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[var(--accent)]"
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
                                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest block mb-2">Select Event</label>
                                <select
                                    className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[var(--accent)]"
                                    value={jumpEventId || ''}
                                    onChange={(e) => setJumpEventId(Number(e.target.value))}
                                >
                                    <option value="">Select an event...</option>
                                    {bookings
                                        .filter((b: Booking) => b.month === jumpMonth)
                                        .sort((a: Booking, b: Booking) => Date.parse(a.date_str + "T00:00:00") - Date.parse(b.date_str + "T00:00:00"))
                                        .map((b: Booking) => (
                                            <option key={b.id} value={b.id}>
                                                {b.date_str} - {b.client_name}
                                            </option>
                                        ))
                                    }
                                </select>
                            </div>

                            <button
                                className="w-full bg-[var(--accent)] text-[var(--bg-deep)] font-bold uppercase tracking-widest text-xs py-3 px-4 rounded-lg hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg mt-4"
                                onClick={() => {
                                    if (jumpEventId) {
                                        navigate({ to: '/create', search: { editId: jumpEventId } });
                                    }
                                }}
                                disabled={!jumpEventId}
                            >
                                Edit Invoice
                            </button>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}
