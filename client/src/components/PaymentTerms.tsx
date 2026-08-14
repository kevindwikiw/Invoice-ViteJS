import { X, Plus } from 'lucide-react';
import clsx from 'clsx';
import type { PaymentTerm } from '../types/invoice';

interface PaymentTermsProps {
    remaining: number;
    paymentTerms: PaymentTerm[];
    updatePaymentTerm: <Key extends keyof PaymentTerm>(id: string, field: Key, value: PaymentTerm[Key]) => void;
    stepPaymentTerm: (id: string, dir: 'up' | 'down') => void;
    removePaymentTerm: (id: string) => void;
    addPaymentTerm: () => void;
    fillRemaining: () => void;
    rupiah: (n: number) => string;
    className?: string;
}

export function PaymentTerms({
    remaining,
    paymentTerms,
    updatePaymentTerm,
    stepPaymentTerm,
    removePaymentTerm,
    addPaymentTerm,
    fillRemaining,
    rupiah,
    className
}: PaymentTermsProps) {
    return (
        <div className={clsx("space-y-6 animate-in fade-in duration-500", className)}>
            <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]"></div>
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--text-muted)]">Payment Milestones</h3>
                </div>
                <div className={clsx(
                    "text-[8px] uppercase font-black px-2.5 py-1 rounded-lg border tracking-widest",
                    remaining === 0 ? "bg-green-500/10 text-green-500 border-green-500/20" :
                    remaining > 0 ? "bg-orange-500/10 text-orange-500 border-orange-500/20" :
                    "bg-red-500/10 text-red-500 border-red-500/20"
                )}>
                    {remaining === 0 ? 'Balanced' : remaining > 0 ? `Unallocated: ${rupiah(remaining)}` : `Over: ${rupiah(Math.abs(remaining))}`}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {paymentTerms.map((term) => (
                    <div key={term.id} className="group flex items-center gap-4 bg-transparent border border-[var(--border)] p-4 rounded-2xl hover:border-[var(--accent)]/30 transition-all relative">
                        <div className="flex-1">
                            <label className="block text-[7px] font-black uppercase text-[var(--text-muted)] tracking-widest mb-1.5">Milestone Label</label>
                            <input
                                type="text"
                                value={term.label}
                                onChange={(e) => updatePaymentTerm(term.id, 'label', e.target.value)}
                                disabled={term.locked}
                                className="w-full bg-transparent border-none p-0 text-sm text-[var(--text-primary)] font-medium focus:ring-0 disabled:opacity-50 outline-none"
                                placeholder="e.g. Down Payment"
                            />
                        </div>
                        
                        <div className="w-32">
                            <label className="block text-[7px] font-black uppercase text-[var(--text-muted)] tracking-widest mb-1.5 text-right">Amount</label>
                            <div className="flex items-center gap-2">
                                {term.locked ? (
                                    <div className="flex items-center gap-2 w-full justify-end">
                                        <button
                                            type="button"
                                            onClick={() => stepPaymentTerm(term.id, 'down')}
                                            className="h-6 w-6 rounded-md border border-[var(--border)] bg-transparent text-[var(--text-primary)] flex items-center justify-center hover:bg-[var(--bg-elevated)] transition-colors"
                                        >
                                            -
                                        </button>
                                        <span className="font-mono-var text-xs font-bold text-[var(--accent)] min-w-[60px] text-right">{rupiah(term.amount)}</span>
                                        <button
                                            type="button"
                                            onClick={() => stepPaymentTerm(term.id, 'up')}
                                            className="h-6 w-6 rounded-md bg-[var(--accent)] text-[var(--bg-deep)] flex items-center justify-center hover:opacity-90 transition-opacity"
                                        >
                                            +
                                        </button>
                                    </div>
                                ) : (
                                    <input
                                        type="number"
                                        value={term.amount}
                                        onChange={(e) => updatePaymentTerm(term.id, 'amount', Number(e.target.value))}
                                        className="w-full bg-transparent border-b border-[var(--border)] p-0 pb-1 text-sm text-right text-[var(--text-primary)] font-mono-var focus:border-[var(--accent)] outline-none"
                                    />
                                )}
                            </div>
                        </div>

                        <div className="w-6 flex justify-end">
                            {!term.locked ? (
                                <button
                                    onClick={() => removePaymentTerm(term.id)}
                                    className="h-6 w-6 flex items-center justify-center text-[var(--text-muted)] hover:text-red-500 transition-all"
                                >
                                    <X size={14} />
                                </button>
                            ) : (
                                <div className="h-1 w-1 rounded-full bg-[var(--border)]" title="System Locked"></div>
                            )}
                        </div>
                    </div>
                ))}

                {/* Quick Actions Card */}
                <div className="flex flex-col gap-2 p-1">
                    <button
                        onClick={addPaymentTerm}
                        disabled={paymentTerms.length >= 6}
                        className="flex-1 h-full min-h-[64px] flex flex-col items-center justify-center border border-dashed border-[var(--border)] text-[var(--text-muted)] rounded-2xl hover:border-[var(--accent)]/40 hover:text-[var(--accent)] hover:bg-[var(--accent)]/[0.02] transition-all disabled:opacity-30 group"
                    >
                        <Plus size={16} className="mb-1 group-hover:scale-110 transition-transform" />
                        <span className="text-[8px] font-black uppercase tracking-[0.2em]">Add Milestone</span>
                    </button>
                    {remaining > 0 && (
                        <button
                            onClick={fillRemaining}
                            className="h-10 flex items-center justify-center text-[8px] font-black uppercase tracking-[0.2em] bg-[var(--accent)]/5 border border-[var(--accent)]/20 text-[var(--accent)] rounded-xl hover:bg-[var(--accent)]/10 hover:border-[var(--accent)]/40 transition-all font-sans"
                        >
                            Allocate Remaining Balance
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
