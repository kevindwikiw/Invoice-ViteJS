import { apiFetch, apiUrl, fetchWithAuth } from '../../lib/api';

export type GalleryStatus = 'draft' | 'open' | 'closed';

export interface GallerySummary {
    id: number;
    publicKey?: string | null;
    title: string;
    driveFolderId: string;
    status: GalleryStatus;
    createdAt: string;
    updatedAt: string;
    syncedAt?: string | null;
    photoCount: number;
    selectionCount: number;
    contactWhatsappUrl?: string | null;
    maxSelections?: number;
    additionalLimit?: number;
    addon?: { enabled: boolean; additionalLimit: number; pricingMode?: string | null; unitPrice?: number | null; status?: string };
    addonStatus?: string;
}

export interface GalleryPhoto {
    id: number;
    galleryId: number;
    driveFileId: string;
    filename: string;
    mimeType: string;
    width?: number | null;
    height?: number | null;
    displayOrder: number;
    createdAt: string;
    photoToken?: string;
}

export interface GallerySelection {
    id: number;
    galleryId: number;
    selectedDriveFileId: string;
    selectedFilename: string;
    note?: string | null;
    submittedAt: string;
}

export interface GalleryDetail {
    gallery: GallerySummary;
    photos: GalleryPhoto[];
    selections: GallerySelection[];
}

export interface GalleryListResponse {
    items: GallerySummary[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
}

export type AddonStatus = 'none' | 'pending' | 'quoted' | 'approved' | 'paid' | 'completed' | 'cancelled';
export type AddonPricingMode = 'per_photo' | 'package';
export interface EditPackage { id: number; name: string; includedPhotoCount: number; price: number; active: boolean; createdAt: string; updatedAt: string; }
export interface AddonRequest { id: number; galleryId: number; galleryTitle: string; requestedAdditionalCount: number; pricingMode: AddonPricingMode; packageId?: number | null; unitPrice?: number | null; quotedTotal?: number | null; status: AddonStatus; clientNote?: string | null; adminNote?: string | null; createdAt: string; updatedAt?: string; }
export interface Paginated<T> { items?: T[]; packages?: T[]; requests?: T[]; page: number; pageSize: number; total: number; totalPages: number; }

export interface PublicGallery {
    id: number;
    title: string;
    status: GalleryStatus;
    syncedAt?: string | null;
    maxSelections?: number;
    additionalLimit?: number;
    addon?: { enabled: boolean; additionalLimit: number; pricingMode?: string | null; unitPrice?: number | null; status?: string };
}

export interface PublicGalleryPhotos {
    gallery: PublicGallery;
    photos: GalleryPhoto[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    selectedDriveFileIds: string[];
    selectedPhotos: Array<GalleryPhoto & { note?: string | null }>;
}

export function calculateAddonQuote(count: number, unitPrice: number) {
    const discountPercent = count === 10 ? 10 : count === 20 ? 20 : 0;
    const normalTotal = count * unitPrice;
    const total = Math.round(normalTotal * (1 - discountPercent / 100));
    return { discountPercent, normalTotal, total, savings: normalTotal - total };
}

class GalleryApiError extends Error {
    code?: string;
    contactUrl?: string | null;
    status?: number;
}

async function parseError(response: Response, fallback: string): Promise<Error> {
    const data = await response.json().catch(() => null) as { error?: string; code?: string; contactUrl?: string | null } | null;
    const error = new GalleryApiError(data?.error || fallback);
    error.code = data?.code;
    error.contactUrl = data?.contactUrl;
    error.status = response.status;
    return error;
}

export async function listGalleries(input: { page?: number; pageSize?: number; status?: 'all' | GalleryStatus; search?: string } = {}): Promise<GalleryListResponse> {
    const params = new URLSearchParams({
        page: String(input.page || 1),
        pageSize: String(input.pageSize || 10),
    });
    if (input.status && input.status !== 'all') params.set('status', input.status);
    if (input.search?.trim()) params.set('search', input.search.trim());
    const response = await fetchWithAuth(`/galleries?${params.toString()}`);
    if (!response.ok) throw await parseError(response, 'Unable to load galleries.');
    const data = await response.json() as GallerySummary[] | GalleryListResponse;
    return Array.isArray(data) ? { items: data, page: 1, pageSize: data.length || 10, total: data.length, totalPages: 1 } : data;
}

export async function getGalleryContact(): Promise<{ contactWhatsappUrl: string; message: string; requestMoreMessage?: string }> {
    const response = await fetchWithAuth('/galleries/settings/contact');
    if (!response.ok) throw await parseError(response, 'Unable to load gallery settings.');
    return await response.json();
}

export async function saveGalleryContact(input: { contactWhatsappUrl: string; message: string; requestMoreMessage?: string }): Promise<void> {
    const response = await fetchWithAuth('/galleries/settings/contact', { method: 'PATCH', body: JSON.stringify(input) });
    if (!response.ok) throw await parseError(response, 'Unable to save gallery settings.');
}

export async function createGallery(input: { title: string; driveFolderUrl: string; pin: string; status: GalleryStatus; maxSelections: number }): Promise<GallerySummary> {
    const response = await fetchWithAuth('/galleries', {
        method: 'POST',
        body: JSON.stringify(input),
    });
    if (!response.ok) throw await parseError(response, 'Unable to create gallery.');
    return response.json();
}

export async function updateGallery(input: { id: number; title?: string; driveFolderId?: string; driveFolderUrl?: string; pin?: string; status?: GalleryStatus; contactWhatsappUrl?: string; maxSelections?: number; additionalSelectionLimit?: number; editAddonStatus?: string; editAddonPricingMode?: string; editAddonPrice?: number; editAddonPackageId?: number | null }): Promise<void> {
    const { id, ...body } = input;
    const response = await fetchWithAuth(`/galleries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
    if (!response.ok) throw await parseError(response, 'Unable to update gallery.');
}

export async function listAddonRequests(page = 1, pageSize = 10): Promise<Paginated<AddonRequest>> {
    const response = await fetchWithAuth(`/galleries/addon-requests?page=${page}&pageSize=${pageSize}`);
    if (!response.ok) throw await parseError(response, 'Unable to load add-on requests.');
    return response.json();
}

export async function listEditPackages(page = 1, pageSize = 10): Promise<Paginated<EditPackage>> {
    const response = await fetchWithAuth(`/galleries/packages?page=${page}&pageSize=${pageSize}`);
    if (!response.ok) throw await parseError(response, 'Unable to load edit packages.');
    return response.json();
}

export async function createEditPackage(input: { name: string; includedPhotoCount: number; price: number }): Promise<void> {
    const response = await fetchWithAuth('/galleries/packages', { method: 'POST', body: JSON.stringify(input) });
    if (!response.ok) throw await parseError(response, 'Unable to create package.');
}

export async function updateEditPackage(input: { id: number; name?: string; includedPhotoCount?: number; price?: number; active?: boolean }): Promise<void> {
    const { id, ...body } = input;
    const response = await fetchWithAuth(`/galleries/packages/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!response.ok) throw await parseError(response, 'Unable to update package.');
}

export async function deleteEditPackage(id: number): Promise<void> {
    const response = await fetchWithAuth(`/galleries/packages/${id}`, { method: 'DELETE' });
    if (!response.ok) throw await parseError(response, 'Unable to delete package.');
}

export async function createAddonRequest(input: { galleryId: number; requestedAdditionalCount: number; pricingMode: AddonPricingMode; packageId?: number | null; unitPrice?: number | null; quotedTotal?: number | null; status?: AddonStatus; adminNote?: string }): Promise<void> {
    const { galleryId, ...body } = input;
    const response = await fetchWithAuth(`/galleries/${galleryId}/addon`, { method: 'POST', body: JSON.stringify(body) });
    if (!response.ok) throw await parseError(response, 'Unable to save add-on request.');
}

export async function updateAddonRequest(input: { id: number; requestedAdditionalCount?: number; pricingMode?: AddonPricingMode; packageId?: number | null; unitPrice?: number | null; quotedTotal?: number | null; status?: AddonStatus; adminNote?: string }): Promise<void> {
    const { id, ...body } = input;
    const response = await fetchWithAuth(`/galleries/addon-requests/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    if (!response.ok) throw await parseError(response, 'Unable to update add-on request.');
}

export async function approveAddon(galleryId: number, requestId: number): Promise<void> {
    const response = await fetchWithAuth(`/galleries/${galleryId}/addon/approve`, { method: 'POST', body: JSON.stringify({ requestId }) });
    if (!response.ok) throw await parseError(response, 'Unable to approve add-on.');
}

export async function deleteGallery(id: number): Promise<void> {
    const response = await fetchWithAuth(`/galleries/${id}`, { method: 'DELETE' });
    if (!response.ok) throw await parseError(response, 'Unable to delete gallery.');
}

export async function resetGalleryPinLock(id: number): Promise<void> {
    const response = await fetchWithAuth(`/galleries/${id}/reset-pin-lock`, { method: 'POST' });
    if (!response.ok) throw await parseError(response, 'Unable to reset PIN lock.');
}

export async function getGalleryDetail(id: number): Promise<GalleryDetail> {
    const response = await fetchWithAuth(`/galleries/${id}`);
    if (!response.ok) throw await parseError(response, 'Unable to load gallery detail.');
    return response.json();
}

export async function syncGallery(id: number): Promise<{ status: string; photoCount: number; changes?: number }> {
    const response = await fetchWithAuth(`/galleries/${id}/sync`, { method: 'POST' });
    if (!response.ok) throw await parseError(response, 'Unable to sync Google Drive folder.');
    return response.json();
}

export async function downloadGallerySelections(id: number): Promise<void> {
    const response = await fetchWithAuth(`/galleries/${id}/export.csv`);
    if (!response.ok) throw await parseError(response, 'Unable to export selections.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gallery-${id}-selections.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function downloadGallerySelectionsXlsx(id: number): Promise<void> {
    const response = await fetchWithAuth(`/galleries/${id}/export.xlsx`);
    if (!response.ok) throw await parseError(response, 'Unable to export XLSX selections.');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `gallery-${id}-selections.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function verifyGalleryPin(id: string, pin: string): Promise<{ token: string; expiresIn: number; gallery: PublicGallery }> {
    const response = await apiFetch(`/public/galleries/${id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
    });
    if (!response.ok) throw await parseError(response, 'Unable to unlock gallery.');
    return response.json();
}

export async function getPublicGalleryPhotos(id: string, token: string, page = 1, pageSize = 60, includeSelectedPhotos = false): Promise<PublicGalleryPhotos> {
    const includeSelected = includeSelectedPhotos ? '&includeSelectedPhotos=1' : '';
    const response = await apiFetch(`/public/galleries/${id}/photos?token=${encodeURIComponent(token)}&page=${page}&pageSize=${pageSize}${includeSelected}`);
    if (!response.ok) throw await parseError(response, 'Unable to load gallery photos.');
    return response.json();
}

export async function submitGallerySelections(id: string, token: string, selections: Array<{ driveFileId: string; note: string }>): Promise<{ status: string; selectionCount: number; filenames: string[] }> {
    const response = await apiFetch(`/public/galleries/${id}/selections`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-gallery-token': token,
        },
        body: JSON.stringify({ selections }),
    });
    if (!response.ok) throw await parseError(response, 'Unable to submit selections.');
    return response.json();
}

export function galleryThumbnailUrl(galleryId: string | number, driveFileId: string, token: string, photoToken?: string): string {
    const params = new URLSearchParams({ token });
    if (photoToken) params.set('pt', photoToken);
    return apiUrl(`/public/galleries/${galleryId}/photos/${encodeURIComponent(driveFileId)}/thumbnail?${params.toString()}`);
}

export function galleryContentUrl(galleryId: string | number, driveFileId: string, token: string, photoToken?: string): string {
    const params = new URLSearchParams({ token });
    if (photoToken) params.set('pt', photoToken);
    return apiUrl(`/public/galleries/${galleryId}/photos/${encodeURIComponent(driveFileId)}/content?${params.toString()}`);
}

export function galleryPreviewUrl(galleryId: string | number, driveFileId: string, token: string, photoToken?: string): string {
    const params = new URLSearchParams({ token });
    if (photoToken) params.set('pt', photoToken);
    return apiUrl(`/public/galleries/${galleryId}/photos/${encodeURIComponent(driveFileId)}/preview?${params.toString()}`);
}
