import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, Sparkles } from 'lucide-react';
import { checkPaymentStatus, simulatePaymentSuccess, type QrisPaymentResponse } from '../culling.public';
import { BLACK_THEME, WHITE_THEME, idrFormat } from './constants';
import type { GalleryTheme } from './types';
import { GalleryModal } from '../../../components/GalleryModal';

interface QrisModalProps {
    theme: GalleryTheme;
    payment: QrisPaymentResponse;
    onPaymentSuccess: () => void;
    onClose: () => void;
}

export function QrisModal({ theme, payment, onPaymentSuccess, onClose }: QrisModalProps) {
    const [status, setStatus] = useState<string>('pending');
    const [timeLeftSeconds, setTimeLeftSeconds] = useState<number>(15 * 60); // 15 mins default
    const [isSimulating, setIsSimulating] = useState(false);
    const [isPolling, setIsPolling] = useState(true);
    const [qrImageFailed, setQrImageFailed] = useState(false);

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
        <GalleryModal title="QRIS Payment" close={onClose} style={theme === 'black' ? BLACK_THEME : WHITE_THEME} widthClass="max-w-sm" layerClass="z-[140]">
            <div className="text-[var(--text-primary)]">
                <p className="text-sm font-medium">Add {payment.requestedCount} Photos</p>
                {/* Content */}
                <div className="py-5 text-center">
                    {isSuccess ? (
                        <div className="py-6 space-y-4">
                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                                <CheckCircle2 size={36} aria-hidden="true" />
                            </div>
                            <h3 className="font-display text-xl">Payment Received</h3>
                            <p className="text-xs text-[var(--text-muted)] max-w-xs mx-auto leading-relaxed">
                                Your selection limit increased by <strong className="text-[var(--text-primary)]">{payment.requestedCount} photos</strong>. You can continue choosing favorites.
                            </p>
                            <button
                                type="button"
                                onClick={onClose}
                                className="h-11 w-full rounded-md bg-[var(--accent)] text-sm font-semibold text-[var(--bg-deep)] transition-opacity hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                            >
                                Continue Selecting
                            </button>
                        </div>
                    ) : isExpired ? (
                        <div className="py-6 space-y-3">
                            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--text-primary)]">
                                <Clock size={28} aria-hidden="true" />
                            </div>
                            <h3 className="text-base font-semibold">Payment Time Expired</h3>
                            <p className="text-xs text-[var(--text-secondary)]">This QR code has expired. Close it and request a new payment to continue.</p>
                            <button
                                type="button"
                                onClick={onClose}
                                className="h-11 w-full rounded-md border border-[var(--border)] text-sm font-semibold hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                            >
                                Close
                            </button>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Amount & Timer */}
                            <div className="flex items-center justify-between rounded-xl bg-[var(--bg-deep)] px-4 py-2.5 border border-[var(--border)]">
                                <div className="text-left">
                                    <span className="text-[10px] font-semibold text-[var(--text-muted)]">Amount due</span>
                                    <p className="text-base font-bold text-[var(--accent)] tabular-nums">{idrFormat.format(payment.grossAmount)}</p>
                                </div>
                                <div className="flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--text-primary)]">
                                    <Clock size={12} aria-hidden="true" />
                                    <span className="tabular-nums">{formatTimer(timeLeftSeconds)}</span>
                                </div>
                            </div>

                            {/* QR Code Container */}
                            <div className="mx-auto w-56 h-56 p-3 rounded-2xl bg-white shadow-lg flex items-center justify-center border border-neutral-300 relative group">
                                {payment.qrUrl && !qrImageFailed ? (
                                    <img
                                        src={payment.qrUrl}
                                        alt="QRIS payment code"
                                        width={224}
                                        height={224}
                                        className="w-full h-full object-contain"
                                        onError={() => setQrImageFailed(true)}
                                    />
                                ) : (
                                    <div role="alert" className="p-3 text-center text-xs leading-5 text-neutral-700">
                                        QR code unavailable. Close this window and try Pay via QRIS again.
                                    </div>
                                )}
                            </div>

                            {/* Scan Instruction */}
                            <div className="text-xs text-[var(--text-muted)] space-y-1">
                                <p className="font-medium text-[var(--text-primary)]">Scan with your payment app</p>
                                <p className="text-xs text-[var(--text-secondary)]">BCA, Livin' by Mandiri, BRImo, BNI, GoPay, OVO, ShopeePay, or DANA.</p>
                            </div>

                            {/* Status indicator */}
                            <div role="status" className="flex items-center justify-center gap-2 border-t border-[var(--border)] pt-2 text-xs text-[var(--text-secondary)]">
                                <Loader2 size={13} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
                                <span>Waiting for payment…</span>
                            </div>

                            {/* Sandbox simulation test button */}
                            {payment.isSimulated && (
                                <div className="pt-2">
                                    <button
                                        type="button"
                                        disabled={isSimulating}
                                        onClick={handleSimulate}
                                        className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md border border-[var(--border)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-50"
                                    >
                                        {isSimulating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                        <span>Simulate Payment (Sandbox)</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </GalleryModal>
    );
}
