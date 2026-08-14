import { useEffect, useMemo, useState } from 'react';
import { fetchProofObjectUrl } from '../lib/api';

function isInlineSource(value: string): boolean {
    return value.startsWith('data:') || value.startsWith('blob:');
}

/**
 * Resolve protected proof filenames into short-lived browser object URLs.
 * The URLs are revoked whenever the list changes or the component unmounts.
 */
export function useAuthenticatedProofUrls(proofs: string[]): Record<string, string> {
    const [resolved, setResolved] = useState<Record<string, string>>({});
    const proofKey = proofs.join('\u0000');
    const uniqueProofs = useMemo(() => [...new Set(proofs)].filter(Boolean), [proofs]);
    const inlineUrls = useMemo(() => Object.fromEntries(uniqueProofs
        .filter(isInlineSource)
        .map((proof) => [proof, proof])), [uniqueProofs]);

    useEffect(() => {
        let cancelled = false;
        const createdUrls: string[] = [];

        void Promise.all(uniqueProofs
            .filter((proof) => !isInlineSource(proof))
            .map(async (proof) => {
                try {
                    const objectUrl = await fetchProofObjectUrl(proof);
                    if (cancelled) {
                        URL.revokeObjectURL(objectUrl);
                        return null;
                    }
                    createdUrls.push(objectUrl);
                    return [proof, objectUrl] as const;
                } catch {
                    return null;
                }
            }))
            .then((entries) => {
                if (cancelled) return;
                setResolved((current) => ({
                    ...current,
                    ...Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)),
                }));
            });

        return () => {
            cancelled = true;
            createdUrls.forEach((url) => URL.revokeObjectURL(url));
        };
        // The content, not the array identity, determines which assets load.
    }, [proofKey, uniqueProofs]);

    const remoteUrls = Object.fromEntries(uniqueProofs
        .filter((proof) => resolved[proof])
        .map((proof) => [proof, resolved[proof]]));
    return { ...inlineUrls, ...remoteUrls };
}
