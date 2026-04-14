import { ShoppingCart, Trash2, Package, Info, X } from 'lucide-react';
import clsx from 'clsx';
import type { InvoiceItem, PaymentTerm } from '../types/invoice';

interface BillItemsProps {
    items: InvoiceItem[];
    selectedRowIds: Set<string>;
    toggleSelection: (id: string) => void;
    updateItem: (id: string, field: keyof InvoiceItem, value: any) => void;
    deleteItem: (id: string) => void;
    unmergeBundle: (id: string) => void;
    onShowMergeModal: () => void;
    subtotal: number;
    cashback: number;
    setCashback: (val: number | ((prev: number) => number)) => void;
    grandTotal: number;
    rupiah: (n: number) => string;
    cashbackStepUp: (val: number) => number;
    cashbackStepDown: (val: number) => number;
    // Payment Terms Props
    paymentTerms: PaymentTerm[];
    updatePaymentTerm: (id: string, field: keyof PaymentTerm, value: any) => void;
    stepPaymentTerm: (id: string, dir: 'up' | 'down') => void;
    removePaymentTerm: (id: string) => void;
    addPaymentTerm: () => void;
    fillRemaining: () => void;
    remaining: number;
}

export function BillItems({
    items,
    selectedRowIds,
    toggleSelection,
    updateItem,
    deleteItem,
    unmergeBundle,
    onShowMergeModal,
    subtotal,
    cashback,
    setCashback,
    grandTotal,
    rupiah,
    cashbackStepUp,
    cashbackStepDown,
    paymentTerms,
    updatePaymentTerm,
    stepPaymentTerm,
    removePaymentTerm,
    addPaymentTerm,
    fillRemaining,
    remaining
}: BillItemsProps) {
    return (
        <>
            {items.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-[var(--border)] rounded-lg bg-[var(--bg-elevated)]/50">
                    <div className="w-12 h-12 rounded-full bg-[var(--bg-elevated)] flex items-center justify-center mx-auto mb-3 text-[var(--text-muted)]">
                        <ShoppingCart size={20} />
                    </div>
                    <p className="text-[var(--text-muted)] text-sm">Your cart is empty.</p>
                    <p className="text-[var(--text-muted)] text-xs mt-1">Select packages from the sidebar to add items.</p>
                </div>
            ) : (
                <>
                    {/* Table Header (Desktop) */}
                    <div className="hidden md:grid grid-cols-[1fr_80px_180px_40px] gap-4 px-2 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)] border-b border-[var(--border)]/60">
                        <div className="text-left">Service / Item</div>
                        <div className="text-left pl-1">Qty</div>
                        <div className="text-right">Price</div>
                        <div className="text-right pr-1">Actions</div>
                    </div>

                    {/* Merge Button Header */}
                    {selectedRowIds.size >= 2 && (
                        <div className="flex justify-between items-center bg-[var(--accent)]/10 border border-[var(--accent)]/30 p-2 rounded mb-2 animate-in fade-in">
                            <span className="text-xs text-[var(--accent)] font-bold px-2">{selectedRowIds.size} Items Selected</span>
                            <button
                                onClick={onShowMergeModal}
                                className="text-xs bg-[var(--accent)] text-[var(--bg-deep)] px-3 py-1.5 rounded font-bold uppercase tracking-wider hover:opacity-90 transition-opacity"
                            >
                                Merge Selected
                            </button>
                        </div>
                    )}

                    {/* Items List */}
                    <div className="space-y-2">
                        {items.map(item => (
                            <div key={item.id}>
                                {/* Desktop View */}
                                <div className="grid grid-cols-[1fr_80px_180px_40px] gap-4 py-3 border-b border-[var(--border)]/60 items-center hover:bg-[var(--bg-elevated)]/35 px-2 transition-colors group relative hover:z-[50]">
                                    <div className="flex items-start gap-2">
                                        <div className="pt-1">
                                            {!item.isBundle ? (
                                                <input
                                                    type="checkbox"
                                                    checked={selectedRowIds.has(item.id)}
                                                    onChange={() => toggleSelection(item.id)}
                                                    className="accent-[var(--accent)] cursor-pointer"
                                                />
                                            ) : (
                                                <Package size={14} className="text-[var(--accent)]" />
                                            )}
                                        </div>
                                        <div className="w-full text-left">
                                            <div className="flex items-center gap-2 relative">
                                                <input
                                                    type="text"
                                                    value={item.desc}
                                                    onChange={(e) => updateItem(item.id, 'desc', e.target.value)}
                                                    className={clsx(
                                                        "w-full bg-transparent border-none p-0 text-sm focus:ring-0 placeholder-[var(--text-muted)] leading-tight",
                                                        item.isBundle ? "text-[var(--accent)] font-semibold" : "text-[var(--text-primary)] font-semibold"
                                                    )}
                                                />
                                            </div>
                                            {item.details && (
                                                <div className="mt-1.5 flex flex-col gap-1 font-sans font-normal leading-relaxed">
                                                    {item.details.split('\n').filter(Boolean).slice(0, 3).map((detail, idx) => (
                                                        <div key={idx} className="flex items-center gap-2 pl-0.5 opacity-85">
                                                            <span className="text-[var(--accent)] opacity-40 shrink-0 text-[8px]">●</span>
                                                            <span className="truncate text-[11px] text-[var(--text-muted)]">{detail}</span>
                                                        </div>
                                                    ))}
                                                    {item.details.split('\n').filter(Boolean).length > 3 && (
                                                        <span className="group/tooltip relative cursor-help text-[var(--accent)] font-bold mt-1 ml-4 text-[10px] opacity-80 hover:opacity-100 transition-opacity">
                                                            +{item.details.split('\n').filter(Boolean).length - 3} more
                                                            <div className="hidden group-hover/tooltip:block absolute left-0 top-full mt-2 bg-[var(--bg-card)] border border-[var(--border)] p-3 rounded-lg shadow-xl z-[9999] w-64 text-[11px] text-[var(--text-secondary)] font-normal normal-case leading-relaxed ring-1 ring-[var(--border)]">
                                                                <div className="text-[9px] font-bold text-[var(--accent)] uppercase tracking-wider mb-2 border-b border-[var(--border)] pb-1">Full Package Details</div>
                                                                <ul className="space-y-1.5">
                                                                    {item.details.split('\n').filter(Boolean).map((d, i) => (
                                                                        <li key={i} className="flex gap-2 items-start text-[11px]">
                                                                            <span className="text-[var(--accent)]">•</span>
                                                                            {d}
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                            {item.isBundle && item._bundleSrc && (
                                                <div className="text-[10px] text-[var(--text-muted)] leading-tight mt-1.5 opacity-70 italic">
                                                    Bundle of: {item._bundleSrc.map(s => s.desc).join(', ')}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-left text-sm text-[var(--text-primary)] font-medium pl-1">
                                        {item.qty}
                                    </div>
                                    <div className="text-right">
                                        <div className="flex justify-end items-center gap-2">
                                            <span className="text-[11px] font-bold text-[var(--accent)] opacity-60 w-5 text-right shrink-0">Rp</span>
                                            <span className="text-sm font-bold text-[var(--text-primary)] w-28 text-right tabular-nums">
                                                {item.price.toLocaleString('id-ID')}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="text-right flex items-center justify-end gap-1">
                                        {item.isBundle && (
                                            <button
                                                onClick={() => unmergeBundle(item.id)}
                                                className="text-[var(--text-muted)] hover:text-[var(--accent)] p-1"
                                                title="Unmerge Bundle"
                                            >
                                                <Info size={14} />
                                            </button>
                                        )}
                                        <button
                                            onClick={() => deleteItem(item.id)}
                                            className="text-[var(--text-muted)] hover:text-red-500 p-1 transition-all"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>

                                {/* Mobile View */}
                                <div className="md:hidden py-4 border-b border-[var(--border)]/50 space-y-3">
                                    <div className="flex items-start gap-3">
                                        <div className="pt-0.5 shrink-0 text-left">
                                            {!item.isBundle ? (
                                                <input
                                                    type="checkbox"
                                                    checked={selectedRowIds.has(item.id)}
                                                    onChange={() => toggleSelection(item.id)}
                                                    className="accent-[var(--accent)] cursor-pointer"
                                                />
                                            ) : (
                                                <Package size={16} className="text-[var(--accent)]" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0 text-left">
                                            <input
                                                type="text"
                                                value={item.desc}
                                                onChange={(e) => updateItem(item.id, 'desc', e.target.value)}
                                                className={clsx(
                                                    "w-full bg-transparent border-none p-0 text-sm focus:ring-0 placeholder-[var(--text-muted)]",
                                                    item.isBundle ? "text-[var(--accent)] font-medium" : "text-[var(--text-primary)] font-medium"
                                                )}
                                            />
                                            {item.isBundle && item._bundleSrc && (
                                                <div className="text-[10px] text-[var(--text-muted)] leading-tight mt-1 truncate font-sans">
                                                    {item._bundleSrc.length} items bundled
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            onClick={() => deleteItem(item.id)}
                                            className="text-[var(--text-muted)] hover:text-red-500 p-1"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                    <div className="flex items-center justify-between pl-7">
                                        <div className="flex-1 text-left">
                                            <label className="mb-0.5 block text-[10px] font-medium font-sans uppercase tracking-[0.2em] text-[var(--text-muted)]">Price</label>
                                            <input
                                                type="number"
                                                value={item.price}
                                                onChange={(e) => updateItem(item.id, 'price', Number(e.target.value))}
                                                disabled={!item.isBundle}
                                                className={clsx(
                                                    "w-full bg-transparent border-none p-0 text-sm focus:ring-0 transition-colors",
                                                    item.isBundle ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"
                                                )}
                                            />
                                        </div>
                                        <div className="flex items-center gap-3 bg-[var(--bg-elevated)] rounded-full px-4 py-1 border border-[var(--border)]">
                                            <span className="font-mono text-xs font-bold w-4 text-center">{item.qty}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Totals Section */}
                    <div className="mt-8 pt-6 border-t border-[var(--border)]/70">
                        <div className="space-y-5">
                            <div className="grid grid-cols-[1fr_80px_180px_40px] gap-4 px-2 items-center">
                                <div className="col-span-2 text-right pr-6">
                                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">Subtotal</span>
                                </div>
                                <div className="text-right">
                                    <div className="flex justify-end items-center gap-2">
                                        <span className="text-[11px] font-bold text-[var(--accent)] opacity-60 w-5 text-right shrink-0">Rp</span>
                                        <span className="text-sm font-bold text-[var(--text-primary)] w-28 text-right tabular-nums">
                                            {subtotal.toLocaleString('id-ID')}
                                        </span>
                                    </div>
                                </div>
                                <div></div>
                            </div>

                            <div className="grid grid-cols-[1fr_80px_180px_40px] gap-4 px-2 items-center">
                                <div className="col-span-2 text-right pr-6">
                                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-muted)]">Cashback</span>
                                </div>
                                <div className="text-left py-1">
                                    <div className="flex items-center border border-[var(--border)] rounded-md px-2 py-1 bg-transparent gap-2 h-8 w-[180px] justify-between">
                                        <button
                                            type="button"
                                            onClick={() => setCashback((prev) => cashbackStepDown(prev))}
                                            className="text-[var(--text-muted)] hover:text-[var(--accent)] text-xs h-5 w-4 flex items-center justify-center transition-colors shrink-0"
                                        >
                                            -
                                        </button>
                                        <div className="flex-1 flex justify-end items-center gap-2">
                                            <span className="text-[11px] font-bold text-[var(--accent)] opacity-60 w-5 text-right shrink-0">Rp</span>
                                            <input
                                                type="text"
                                                value={cashback.toLocaleString('id-ID')}
                                                readOnly
                                                className="w-28 bg-transparent border-none p-0 text-sm text-right text-[var(--text-primary)] font-bold outline-none tabular-nums"
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setCashback((prev) => cashbackStepUp(prev))}
                                            className="text-[var(--accent)] hover:opacity-70 text-xs h-5 w-4 flex items-center justify-center transition-colors shrink-0"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>
                                <div></div>
                            </div>

                            <div className="pt-6 mt-2 space-y-3 border-t border-[var(--border)]/30">
                                <div className="grid grid-cols-[1fr_80px_180px_40px] gap-4 px-2 items-center mb-1">
                                    <div className="col-span-2 text-right pr-6">
                                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Jadwal Termin</span>
                                    </div>
                                    <div className="flex justify-start">
                                        <div className={clsx(
                                            "text-[9px] uppercase font-bold px-2.5 py-1 rounded-full tracking-widest transition-all",
                                            remaining === 0 ? "text-emerald-500 bg-emerald-500/10 border border-emerald-500/20" :
                                                "text-orange-500 bg-orange-500/10 border border-orange-500/20 shadow-sm shadow-orange-500/5"
                                        )}>
                                            {remaining === 0 ? 'Balanced' : `Unallocated: ${rupiah(remaining)}`}
                                        </div>
                                    </div>
                                    <div></div>
                                </div>

                                {paymentTerms.map((term) => (
                                    <div key={term.id} className="group relative grid grid-cols-[1fr_80px_180px_40px] gap-4 px-2 items-center py-0.5 transition-all hover:bg-[var(--bg-elevated)]/20 rounded-md">
                                        <div className="col-span-2 text-right pr-6">
                                            <input
                                                type="text"
                                                value={term.label}
                                                onChange={(e) => updatePaymentTerm(term.id, 'label', e.target.value)}
                                                disabled={term.locked}
                                                className="w-full bg-transparent border-none p-0 text-[10px] text-right text-[var(--text-secondary)] font-medium uppercase tracking-widest focus:ring-0 disabled:opacity-70 outline-none"
                                            />
                                        </div>
                                        <div className="flex items-center">
                                            <div className="flex items-center border border-[var(--border)] rounded-md px-2 py-1 bg-transparent gap-2 h-8 w-[180px] justify-between">
                                                <button
                                                    onClick={() => stepPaymentTerm(term.id, 'down')}
                                                    className="text-[var(--text-muted)] hover:text-[var(--accent)] text-xs h-5 w-4 flex items-center justify-center transition-colors shrink-0"
                                                >
                                                    -
                                                </button>
                                                <div className="flex-1 flex justify-end items-center gap-2">
                                                    <span className="text-[10px] font-bold text-[var(--accent)] opacity-60 w-5 text-right shrink-0">Rp</span>
                                                    {term.locked ? (
                                                        <span className="text-[14px] font-bold text-[var(--text-primary)] w-28 text-right tabular-nums py-[2px] h-8 flex items-center justify-end leading-none">
                                                            {term.amount.toLocaleString('id-ID')}
                                                        </span>
                                                    ) : (
                                                        <input
                                                            type="text"
                                                            value={term.amount.toLocaleString('id-ID')}
                                                            onChange={(e) => {
                                                                const val = e.target.value.replace(/\D/g, '');
                                                                updatePaymentTerm(term.id, 'amount', Number(val));
                                                            }}
                                                            className="w-28 bg-transparent border-none p-0 text-[14px] text-right text-[var(--text-primary)] font-bold focus:ring-0 outline-none tabular-nums h-8 leading-none"
                                                        />
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => stepPaymentTerm(term.id, 'up')}
                                                    className="text-[var(--accent)] hover:opacity-70 text-xs h-5 w-4 flex items-center justify-center transition-colors shrink-0"
                                                >
                                                    +
                                                </button>
                                            </div>
                                        </div>
                                        <div className="flex justify-center">
                                            {!term.locked && (
                                                <button onClick={() => removePaymentTerm(term.id)} className="text-[var(--text-muted)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1">
                                                    <X size={12} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}

                                {/* Bottom Controls: Right Aligned */}
                                <div className="grid grid-cols-[1fr_80px_180px_40px] gap-4 px-2 pt-2 items-center">
                                    <div className="col-span-2"></div>
                                    <div className="flex gap-2 w-[180px]">
                                        <button onClick={addPaymentTerm} className="flex-1 py-1 text-[8px] font-bold uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors border border-dashed border-[var(--border)] rounded">+ Termin</button>
                                        {remaining > 0 && <button onClick={fillRemaining} className="px-2 py-1 text-[8px] font-bold uppercase tracking-widest bg-[var(--accent)] text-[var(--bg-deep)] rounded hover:opacity-90 transition-opacity">Allocate</button>}
                                    </div>
                                    <div></div>
                                </div>
                            </div>

                            {/* Grand Total Row: Always Visible, Right Aligned */}
                            <div className="flex justify-between items-end w-full mt-12 pt-8 border-t-2 border-[var(--border)]/40 px-2">
                                <span className="text-[13px] font-bold uppercase tracking-[0.25em] text-[var(--text-muted)] pb-1" style={{ fontFamily: 'var(--font-display)' }}>Grand Total</span>
                                <div className="flex items-baseline gap-3">
                                    <span className="text-xl font-bold text-[var(--accent)] opacity-60">Rp</span>
                                    <span className="not-italic font-bold tracking-tight text-[var(--accent)] text-5xl tabular-nums leading-none">
                                        {grandTotal.toLocaleString('id-ID')}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}
