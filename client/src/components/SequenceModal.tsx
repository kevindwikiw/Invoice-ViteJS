import { X, Loader2 } from 'lucide-react';

interface SequenceModalProps {
    show: boolean;
    onClose: () => void;
    prefix: string;
    padding: number;
    lastValue: number;
    setLastValue: (val: number) => void;
    onSave: (val: number) => void;
    isPending: boolean;
}

export function SequenceModal({
    show,
    onClose,
    prefix,
    padding,
    lastValue,
    setLastValue,
    onSave,
    isPending
}: SequenceModalProps) {
    if (!show) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-sm p-6 space-y-4">
                <div className="flex justify-between items-center">
                    <h3 className="text-lg font-medium text-[var(--text-primary)] font-display">Invoice Sequence</h3>
                    <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                        <X size={20} />
                    </button>
                </div>
                <div className="space-y-2">
                    <label className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Last Used Sequence</label>
                    <div className="flex items-center gap-2">
                        <input
                            type="number"
                            value={lastValue}
                            onChange={(e) => setLastValue(Number(e.target.value))}
                            className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent)] outline-none"
                        />
                        <div className="flex gap-1">
                            <button onClick={() => setLastValue(Math.max(0, lastValue - 1))} className="p-2 bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] rounded-lg border border-[var(--border)] text-[var(--text-primary)]">-</button>
                            <button onClick={() => setLastValue(lastValue + 1)} className="p-2 bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] rounded-lg border border-[var(--border)] text-[var(--text-primary)]">+</button>
                        </div>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)]">Next invoice will be: <span className="text-[var(--accent)]">{prefix}{String(lastValue + 1).padStart(padding, '0')}_...</span></p>
                </div>
                <div className="flex gap-3 pt-2">
                    <button onClick={onClose} className="flex-1 px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors">Cancel</button>
                    <button
                        onClick={() => onSave(lastValue)}
                        disabled={isPending}
                        className="flex-1 px-4 py-2 bg-[var(--accent)] text-[var(--bg-deep)] text-sm font-bold uppercase tracking-wider rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                        {isPending ? <Loader2 className="animate-spin mx-auto" size={16} /> : "Save"}
                    </button>
                </div>
            </div>
        </div>
    );
}
