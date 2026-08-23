import { ShoppingCart, Trash2, Package, Info, Minus, Plus, X } from 'lucide-react';
import clsx from 'clsx';
import type { InvoiceItem, PaymentTerm } from '../types/invoice';

const safeNumber = (value: unknown, fallback = 0) => {
    const numberValue = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number(value.replace(/[^\d.-]/g, ''))
            : Number(value);
    return Number.isFinite(numberValue) ? numberValue : fallback;
};

const formatNumber = (value: unknown) => safeNumber(value).toLocaleString('id-ID');

interface BillItemsProps {
    items: InvoiceItem[];
    selectedRowIds: Set<string>;
    toggleSelection: (id: string) => void;
    updateItem: <Key extends keyof InvoiceItem>(id: string, field: Key, value: InvoiceItem[Key]) => void;
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
    canIncreaseCashback: boolean;
    paymentTerms: PaymentTerm[];
    updatePaymentTerm: <Key extends keyof PaymentTerm>(id: string, field: Key, value: PaymentTerm[Key]) => void;
    stepPaymentTerm: (id: string, dir: 'up' | 'down') => void;
    removePaymentTerm: (id: string) => void;
    addPaymentTerm: () => void;
    fillRemaining: () => void;
    undoFillRemaining: () => void;
    hasFilledRemaining: boolean;
    remaining: number;
    canAddPaymentTerm: boolean;
    hasError?: boolean;
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
    canIncreaseCashback,
    paymentTerms,
    updatePaymentTerm,
    stepPaymentTerm,
    removePaymentTerm,
    addPaymentTerm,
    fillRemaining,
    undoFillRemaining,
    hasFilledRemaining,
    remaining,
    canAddPaymentTerm,
    hasError,
}: BillItemsProps) {
    const allocationState = remaining > 0 ? 'UNALLOCATED' : remaining < 0 ? 'OVERALLOCATED' : 'ALLOCATED';
    const allocationClass = remaining > 0
        ? 'border-orange-500/25 bg-orange-500/10 text-orange-500'
        : remaining < 0
            ? 'border-red-500/25 bg-red-500/10 text-red-500'
            : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-500';
    const allocationDetail = remaining < 0
        ? `Over by ${rupiah(Math.abs(remaining))}`
        : `Remaining: ${rupiah(remaining)}`;

    return (
        <>

            {items.length === 0 ? (
                <div className={clsx(
                    "relative border-2 border-dashed rounded-2xl py-12 text-center transition-all group overflow-hidden bg-[var(--bg-card)]",
                    hasError 
                        ? "border-red-500 bg-red-500/5 animate-shake shadow-[0_0_15px_rgba(239,68,68,0.1)]" 
                        : "border-[var(--border)] hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/[0.02]"
                )}>
                    <div className="relative z-10 flex flex-col items-center">
                        <div className={clsx(
                            "w-16 h-16 rounded-2xl flex items-center justify-center border transition-all duration-500 mb-4",
                            hasError
                                ? "bg-red-500/10 border-red-500/50 text-red-500"
                                : "bg-[var(--bg-elevated)] border-[var(--border)] text-[var(--text-muted)] group-hover:scale-110 group-hover:border-[var(--accent)]/40"
                        )}>
                            <ShoppingCart size={28} className={!hasError ? "group-hover:text-[var(--accent)] transition-colors" : ""} />
                        </div>
                        <div className="space-y-1">
                            <h3 className={clsx("text-sm font-bold", hasError ? "text-red-500" : "text-[var(--text-primary)]")}>
                                {hasError ? "Items Mandatory" : "Your Cart is Empty"}
                            </h3>
                            <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-[0.15em] font-medium max-w-xs mx-auto leading-relaxed px-4">
                                {hasError 
                                    ? "You must select at least one package to proceed with invoice creation." 
                                    : "Select packages from the right sidebar to add items to this invoice."}
                            </p>
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                    <div className="md:min-w-[880px]">
                        {/* Table Header (Desktop) */}
                        <div className="hidden rounded-t-lg md:grid md:grid-cols-[minmax(0,1fr)_170px_80px_300px] gap-4 border-b border-[var(--border)] bg-[var(--bg-elevated)]/45 px-4 py-3 text-[11px] font-semibold tracking-[0.06em] text-[var(--text-secondary)]">
                            <div className="pl-8 text-left">Description</div>
                            <div className="text-right">Price</div>
                            <div className="text-center">Qty</div>
                            <div className="pr-1 text-right">Total</div>
                        </div>

                        {/* Merge Button Header */}
                        {selectedRowIds.size >= 2 && (
                            <div className="flex items-center justify-between border-b border-[var(--accent)]/25 bg-[var(--accent)]/10 px-4 py-2 animate-in fade-in">
                                <span className="text-xs font-bold text-[var(--accent)]">{selectedRowIds.size} Items Selected</span>
                                <button
                                    onClick={onShowMergeModal}
                                    className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--bg-deep)] transition-opacity hover:opacity-90"
                                >
                                    Merge Selected
                                </button>
                            </div>
                        )}

                        {/* Items List */}
                        <div>
                        {items.map(item => (
                            <div key={item.id}>
                                {/* Desktop View */}
                                <div className="hidden md:grid md:grid-cols-[minmax(0,1fr)_170px_80px_300px] gap-4 border-b border-[var(--border)]/60 px-4 py-4 items-center transition-colors group relative hover:z-[50] hover:bg-[var(--bg-elevated)]/35 last:border-b-0">
                                    <div className="flex items-start gap-3">
                                        <div className="pt-1">
                                            {!item.isBundle ? (
                                                <input
                                                    id={`item-select-desktop-${item.id}`}
                                                    name={`itemSelectDesktop-${item.id}`}
                                                    aria-label={`Select ${item.desc}`}
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
                                                    id={`item-description-desktop-${item.id}`}
                                                    name={`itemDescriptionDesktop-${item.id}`}
                                                    aria-label={`Description for ${item.desc}`}
                                                    type="text"
                                                    value={item.desc}
                                                    onChange={(e) => updateItem(item.id, 'desc', e.target.value)}
                                                    className={clsx(
                                                        "min-w-0 flex-1 !h-auto !min-h-0 !border-0 !bg-transparent !p-0 !shadow-none !ring-0 focus:!ring-0 text-sm placeholder-[var(--text-muted)] leading-tight font-display",
                                                        item.isBundle ? "text-[var(--accent)] font-semibold" : "text-[var(--text-primary)] font-semibold"
                                                    )}
                                                />
                                                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                                                    {item.isBundle && (
                                                        <button
                                                            onClick={() => unmergeBundle(item.id)}
                                                            className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--accent)]/10 hover:text-[var(--accent)]"
                                                            title="Unmerge Bundle"
                                                        >
                                                            <Info size={14} />
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => deleteItem(item.id)}
                                                        className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-500"
                                                        title="Remove item"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
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
                                    <div className="flex h-8 items-center justify-end">
                                        <div className="flex items-center justify-end gap-1">
                                            <span className="shrink-0 text-right text-[10px] font-bold text-[var(--accent)] opacity-60">Rp</span>
                                            <span className="w-20 text-right text-sm font-medium tabular-nums text-[var(--text-primary)] font-display">
                                                {formatNumber(item.price)}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex justify-center">
                                        <input
                                            id={`item-quantity-desktop-${item.id}`}
                                            name={`itemQuantityDesktop-${item.id}`}
                                            aria-label={`Quantity for ${item.desc}`}
                                            type="number"
                                            min="1"
                                            value={Math.max(1, safeNumber(item.qty, 1))}
                                            onChange={(e) => updateItem(item.id, 'qty', Math.max(1, Number(e.target.value) || 1))}
                                            className="h-8 w-12 rounded border border-transparent bg-transparent p-0 text-center font-display text-xs font-medium tabular-nums text-[var(--text-primary)] outline-none transition-colors hover:border-[var(--border)] focus:border-[var(--accent)]"
                                        />
                                    </div>
                                    <div className="flex h-8 items-center justify-end pr-1">
                                        <div className="flex items-center justify-end gap-1">
                                            <span className="shrink-0 text-right text-[10px] font-bold text-[var(--accent)] opacity-60">Rp</span>
                                            <span className="w-24 text-right text-sm font-semibold tabular-nums text-[var(--text-primary)] font-display">
                                                {formatNumber(safeNumber(item.price) * Math.max(1, safeNumber(item.qty, 1)))}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Mobile View */}
                                <div className="md:hidden border-b border-[var(--border)]/60 px-4 py-4 space-y-3 last:border-b-0">
                                    <div className="flex items-start gap-3">
                                        <div className="pt-0.5 shrink-0 text-left">
                                            {!item.isBundle ? (
                                                <input
                                                    id={`item-select-mobile-${item.id}`}
                                                    name={`itemSelectMobile-${item.id}`}
                                                    aria-label={`Select ${item.desc}`}
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
                                                id={`item-description-mobile-${item.id}`}
                                                name={`itemDescriptionMobile-${item.id}`}
                                                aria-label={`Description for ${item.desc}`}
                                                type="text"
                                                value={item.desc}
                                                onChange={(e) => updateItem(item.id, 'desc', e.target.value)}
                                                className={clsx(
                                                    "w-full !h-auto !min-h-0 !border-0 !bg-transparent !p-0 !shadow-none !ring-0 focus:!ring-0 text-sm placeholder-[var(--text-muted)]",
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
                                            <label htmlFor={`item-price-mobile-${item.id}`} className="mb-0.5 block text-[10px] font-medium font-sans uppercase tracking-[0.2em] text-[var(--text-muted)]">Price</label>
                                            <input
                                                id={`item-price-mobile-${item.id}`}
                                                name={`itemPriceMobile-${item.id}`}
                                                type="number"
                                                value={safeNumber(item.price)}
                                                onChange={(e) => updateItem(item.id, 'price', Number(e.target.value))}
                                                disabled={!item.isBundle}
                                                className={clsx(
                                                    "w-full bg-transparent border-none p-0 text-sm focus:ring-0 transition-colors",
                                                    item.isBundle ? "text-[var(--text-secondary)]" : "text-[var(--text-muted)]"
                                                )}
                                            />
                                        </div>
                                        <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2 py-1">
                                            <label htmlFor={`item-quantity-mobile-${item.id}`} className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Qty</label>
                                            <input
                                                id={`item-quantity-mobile-${item.id}`}
                                                name={`itemQuantityMobile-${item.id}`}
                                                aria-label={`Quantity for ${item.desc}`}
                                                type="number"
                                                min="1"
                                                value={Math.max(1, safeNumber(item.qty, 1))}
                                                onChange={(e) => updateItem(item.id, 'qty', Math.max(1, Number(e.target.value) || 1))}
                                                className="h-6 w-8 border-0 bg-transparent p-0 text-center font-display text-xs font-medium text-[var(--text-primary)] outline-none"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                        </div>

                    {/* Settlement ledger */}
                    <div className="border-t border-[var(--border)] pt-4">
                        <div className="space-y-1">
                            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-[var(--border)]/60 px-4 py-3 md:grid-cols-[minmax(0,1fr)_170px_80px_300px]">
                                <span className="label-xs text-[var(--text-muted)] md:col-span-3 md:text-right">Subtotal</span>
                                <div className="flex items-baseline justify-end gap-3">
                                    <span className="text-[10px] font-bold text-[var(--accent)]/70">Rp</span>
                                    <span className="font-display text-lg font-semibold tabular-nums text-[var(--text-primary)]">{formatNumber(subtotal)}</span>
                                </div>
                            </div>

                            <div className="grid grid-cols-[minmax(0,1fr)_11rem] items-center gap-3 border-b border-[var(--border)]/60 px-4 py-3 md:grid-cols-[minmax(0,1fr)_170px_80px_300px] md:gap-4">
                                <label htmlFor="cashback-amount" className="label-xs shrink-0 text-[var(--text-muted)] md:col-span-3 md:text-right">Cashback</label>
                                <div className="flex h-10 w-full items-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)]/20 px-1.5">
                                    <button type="button" onClick={() => setCashback((prev) => cashbackStepDown(prev))} disabled={cashback === 0} aria-label="Decrease cashback" title="Decrease cashback" className="flex h-7 w-8 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-30">
                                        <Minus size={13} />
                                    </button>
                                    <button type="button" onClick={() => setCashback((prev) => cashbackStepUp(prev))} disabled={!canIncreaseCashback} aria-label="Increase cashback" title="Increase cashback" className="flex h-7 w-8 shrink-0 items-center justify-center rounded text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/10 disabled:cursor-not-allowed disabled:opacity-30">
                                        <Plus size={13} />
                                    </button>
                                    <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
                                        <span className="text-[10px] font-bold text-[var(--accent)]/70">Rp</span>
                  <span id="cashback-amount" className="font-display text-lg font-semibold tabular-nums text-[var(--text-primary)]">{formatNumber(cashback)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="mt-5 border-t border-[var(--border)] pt-4">
                            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-[var(--border)]/60 px-4 py-4 md:grid-cols-[minmax(0,1fr)_170px_80px_300px]">
                                <div className="md:col-span-3">
                                    <div className="text-sm font-semibold text-[var(--text-primary)]">Payment Status</div>
                                    <div className="mt-1 text-xs text-[var(--text-muted)]">{allocationDetail}</div>
                                </div>
          <span className={clsx("rounded-full border px-3 py-1 text-center text-[9px] font-bold uppercase tracking-[0.12em]", allocationClass)}>{allocationState}</span>
                            </div>
                        </div>

                        <div className="mt-4 border-t border-[var(--border)] pt-4">
                            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-[var(--border)]/60 px-4 py-3 md:grid-cols-[minmax(0,1fr)_170px_80px_300px]">
                                <span className="label-xs text-[var(--accent)] md:col-span-3 md:text-right">Jadwal Termin</span>
                                {hasFilledRemaining ? (
                                    <button type="button" onClick={undoFillRemaining} className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)]/40 px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)] transition-colors hover:border-[var(--accent)]/50 hover:text-[var(--accent)]">Undo fill</button>
                                ) : remaining > 0 ? (
                                    <button type="button" onClick={fillRemaining} className="w-full rounded-md border border-[var(--accent)]/35 bg-[var(--accent)]/10 px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/20">Fill remaining</button>
                                ) : <span />}
                            </div>

                            <div>
                                {paymentTerms.map((term) => (
                                    <div key={term.id} className="group relative grid grid-cols-[minmax(0,1fr)_11rem] items-center gap-3 border-b border-[var(--border)]/60 px-4 py-3 md:grid-cols-[minmax(0,1fr)_170px_80px_300px] md:gap-4">
                                        <div className="min-w-0 md:col-span-3">
                                            {term.locked ? (
                                                <span className="label-xs block w-full text-left text-[var(--text-muted)] md:text-right">{term.label}</span>
                                            ) : (
                                                <input id={`payment-term-label-${term.id}`} name={`paymentTermLabel-${term.id}`} aria-label={`Label for ${term.label}`} type="text" value={term.label} onChange={(e) => updatePaymentTerm(term.id, 'label', e.target.value)} className="w-full !h-auto !min-h-0 !border-0 !bg-transparent !p-0 !shadow-none !ring-0 focus:!ring-0 !text-[10px] !font-bold !tracking-[0.15em] !uppercase !leading-none text-left text-[var(--text-muted)] outline-none md:text-right" />
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="flex h-10 min-w-0 flex-1 items-center rounded-md border border-[var(--border)] bg-[var(--bg-elevated)]/20 px-1.5">
                                                <button type="button" onClick={() => stepPaymentTerm(term.id, 'down')} aria-label={`Decrease ${term.label}`} title="Decrease amount" className="flex h-7 w-8 shrink-0 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--accent)]"><Minus size={13} /></button>
                                                <button type="button" onClick={() => stepPaymentTerm(term.id, 'up')} aria-label={`Increase ${term.label}`} title="Increase amount" className="flex h-7 w-8 shrink-0 items-center justify-center rounded text-[var(--accent)] transition-colors hover:bg-[var(--accent)]/10"><Plus size={13} /></button>
                                                <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                                                    <span className="text-[10px] font-bold text-[var(--accent)]/70">Rp</span>
                                                    {term.locked ? <span className="w-full text-right font-display text-base font-semibold tabular-nums text-[var(--text-primary)]">{formatNumber(term.amount)}</span> : <input id={`payment-term-amount-${term.id}`} name={`paymentTermAmount-${term.id}`} aria-label={`Amount for ${term.label}`} type="text" value={formatNumber(term.amount)} onChange={(e) => updatePaymentTerm(term.id, 'amount', Number(e.target.value.replace(/\D/g, '')))} className="w-full !h-auto !min-h-0 !border-0 !bg-transparent !p-0 !shadow-none !ring-0 focus:!ring-0 text-right font-display text-base font-semibold tabular-nums text-[var(--text-primary)] outline-none" />}
                                                </div>
                                            </div>
                                        </div>
                                        {!term.locked && <button type="button" onClick={() => removePaymentTerm(term.id)} aria-label={`Remove ${term.label}`} title="Remove payment term" className="absolute right-[316px] top-1/2 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-[var(--text-muted)] transition-colors hover:bg-red-500/10 hover:text-red-500 md:flex md:opacity-0 md:group-hover:opacity-100"><X size={14} /></button>}
                                    </div>
                                ))}
                            </div>

                            <div className="grid grid-cols-1 px-4 pt-3 md:grid-cols-[minmax(0,1fr)_170px_80px_300px]">
                                <button type="button" onClick={addPaymentTerm} disabled={!canAddPaymentTerm} className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-dashed border-[var(--border)] text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-muted)] transition-colors hover:border-[var(--accent)]/60 hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-35 md:col-start-4"><Plus size={13} /> Add Payment Term</button>
                            </div>
                        </div>

                        <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 border-t-2 border-[var(--border)] px-4 py-5 md:grid-cols-[minmax(0,1fr)_170px_80px_300px]">
                            <span className="label-xs text-[var(--accent)] md:col-span-3 md:text-right">Grand Total</span>
                            <div className="flex items-baseline justify-end gap-3">
                                <span className="text-[10px] font-bold text-[var(--accent)]/70">Rp</span>
                                <span className="font-display text-3xl font-semibold tabular-nums text-[var(--text-primary)]">{formatNumber(grandTotal)}</span>
                            </div>
                        </div>
                    </div>
                    </div>
                    </div>
                </>
            )}
        </>
    );
}
