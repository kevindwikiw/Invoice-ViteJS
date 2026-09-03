// File: src/features/culling/culling.admin.ts

import { fetchWithAuth } from '../../lib/api';
import { parseError } from './culling.public';
import type { 
    GallerySummary, 
    GalleryListResponse, 
    GalleryDetail, 
    GalleryStatus, 
    AddonPricingMode, 
    AddonStatus, 
    Paginated, 
    AddonRequest, 
    EditPackage 
} from './culling.types';

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

export async function createGallery(input: { title: string; driveFolderUrl: string; pin: string; status: GalleryStatus; maxSelections: number; selectionDurationHours: number }): Promise<GallerySummary> {
    const response = await fetchWithAuth('/galleries', {
        method: 'POST',
        body: JSON.stringify(input),
    });
    if (!response.ok) throw await parseError(response, 'Unable to create gallery.');
    return response.json();
}

export async function updateGallery(input: { id: number; title?: string; driveFolderId?: string; driveFolderUrl?: string; pin?: string; status?: GalleryStatus; contactWhatsappUrl?: string; maxSelections?: number; selectionDurationHours?: number; additionalSelectionLimit?: number; editAddonStatus?: string; editAddonPricingMode?: string; editAddonPrice?: number; editAddonPackageId?: number | null }): Promise<void> {
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
