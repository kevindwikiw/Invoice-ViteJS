const API_PREFIX = '/api';
const UPLOAD_PREFIX = '/uploads';

let refreshingPromise: Promise<boolean> | null = null;

type RefreshResponse = {
    expiresIn: number;
    user?: unknown;
};

export function apiUrl(path: string): string {
    return `${API_PREFIX}${path.startsWith('/') ? path : `/${path}`}`;
}

export function uploadUrl(path: string): string {
    const normalized = path
        .split('/')
        .filter(Boolean)
        .map(encodeURIComponent)
        .join('/');
    return `${UPLOAD_PREFIX}/${normalized}`;
}

export function proofUrl(filename: string): string {
    return uploadUrl(`proofs/${filename}`);
}

export function loadAuthTokens(): void {
    localStorage.removeItem('orbit_access_token');
    localStorage.removeItem('orbit_refresh_token');
    localStorage.removeItem('orbit_token_expires');
}

export function saveAuthTokens(): void {
    loadAuthTokens();
}

export function getRefreshToken(): string | null {
    return null;
}

export function hasAccessToken(): boolean {
    loadAuthTokens();
    return Boolean(localStorage.getItem('orbit_user'));
}

export function clearAuthTokens(): void {
    localStorage.removeItem('orbit_access_token');
    localStorage.removeItem('orbit_refresh_token');
    localStorage.removeItem('orbit_token_expires');
    localStorage.removeItem('orbit_user');
    localStorage.removeItem('isAuthenticated');
}

export function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(apiUrl(path), { credentials: 'same-origin', ...options });
}

async function refreshAccessToken(): Promise<boolean> {
    if (refreshingPromise) return refreshingPromise;

    refreshingPromise = (async () => {
        try {
            const response = await apiFetch('/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });

            if (!response.ok) {
                clearAuthTokens();
                return false;
            }

            const data = await response.json() as RefreshResponse;
            if (data.user) localStorage.setItem('orbit_user', JSON.stringify(data.user));
            window.dispatchEvent(new CustomEvent('orbit:token-refreshed', { detail: data.user ?? null }));
            return true;
        } catch {
            clearAuthTokens();
            return false;
        } finally {
            refreshingPromise = null;
        }
    })();

    return refreshingPromise;
}

function authHeaders(options: RequestInit): Headers {
    const headers = new Headers(options.headers);
    if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    return headers;
}

async function fetchAuthenticated(url: string, options: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, { ...options, credentials: 'same-origin', headers: authHeaders(options) });
    if (response.status !== 401) return response;

    if (!(await refreshAccessToken())) {
        clearAuthTokens();
        window.dispatchEvent(new Event('orbit:auth-failed'));
        throw new Error('Session expired');
    }

    return fetch(url, { ...options, credentials: 'same-origin', headers: authHeaders(options) });
}

export function fetchWithAuth(path: string, options: RequestInit = {}): Promise<Response> {
    return fetchAuthenticated(apiUrl(path), options);
}

export async function fetchProofObjectUrl(filename: string): Promise<string> {
    const response = await fetchAuthenticated(proofUrl(filename));
    if (!response.ok) throw new Error(`Failed to load proof (${response.status})`);
    return URL.createObjectURL(await response.blob());
}

function proofSourceUrl(source: string): string {
    if (/^https?:\/\//i.test(source) || source.startsWith('/uploads/')) return source;
    return proofUrl(source);
}

async function fetchProofBlob(source: string): Promise<Blob> {
    const response = await fetchAuthenticated(proofSourceUrl(source));
    if (!response.ok) throw new Error(`Failed to load proof (${response.status})`);
    return await response.blob();
}

export async function fetchProofDataUrl(filename: string): Promise<string> {
    return await blobToDataUrl(await fetchProofBlob(filename));
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read proof'));
        reader.readAsDataURL(blob);
    });
}

function unsupportedProofSource(contentType = 'unknown'): string {
    return `unsupported:${contentType || 'unknown'}`;
}

function isPdfCompatibleImage(contentType: string): boolean {
    return contentType === 'image/jpeg' || contentType === 'image/jpg' || contentType === 'image/png';
}

function loadBrowserImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Failed to decode payment proof image'));
        image.src = url;
    });
}

async function convertImageBlobForPdf(blob: Blob): Promise<string> {
    if (isPdfCompatibleImage(blob.type)) return await blobToDataUrl(blob);
    if (!blob.type.startsWith('image/')) return unsupportedProofSource(blob.type);

    const objectUrl = URL.createObjectURL(blob);
    try {
        const image = await loadBrowserImage(objectUrl);
        const maxDimension = 2400;
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas is unavailable');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        return canvas.toDataURL('image/jpeg', 0.92);
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

async function normalizeProofForPdf(proof: string): Promise<string> {
    if (proof.startsWith('unsupported:')) return proof;
    if (proof.startsWith('data:') || proof.startsWith('blob:')) {
        return await convertImageBlobForPdf(await fetch(proof).then((response) => response.blob()));
    }
    return await convertImageBlobForPdf(await fetchProofBlob(proof));
}

export function parsePaymentProofs(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.flatMap((proof) => parsePaymentProofs(proof));
    }
    if (value && typeof value === 'object') {
        const proof = value as Record<string, unknown>;
        const dataUrl = proof.dataUrl ?? proof.data_url;
        if (typeof dataUrl === 'string') return parsePaymentProofs(dataUrl);

        const base64 = proof.base64 ?? proof.b64;
        if (typeof base64 !== 'string' || !base64.trim()) return [];
        const encoded = base64.trim();
        return [encoded.startsWith('data:') ? encoded : `data:image/jpeg;base64,${encoded}`];
    }
    if (typeof value !== 'string') return [];

    const proof = value.trim();
    if (!proof) return [];
    if (proof.startsWith('[') || proof.startsWith('{') || (proof.startsWith('"') && proof.endsWith('"'))) {
        try {
            return parsePaymentProofs(JSON.parse(proof));
        } catch {
            return [];
        }
    }
    return [proof];
}

export async function resolveProofDataUrls(proofs: string[]): Promise<string[]> {
    const resolved = await Promise.all(proofs.map(async (proof) => {
        try {
            return await normalizeProofForPdf(proof);
        } catch {
            const contentType = proof.match(/^data:([^;,]+)/)?.[1] || 'unavailable';
            return unsupportedProofSource(contentType);
        }
    }));
    return resolved;
}
