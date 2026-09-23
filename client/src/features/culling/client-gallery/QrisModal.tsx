import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, QrCode, X, Sparkles } from 'lucide-react';
import { checkPaymentStatus, simulatePaymentSuccess, type QrisPaymentResponse } from '../culling.public';
import { idrFormat } from './constants';

interface QrisModalProps {
    payment: QrisPaymentResponse;
    onPaymentSuccess: () => void;
    onClose: () => void;
}

export function QrisModal({ payment, onPaymentSuccess, onClose }: QrisModalProps) {
    const [status, setStatus] = useState<string>('pending');
    const [timeLeftSeconds, setTimeLeftSeconds] = useState<number>(15 * 60); // 15 mins default
    const [isSimulating, setIsSimulating] = useState(false);
    const [isPolling, setIsPolling] = useState(true);

    const isSuccess = status === 'settlement' || status === 'capture';
    const isExpired = status === 'expire' || timeLeftSeconds <= 0;

    // Countdown timer
    useEffect(() => {
        if (isSuccess || isExpired) return;

        const countdown = setInterval(() => {
            setTimeLeftSeconds((prev) => {
                if (prev <= 1) {
                    clearInterval(countdown);
                    setStatus('expire');
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(countdown);
    }, [isSuccess, isExpired]);

    // Polling status
    useEffect(() => {
        if (!isPolling || isSuccess || isExpired) return;

        const pollStatus = async () => {
            try {
                const res = await checkPaymentStatus(payment.orderId);
                if (res.status === 'settlement' || res.status === 'capture') {
                    setStatus('settlement');
                    setIsPolling(false);
                    onPaymentSuccess();
                } else if (res.status === 'expire' || res.status === 'cancel') {
                    setStatus(res.status);
                    setIsPolling(false);
                }
            } catch (err) {
                console.warn('Payment status poll failed:', err);
            }
        };

        const interval = setInterval(pollStatus, 2500);
        return () => clearInterval(interval);
    }, [isPolling, isSuccess, isExpired, payment.orderId, onPaymentSuccess]);

    const handleSimulate = async () => {
        try {
            setIsSimulating(true);
            await simulatePaymentSuccess(payment.orderId);
            setStatus('settlement');
            setIsPolling(false);
            onPaymentSuccess();
        } catch (err) {
            console.error('Simulation failed:', err);
        } finally {
            setIsSimulating(false);
        }
    };

    const formatTimer = (secs: number) => {
        const m = Math.floor(secs / 60).toString().padStart(2, '0');
        const s = (secs % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    return (
        <div
            className="fixed inset-0 z-[140] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="QRIS Payment Modal"
        >
            <div className="relative w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-2xl text-[var(--text-primary)]">
                {/* Header */}
                <div className="flex items-start justify-between border-b border-[var(--border)] pb-4">
                    <div>
                        <div className="flex items-center gap-1.5 text-[var(--accent)] font-bold text-xs uppercase tracking-wider">
                            <QrCode size={16} />
                            <span>QRIS Dynamic Payment</span>
                        </div>
                        <h3 className="mt-1 font-display text-lg font-medium">Tambah +{payment.requestedCount} Foto</h3>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg p-1 text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-white transition-colors"
                        aria-label="Close payment modal"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div className="py-5 text-center">
                    {isSuccess ? (
                        <div className="py-6 space-y-4">
                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-in zoom-in-75">
                                <CheckCircle2 size={36} />
                            </div>
                            <h4 className="font-display text-xl text-white">Pembayaran Diterima!</h4>
                            <p className="text-xs text-[var(--text-muted)] max-w-xs mx-auto leading-relaxed">
                                Kuota foto Anda telah otomatis bertambah <strong className="text-white">+{payment.requestedCount} foto</strong>. Anda bisa langsung melanjutkan seleksi foto favorit.
                            </p>
                            <button
                                type="button"
                                onClick={onClose}
                                className="w-full h-11 rounded-xl bg-[var(--accent)] text-black text-xs font-bold uppercase tracking-wider hover:opacity-90 transition-all"
                            >
                                Lanjut Pilih Foto
                            </button>
                        </div>
                    ) : isExpired ? (
                        <div className="py-6 space-y-3">
                            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30">
                                <Clock size={28} />
                            </div>
                            <h4 className="text-base font-semibold text-rose-300">Waktu Pembayaran Habis</h4>
                            <p className="text-xs text-[var(--text-muted)]">QR Code telah kedaluwarsa. Silakan buat ulang pembayaran jika ingin melanjutkan.</p>
                            <button
                                type="button"
                                onClick={onClose}
                                className="w-full h-10 rounded-xl border border-[var(--border)] text-xs font-semibold uppercase hover:bg-[var(--bg-elevated)]"
                            >
                                Tutup
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Amount & Timer */}
                            <div className="flex items-center justify-between rounded-xl bg-[var(--bg-deep)] px-4 py-2.5 border border-[var(--border)]">
                                <div className="text-left">
                                    <span className="text-[10px] uppercase font-bold text-[var(--text-muted)]">Total Bayar</span>
                                    <p className="text-base font-bold text-[var(--accent)] tabular-nums">{idrFormat.format(payment.grossAmount)}</p>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-300 bg-neutral-900 px-2.5 py-1 rounded-lg border border-neutral-700">
                                    <Clock size={12} className="text-amber-400" />
                                    <span className="tabular-nums">{formatTimer(timeLeftSeconds)}</span>
                                </div>
                            </div>

                            {/* QR Code Container */}
                            <div className="mx-auto w-56 h-56 p-3 rounded-2xl bg-white shadow-lg flex items-center justify-center border border-neutral-300 relative group">
                                {payment.qrUrl ? (
                                    <img
                                        src={payment.qrUrl}
                                        alt="QRIS Code"
                                        className="w-full h-full object-contain"
                                    />
                                ) : (
                                    <div className="text-neutral-500 text-xs text-center p-4">
                                        <Loader2 size={24} className="animate-spin mx-auto mb-2 text-neutral-700" />
                                        <span>Memuat QR Code...</span>
                                    </div>
                                )}
                            </div>

                            {/* Scan Instruction */}
                            <div className="text-xs text-[var(--text-muted)] space-y-1">
                                <p className="font-medium text-neutral-300">Scan QRIS menggunakan aplikasi:</p>
                                <p className="text-[11px] text-neutral-400">BCA, Livin Mandiri, BRImo, BNI, GoPay, OVO, ShopeePay, Dana, dll.</p>
                            </div>

                            {/* Status indicator */}
                            <div className="flex items-center justify-center gap-2 text-[11px] text-neutral-400 pt-2 border-t border-[var(--border)]">
                                <Loader2 size={13} className="animate-spin text-[var(--accent)]" />
                                <span>Menunggu pembayaran Anda...</span>
                            </div>

                            {/* Sandbox simulation test button */}
                            {payment.isSimulated && (
                                <div className="pt-2">
                                    <button
                                        type="button"
                                        disabled={isSimulating}
                                        onClick={handleSimulate}
                                        className="w-full py-2 px-3 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                                    >
                                        {isSimulating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                        <span>Simulasikan Bayar Berhasil (Sandbox Test)</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
