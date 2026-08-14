import { X } from 'lucide-react';
import clsx from 'clsx';
import type { InvoiceItem } from '../types/invoice';

interface MergeModalProps {
    show: boolean;
    onClose: () => void;
    title: string;
    setTitle: (val: string) => void;
    priceMode: 'sum' | 'custom';
    setPriceMode: (val: 'sum' | 'custom') => void;
    customPrice: number;
    setCustomPrice: (val: number) => void;
    onMerge: () => void;
    items: InvoiceItem[];
}

export function MergeModal({
    show,
    onClose,
    title,
    setTitle,
    priceMode,
    setPriceMode,
    customPrice,
    setCustomPrice,
    onMerge,
    items
}: MergeModalProps) {
    if (!show) return null;

    const totalToMerge = items.reduce((sum, item) => sum + (item.price * item.qty), 0);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-[400px] p-8 shadow-2xl relative overflow-hidden">
                <div className="flex justify-between items-start mb-6">
                    <div className="space-y-1">
                        <h3 className="text-2xl font-medium tracking-tight text-[var(--text-primary)] font-display">Merge Items</h3>
                        <p className="text-[10px] text-[var(--accent)] font-bold uppercase tracking-[0.2em] opacity-80">Bundle Synthesis</p>
                    </div>
                    <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors mt-1"><X size={20} /></button>
                </div>

                <div className="space-y-6">
                    {/* Item Preview List */}
                    <div className="space-y-3">
                        <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.2em]">Selected Items ({items.length})</label>
                        <div className="bg-[var(--bg-elevated)]/50 border border-[var(--border)] rounded-xl p-4 max-h-[160px] overflow-y-auto space-y-2.5 custom-scrollbar">
                            {items.map((item, idx) => (
                                <div key={idx} className="flex justify-between items-center gap-3">
                                    <span className="text-[11px] text-[var(--text-secondary)] font-medium truncate flex-1">{item.desc}</span>
                                    <span className="text-[10px] text-[var(--text-muted)] font-mono tabular-nums">Rp {item.price.toLocaleString('id-ID')}</span>
                                </div>
                            ))}
                        </div>
                        <p className="text-[9px] text-[var(--text-muted)] italic leading-relaxed px-1">
                             You are combining these items into a single professional line item.
                        </p>
                    </div>

                    <div className="space-y-3">
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.2em]">New Bundle Title</label>
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="e.g. Wedding Package Bundle"
                                className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none transition-all placeholder:opacity-50"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.2em]">Pricing Strategy</label>
                            <div className="flex bg-[var(--bg-elevated)] p-1 rounded-xl border border-[var(--border)]">
                                <button
                                    onClick={() => setPriceMode('sum')}
                                    className={clsx(
                                        "flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all duration-300",
                                        priceMode === 'sum'
                                            ? "bg-[var(--bg-card)] text-[var(--accent)] shadow-sm border border-[var(--border)]"
                                            : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                    )}
                                >
                                    Sum ({totalToMerge.toLocaleString('id-ID')})
                                </button>
                                <button
                                    onClick={() => setPriceMode('custom')}
                                    className={clsx(
                                        "flex-1 py-2 text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all duration-300",
                                        priceMode === 'custom'
                                            ? "bg-[var(--bg-card)] text-[var(--accent)] shadow-sm border border-[var(--border)]"
                                            : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                    )}
                                >
                                    Custom Price
                                </button>
                            </div>
                        </div>

                        {priceMode === 'custom' && (
                            <div className="space-y-2 animate-in zoom-in-95 fade-in duration-300">
                                <label className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-[0.2em]">Enter Custom Amount</label>
                                <div className="relative">
                                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[var(--accent)] opacity-50">Rp</span>
                                    <input
                                        type="number"
                                        value={customPrice}
                                        onChange={(e) => setCustomPrice(Number(e.target.value))}
                                        className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-xl pl-10 pr-4 py-3 text-sm text-[var(--text-primary)] font-bold focus:border-[var(--accent)] outline-none tabular-nums"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex gap-4 mt-10">
                    <button onClick={onClose} className="flex-1 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors font-sans">Cancel</button>
                    <button
                        onClick={onMerge}
                        className="flex-[1.5] px-6 py-3 bg-[var(--accent)] text-[var(--bg-deep)] text-[10px] font-bold uppercase tracking-[0.2em] rounded-xl hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-[var(--accent)]/20 font-sans"
                    >
                        Confirm Merge
                    </button>
                </div>
            </div>
        </div>
    );
}
