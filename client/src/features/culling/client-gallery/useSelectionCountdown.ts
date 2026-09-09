import { useEffect, useMemo, useState } from 'react';

export function useSelectionCountdown(deadlineAt?: string | null, serverTime?: string) {
    const [clientNow, setClientNow] = useState(() => Date.now());
    const serverOffset = useMemo(() => {
        const parsedServerTime = serverTime ? Date.parse(serverTime) : Number.NaN;
        // eslint-disable-next-line react-hooks/purity -- Calibrate once whenever fresh server time arrives.
        return Number.isFinite(parsedServerTime) ? parsedServerTime - Date.now() : 0;
    }, [serverTime]);
    const deadline = deadlineAt ? Date.parse(deadlineAt) : Number.NaN;

    useEffect(() => {
        if (!Number.isFinite(deadline)) return;
        const timer = window.setInterval(() => setClientNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [deadline]);

    const remainingMs = Number.isFinite(deadline) ? Math.max(0, deadline - (clientNow + serverOffset)) : null;
    const totalSeconds = Math.floor((remainingMs ?? 0) / 1000);
    return {
        isExpired: remainingMs !== null && remainingMs <= 0,
        remainingMs,
        days: Math.floor(totalSeconds / 86_400),
        hours: Math.floor((totalSeconds % 86_400) / 3_600),
        minutes: Math.floor((totalSeconds % 3_600) / 60),
        seconds: totalSeconds % 60,
    };
}
