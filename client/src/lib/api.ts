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

export async function fetchProofDataUrl(filename: string): Promise<string> {
    const response = await fetchAuthenticated(proofUrl(filename));
    if (!response.ok) throw new Error(`Failed to load proof (${response.status})`);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read proof'));
        reader.readAsDataURL(blob);
    });
}

export async function resolveProofDataUrls(proofs: string[]): Promise<string[]> {
    return Promise.all(proofs.map((proof) => {
        if (proof.startsWith('data:') || proof.startsWith('blob:')) return proof;
        return fetchProofDataUrl(proof);
    }));
}
