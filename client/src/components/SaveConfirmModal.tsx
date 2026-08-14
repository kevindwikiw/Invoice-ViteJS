import { AlertCircle } from 'lucide-react';

interface SaveConfirmModalProps {
    show: boolean;
    onClose: () => void;
    onConfirm: () => void;
}

export function SaveConfirmModal({
    show,
    onClose,
    onConfirm
}: SaveConfirmModalProps) {
    if (!show) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200">
                <div className="flex items-center gap-3 mb-4 text-[var(--accent)]">
                    <div className="p-2 bg-[var(--accent)]/10 rounded-full">
                        <AlertCircle size={24} />
                    </div>
                    <h3 className="font-bold text-lg text-[var(--text-primary)] font-display">Update Defaults?</h3>
                </div>
                <p className="text-[var(--text-muted)] mb-6 text-sm leading-relaxed">
                    Are you sure you want to update the <b className="text-[var(--text-primary)]">global default configuration</b>? This will affect all future invoices on all devices.
                </p>
                <div className="flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] rounded-lg text-sm font-medium transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 bg-[var(--accent)] text-[var(--bg-deep)] rounded-lg text-sm font-bold hover:brightness-110 transition-colors"
                    >
                        Yes, Update Defaults
                    </button>
                </div>
            </div>
        </div>
    );
}
