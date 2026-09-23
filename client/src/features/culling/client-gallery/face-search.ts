import { apiFetch } from '../../../lib/api';
import { parseError } from '../culling.public';
import type { GalleryPhoto } from '../culling.types';
import { prepareSelfie } from './prepare-selfie';

export type FaceSearchSensitivity = 'strict' | 'balanced' | 'wide';

export type FaceSearchProgress = {
    phase: 'worker' | 'complete';
    processed: number;
    total: number;
    matches: number;
};

export type FaceSearchStatus = {
    available: boolean;
    status: 'not_indexed' | 'indexing' | 'ready' | 'failed' | 'unavailable';
    processed: number;
    total: number;
    code?: string;
};

export type FaceSearchResult = {
    status: 'complete';
    matches: Array<{ photo: GalleryPhoto; distance: number }>;
    total: number;
} | {
    status: 'indexing';
    matches: [];
    total: number;
    job: { processed: number; total: number } | null;
};

type FaceSearchInput = {
    galleryId: string;
    token: string;
    selfieFile: File;
    sensitivity: FaceSearchSensitivity;
    onProgress?: (progress: FaceSearchProgress) => void;
    signal?: AbortSignal;
};

type FaceSearchTestHook = (input: FaceSearchInput) => Promise<FaceSearchResult>;

declare global {
    interface Window {
        __ORBIT_FACE_SEARCH_TEST__?: FaceSearchTestHook;
    }
}

export async function getFaceSearchStatus(galleryId: string, token: string, signal?: AbortSignal): Promise<FaceSearchStatus> {
    const response = await apiFetch(`/public/galleries/${encodeURIComponent(galleryId)}/face-search/status`, {
        headers: { 'x-gallery-token': token },
        signal,
    });
    if (!response.ok) throw await parseError(response, 'Unable to check face search availability.');
    return response.json();
}

export async function runFaceSearch(input: FaceSearchInput): Promise<FaceSearchResult> {
    const testHook = typeof window !== 'undefined' ? window.__ORBIT_FACE_SEARCH_TEST__ : undefined;
    if (testHook) return testHook(input);

    const body = new FormData();
    body.append('selfie', await prepareSelfie(input.selfieFile, input.signal), 'selfie.jpg');
    body.append('sensitivity', input.sensitivity);
    const response = await apiFetch(`/public/galleries/${encodeURIComponent(input.galleryId)}/face-search`, {
        method: 'POST',
        headers: { 'x-gallery-token': input.token },
        body,
        signal: input.signal,
    });

    if (response.status === 202) {
        const payload = await response.json() as {
            status: 'indexing';
            job?: { processed?: number; total?: number } | null;
            total?: number;
        };
        const job = payload.job ? {
            processed: Number(payload.job.processed || 0),
            total: Number(payload.job.total || 0),
        } : null;
        input.onProgress?.({ phase: 'worker', processed: job?.processed || 0, total: job?.total || 0, matches: 0 });
        return { status: 'indexing', matches: [], total: Number(payload.total || job?.total || 0), job };
    }
    if (!response.ok) throw await parseError(response, 'Unable to search faces.');

    const payload = await response.json() as { status: 'complete'; matches?: GalleryPhoto[]; total?: number };
    const matches = Array.isArray(payload.matches) ? payload.matches.map((photo) => ({ photo, distance: 0 })) : [];
    const total = Number(payload.total || matches.length);
    input.onProgress?.({ phase: 'complete', processed: total, total, matches: matches.length });
    return { status: 'complete', matches, total };
}
