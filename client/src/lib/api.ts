const API_PREFIX = '/api';
const UPLOAD_PREFIX = '/uploads';

let accessToken: string | null = null;
let refreshToken: string | null = null;
let tokenExpiresAt = 0;
let refreshingPromise: Promise<boolean> | null = null;

type RefreshResponse = {
    accessToken: string;
    refreshToken: string;
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
    accessToken = localStorage.getItem('orbit_access_token');
    refreshToken = localStorage.getItem('orbit_refresh_token');
    tokenExpiresAt = Number.parseInt(localStorage.getItem('orbit_token_expires') || '0', 10);
}

export function saveAuthTokens(access: string, refresh: string, expiresIn: number): void {
    accessToken = access;
    refreshToken = refresh;
    tokenExpiresAt = Date.now() + (expiresIn * 1000) - 60_000;

    localStorage.setItem('orbit_access_token', access);
    localStorage.setItem('orbit_refresh_token', refresh);
    localStorage.setItem('orbit_token_expires', String(tokenExpiresAt));
}

export function getRefreshToken(): string | null {
    if (!refreshToken) loadAuthTokens();
    return refreshToken;
}

export function hasAccessToken(): boolean {
    if (!accessToken) loadAuthTokens();
    return Boolean(accessToken);
}

export function clearAuthTokens(): void {
    accessToken = null;
    refreshToken = null;
    tokenExpiresAt = 0;

    localStorage.removeItem('orbit_access_token');
    localStorage.removeItem('orbit_refresh_token');
    localStorage.removeItem('orbit_token_expires');
    localStorage.removeItem('orbit_user');
    localStorage.removeItem('isAuthenticated');
}

export function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(apiUrl(path), options);
}

async function refreshAccessToken(): Promise<boolean> {
    // Another tab may have rotated the token already. Sync from storage
    // before consuming a refresh token so normal multi-tab usage survives.
    loadAuthTokens();
    if (!refreshToken) return false;
    if (refreshingPromise) return refreshingPromise;

    refreshingPromise = (async () => {
        try {
            const response = await apiFetch('/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken }),
            });

            if (!response.ok) {
                clearAuthTokens();
                return false;
            }

            const data = await response.json() as RefreshResponse;
            accessToken = data.accessToken;
            refreshToken = data.refreshToken;
            tokenExpiresAt = Date.now() + (data.expiresIn * 1000) - 60_000;
            localStorage.setItem('orbit_access_token', data.accessToken);
            localStorage.setItem('orbit_refresh_token', data.refreshToken);
            localStorage.setItem('orbit_token_expires', String(tokenExpiresAt));

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

async function getValidToken(): Promise<string | null> {
    if (!accessToken) loadAuthTokens();
    if (tokenExpiresAt < Date.now()) {
        const refreshed = await refreshAccessToken();
        if (!refreshed) return null;
    }
    return accessToken;
}

function authHeaders(options: RequestInit, token: string): Headers {
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }
    return headers;
}

async function fetchAuthenticated(url: string, options: RequestInit = {}): Promise<Response> {
    const token = await getValidToken();
    if (!token) throw new Error('Not authenticated');

    const response = await fetch(url, { ...options, headers: authHeaders(options, token) });
    if (response.status !== 401) return response;

    if (!(await refreshAccessToken()) || !accessToken) {
        clearAuthTokens();
        window.dispatchEvent(new Event('orbit:auth-failed'));
        throw new Error('Session expired');
    }

    return fetch(url, { ...options, headers: authHeaders(options, accessToken) });
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
