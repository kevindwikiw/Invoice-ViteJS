import { useCallback, useEffect, useState } from 'react';

type StartupSession = { submittedAt: number | null; authenticatedAt: number };

export function useGalleryStartup({ initialSession, dataReady, hasSamples, needsTutorial }: {
    initialSession: boolean;
    dataReady: boolean;
    hasSamples: boolean | undefined;
    needsTutorial: boolean;
}) {
    const [session, setSession] = useState<StartupSession | null>(() => initialSession ? { submittedAt: null, authenticatedAt: Date.now() } : null);
    const [media, setMedia] = useState<'pending' | 'ready' | 'failed'>('pending');
    const [expired, setExpired] = useState(false);
    const [minimumElapsed, setMinimumElapsed] = useState(initialSession);
    const [leaving, setLeaving] = useState(false);
    const [textOnly, setTextOnly] = useState(false);
    const start = useCallback((submittedAt: number) => {
        setMedia('pending');
        setExpired(false);
        setMinimumElapsed(false);
        setLeaving(false);
        setTextOnly(false);
        setSession({ submittedAt, authenticatedAt: Date.now() });
    }, []);
    const cancel = useCallback(() => { setSession(null); setLeaving(false); }, []);
    const onMediaSettled = useCallback((result: 'ready' | 'failed') => setMedia(result), []);

    useEffect(() => {
        if (!session) return;
        const minimum = window.setTimeout(() => setMinimumElapsed(true), session.submittedAt === null ? 0 : Math.max(0, session.submittedAt + 2000 - Date.now()));
        const deadline = window.setTimeout(() => setExpired(true), Math.max(0, session.authenticatedAt + 5000 - Date.now()));
        return () => { window.clearTimeout(minimum); window.clearTimeout(deadline); };
    }, [session]);

    // Freeze the destination before the exit begins, including late media results.
    if (session && !leaving) {
        if (!textOnly && needsTutorial && ((expired && media !== 'ready') || media === 'failed' || hasSamples === false)) setTextOnly(true);
        const tutorialReady = !needsTutorial || hasSamples === false || media !== 'pending' || expired;
        if (dataReady && minimumElapsed && tutorialReady) setLeaving(true);
    }

    useEffect(() => {
        if (!leaving) return;
        const timer = window.setTimeout(() => { setSession(null); setLeaving(false); }, 200);
        return () => window.clearTimeout(timer);
    }, [leaving]);

    return { preparing: session !== null, leaving, textOnly, start, cancel, onMediaSettled };
}
