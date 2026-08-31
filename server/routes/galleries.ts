import { Hono } from "hono";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import writeExcelFile from "write-excel-file/node";
import { galleryAll, galleryBatch, galleryInsertReturningId, galleryOne, galleryRun } from "../db/galleries";
import { fetchDriveFile, getDrivePhotoMetadata, listDrivePhotos } from "../lib/google-drive";
import { resetGalleryPinAttempts } from "../middleware/rate-limit";

const adminGalleriesRouter = new Hono();
const publicGalleriesRouter = new Hono();
const GALLERY_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_ADDON_UNIT_PRICE = 10_000;
const DEFAULT_CONTACT_MESSAGE = "Halo Kak Admin Orbit\nSaya ingin meminta bantuan untuk membuka client gallery saya yaa.\n\nIni URL saya: {{gallery_url}}\nSaya client dari: {{gallery_title}}\n\nTerima kasih, Kak!";
const DEFAULT_REQUEST_MORE_MESSAGE = "Halo Kak Admin Orbit\nSaya ingin meminta tambahan edited photos.\n\nIni URL saya: {{gallery_url}}\nSaya client dari: {{gallery_title}}\nPilihan saat ini: {{selected_count}} foto\nSaya ingin menambah: {{requested_count}} foto\nPromo: {{promo_label}}\nEstimasi biaya: {{estimated_price}}";

type AuthUser = { sub: number; email: string; name: string; role: string };
type GalleryStatus = "draft" | "open" | "closed";

type GalleryRow = {
    id: number;
    title: string;
    publicKey?: string | null;
    contactWhatsappUrl?: string | null;
    maxSelections?: number;
    additionalSelectionLimit?: number;
    editAddonStatus?: string;
    editAddonPricingMode?: string | null;
    editAddonPrice?: number | null;
    driveFolderId: string;
    pinHash: string;
    accessVersion: number;
    status: GalleryStatus;
    createdAt: string;
    updatedAt: string;
    syncedAt?: string | null;
};

type PhotoRow = {
    id: number;
    galleryId: number;
    driveFileId: string;
    filename: string;
    mimeType: string;
    thumbnailUrl?: string | null;
    webViewUrl?: string | null;
    width?: number | null;
    height?: number | null;
    displayOrder: number;
    createdAt: string;
};

type SelectionRow = {
    id: number;
    galleryId: number;
    selectedDriveFileId: string;
    selectedFilename: string;
    note?: string | null;
    submittedAt: string;
};

function photoShape(row: PhotoRow & Record<string, unknown>) {
    return {
        id: Number(row.id),
        galleryId: Number(row.galleryId ?? row.gallery_id),
        driveFileId: String(row.driveFileId ?? row.drive_file_id ?? ""),
        filename: String(row.filename || ""),
        mimeType: String(row.mimeType ?? row.mime_type ?? ""),
        width: row.width == null ? null : Number(row.width),
        height: row.height == null ? null : Number(row.height),
        displayOrder: Number(row.displayOrder ?? row.display_order ?? 0),
        createdAt: String(row.createdAt ?? row.created_at ?? ""),
        ...(row.note !== undefined ? { note: row.note } : {}),
    };
}

function selectionDriveFileId(row: Record<string, unknown>): string {
    return String(row.selectedDriveFileId ?? row.selected_drive_file_id ?? "");
}

function getUser(c: any): AuthUser | undefined {
    return c.get("user") || c.get("jwtPayload");
}

function requireGalleryAdmin(c: any): Response | null {
    const user = getUser(c);
    if (!user) return c.json({ error: "Not authenticated" }, 401);
    if (user.role !== "admin" && user.role !== "superadmin") return c.json({ error: "Permission denied" }, 403);
    return null;
}

function normalizeStatus(value: unknown, fallback: GalleryStatus = "draft"): GalleryStatus {
    return value === "open" || value === "closed" || value === "draft" ? value : fallback;
}

function normalizeAddonStatus(value: unknown): "unpaid" | "paid" {
    return value === "paid" || value === "completed" ? "paid" : "unpaid";
}

function normalizeDriveFolderId(value: unknown): string {
    const raw = String(value || "").trim();
    if (!raw) return "";

    try {
        const url = new URL(raw);
        const folderMatch = url.pathname.match(/\/folders\/([^/]+)/);
        if (folderMatch?.[1]) return decodeURIComponent(folderMatch[1]);
        const id = url.searchParams.get("id");
        if (id) return id;
    } catch {
        // The input may already be a folder ID.
    }

    return raw
        .replace(/^https?:\/\/drive\.google\.com\/drive\/folders\//, "")
        .replace(/[?#].*$/, "")
        .replace(/\/.*$/, "")
        .trim();
}

function normalizeWhatsappNumber(value: unknown): string | null {
    let phone = String(value || "").replace(/[\s().-]/g, "");
    if (phone.startsWith("https://wa.me/")) phone = phone.slice("https://wa.me/".length);
    if (phone.startsWith("+")) phone = phone.slice(1);
    if (phone.startsWith("0")) phone = `62${phone.slice(1)}`;
    return /^628[0-9]{7,13}$/.test(phone) ? phone : null;
}

function galleryContactMessage(template: string, gallery: GalleryRow, requestUrl: string): string {
    const request = new URL(requestUrl);
    return template.replaceAll("{{gallery_url}}", `${request.origin}/culling/${gallery.publicKey || gallery.id}`).replaceAll("{{gallery_title}}", gallery.title);
}

function galleryPublicShape(row: GalleryRow) {
    const addonStatus = normalizeAddonStatus(row.editAddonStatus);
    const addonActive = addonStatus === "paid";
    return {
        id: row.id,
        title: row.title,
        status: row.status,
        syncedAt: row.syncedAt || null,
        maxSelections: Number(row.maxSelections || 0),
        additionalLimit: Number(row.additionalSelectionLimit || 0),
        addonStatus,
        addon: { enabled: addonActive, additionalLimit: addonActive ? Number(row.additionalSelectionLimit || 0) : 0, pricingMode: row.editAddonPricingMode || "per_photo", unitPrice: Number(row.editAddonPrice ?? DEFAULT_ADDON_UNIT_PRICE), status: addonStatus },
    };
}

function galleryLookup(param: string): { sql: string; params: unknown[] } {
    const numericId = Number(param);
    if (Number.isInteger(numericId) && numericId > 0) {
        return { sql: "id = ? OR public_key = ?", params: [numericId, param] };
    }
    return { sql: "public_key = ?", params: [param] };
}

function galleryAdminShape(row: GalleryRow, counts?: { photoCount?: number; selectionCount?: number }) {
    const addonStatus = normalizeAddonStatus(row.editAddonStatus);
    return {
        id: row.id,
        title: row.title,
        driveFolderId: row.driveFolderId,
        publicKey: row.publicKey || String(row.id),
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        syncedAt: row.syncedAt || null,
        photoCount: Number(counts?.photoCount || 0),
        selectionCount: Number(counts?.selectionCount || 0),
        maxSelections: Number(row.maxSelections || 0),
        additionalLimit: Number(row.additionalSelectionLimit || 0),
        addonStatus,
        addon: { enabled: addonStatus === "paid", additionalLimit: Number(row.additionalSelectionLimit || 0), pricingMode: row.editAddonPricingMode || "per_photo", unitPrice: Number(row.editAddonPrice ?? DEFAULT_ADDON_UNIT_PRICE) },
    };
}

function base64Url(input: string | ArrayBuffer): string {
    const buffer = typeof input === "string" ? Buffer.from(input) : Buffer.from(input);
    return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string): string {
    const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
    return Buffer.from(padded, "base64").toString("utf8");
}

async function hmac(input: string): Promise<string> {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET is required.");
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    return base64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input)));
}

async function createGalleryToken(galleryId: number, accessVersion: number): Promise<string> {
    const payload = base64Url(JSON.stringify({
        gid: galleryId,
        av: accessVersion,
        exp: Math.floor(Date.now() / 1000) + GALLERY_TOKEN_TTL_SECONDS,
    }));
    return `${payload}.${await hmac(payload)}`;
}

async function verifyGalleryToken(token: string, galleryId: number, accessVersion: number): Promise<boolean> {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return false;
    if (await hmac(payload) !== signature) return false;
    try {
        const parsed = JSON.parse(fromBase64Url(payload)) as { gid?: number; av?: number; exp?: number };
        return parsed.gid === galleryId && parsed.av === accessVersion && Number(parsed.exp || 0) > Math.floor(Date.now() / 1000);
    } catch {
        return false;
    }
}

async function requirePublicGallery(c: any): Promise<{ gallery: GalleryRow; token: string } | Response> {
    const identifier = c.req.param("id");
    const lookup = galleryLookup(identifier);

    const token = c.req.query("token") || c.req.header("x-gallery-token") || "";
    const gallery = await galleryOne<GalleryRow>(`
        SELECT id, title, contact_whatsapp_url as "contactWhatsappUrl", drive_folder_id as "driveFolderId", pin_hash as "pinHash", status,
               max_selections as "maxSelections", additional_selection_limit as "additionalSelectionLimit",
               edit_addon_status as "editAddonStatus", edit_addon_pricing_mode as "editAddonPricingMode", edit_addon_price as "editAddonPrice",
               created_at as "createdAt", updated_at as "updatedAt", synced_at as "syncedAt", access_version as "accessVersion"
        FROM galleries WHERE ${lookup.sql}
    `, lookup.params);
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);
    if (!token || !await verifyGalleryToken(token, gallery.id, gallery.accessVersion)) return c.json({ error: "Gallery access expired. Enter the PIN again." }, 401);
    if (gallery.status !== "open") return c.json({ error: "Gallery is not open for selection." }, 403);
    return { gallery, token };
}

function csvEscape(value: string | number | null | undefined): string {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

adminGalleriesRouter.get("/", async (c) => {
    const denied = requireGalleryAdmin(c);
    if (denied) return denied;

    const rows = await galleryAll<GalleryRow & { photoCount?: number; selectionCount?: number }>(`
        SELECT g.id, g.title, g.drive_folder_id as "driveFolderId", g.pin_hash as "pinHash", g.status,
               g.public_key as "publicKey", g.contact_whatsapp_url as "contactWhatsappUrl",
               g.max_selections as "maxSelections", g.additional_selection_limit as "additionalSelectionLimit",
               g.edit_addon_status as "editAddonStatus", g.edit_addon_pricing_mode as "editAddonPricingMode", g.edit_addon_price as "editAddonPrice",
               g.created_at as "createdAt", g.updated_at as "updatedAt", g.synced_at as "syncedAt",
               COUNT(DISTINCT p.id) as "photoCount",
               COUNT(DISTINCT s.id) as "selectionCount"
        FROM galleries g
        LEFT JOIN gallery_photos p ON p.gallery_id = g.id
        LEFT JOIN gallery_selections s ON s.gallery_id = g.id
        GROUP BY g.id, g.title, g.drive_folder_id, g.pin_hash, g.public_key, g.status, g.created_at, g.updated_at, g.synced_at, g.contact_whatsapp_url, g.max_selections, g.additional_selection_limit, g.edit_addon_status, g.edit_addon_pricing_mode, g.edit_addon_price
        ORDER BY g.id DESC
    `);
    return c.json(rows.map((row) => galleryAdminShape(row, row)));
});

adminGalleriesRouter.get("/settings/contact", async (c) => {
    const denied = requireGalleryAdmin(c);
    if (denied) return denied;
    const setting = await galleryOne<{ value: string }>("SELECT value FROM gallery_settings WHERE key = ?", ["contact_whatsapp_url"]);
    const value = setting?.value || "";
    const message = await galleryOne<{ value: string }>("SELECT value FROM gallery_settings WHERE key = ?", ["contact_whatsapp_message"]);
    const requestMoreMessage = await galleryOne<{ value: string }>("SELECT value FROM gallery_settings WHERE key = ?", ["request_more_whatsapp_message"]);
    return c.json({ contactWhatsappUrl: normalizeWhatsappNumber(value) ? (value.startsWith("https://wa.me/") ? `+${value.slice("https://wa.me/".length)}` : value) : "", message: message?.value || DEFAULT_CONTACT_MESSAGE, requestMoreMessage: requestMoreMessage?.value || DEFAULT_REQUEST_MORE_MESSAGE });
});

adminGalleriesRouter.patch("/settings/contact", async (c) => {
    const denied = requireGalleryAdmin(c);
    if (denied) return denied;
    const body = await c.req.json().catch(() => ({}));
    const phone = normalizeWhatsappNumber(body.contactWhatsappUrl);
    const message = String(body.message || "").trim().slice(0, 500);
    const requestMoreMessage = String(body.requestMoreMessage || "").trim().slice(0, 800);
    if (!phone) return c.json({ error: "Enter a valid Indonesian WhatsApp number, for example 081234567890 or +6281234567890" }, 400);
    await galleryRun("INSERT INTO gallery_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ["contact_whatsapp_url", phone]);
    await galleryRun("INSERT INTO gallery_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ["contact_whatsapp_message", message]);
    await galleryRun("INSERT INTO gallery_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ["request_more_whatsapp_message", requestMoreMessage]);
    return c.json({ contactWhatsappUrl: phone, message, requestMoreMessage });
});

adminGalleriesRouter.get("/packages", async (c) => {
    const denied = requireGalleryAdmin(c); if (denied) return denied;
    const pageSize = Math.min(10, Math.max(1, Number(c.req.query("pageSize") || 10)));
    const page = Math.max(1, Number(c.req.query("page") || 1));
    const total = Number((await galleryOne<{ total: number }>("SELECT COUNT(*) as total FROM edit_packages"))?.total || 0);
    const packages = await galleryAll("SELECT id, name, included_photo_count as includedPhotoCount, price, active, created_at as createdAt, updated_at as updatedAt FROM edit_packages ORDER BY id DESC LIMIT ? OFFSET ?", [pageSize, (page - 1) * pageSize]);
    return c.json({ packages, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
});

adminGalleriesRouter.post("/packages", async (c) => {
    const denied = requireGalleryAdmin(c); if (denied) return denied;
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name || "").trim(); const count = Number(body.includedPhotoCount); const price = Number(body.price);
    if (!name || !Number.isInteger(count) || count < 1 || count > 500 || !Number.isFinite(price) || price < 0) return c.json({ error: "Invalid package details." }, 400);
    const id = await galleryInsertReturningId("INSERT INTO edit_packages (name, included_photo_count, price) VALUES (?, ?, ?)", [name, count, price]);
    return c.json({ id, status: "created" }, 201);
});

adminGalleriesRouter.patch("/packages/:id", async (c) => {
    const denied = requireGalleryAdmin(c); if (denied) return denied;
    const id = Number(c.req.param("id"));
    const existing = await galleryOne<{ id: number; name: string; includedPhotoCount: number; price: number; active: number }>("SELECT id, name, included_photo_count as includedPhotoCount, price, active FROM edit_packages WHERE id = ?", [id]);
    if (!existing) return c.json({ error: "Package not found." }, 404);
    const body = await c.req.json().catch(() => ({}));
    const name = body.name === undefined ? existing.name : String(body.name || "").trim();
    const count = body.includedPhotoCount === undefined ? existing.includedPhotoCount : Number(body.includedPhotoCount);
    const price = body.price === undefined ? existing.price : Number(body.price);
    const active = body.active === undefined ? existing.active : (body.active ? 1 : 0);
    if (!name || !Number.isInteger(count) || count < 1 || count > 500 || !Number.isFinite(price) || price < 0) return c.json({ error: "Invalid package details." }, 400);
    await galleryRun("UPDATE edit_packages SET name = ?, included_photo_count = ?, price = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [name, count, price, active, id]);
    return c.json({ status: "updated" });
});

adminGalleriesRouter.delete("/packages/:id", async (c) => {
    const denied = requireGalleryAdmin(c); if (denied) return denied;
    const id = Number(c.req.param("id"));
    const used = await galleryOne<{ total: number }>("SELECT COUNT(*) as total FROM gallery_edit_requests WHERE package_id = ?", [id]);
    if (Number(used?.total || 0) > 0) return c.json({ error: "Package is already used by an add-on request." }, 409);
    await galleryRun("DELETE FROM edit_packages WHERE id = ?", [id]);
    return c.json({ status: "deleted" });
});

adminGalleriesRouter.get("/:id/addon", async (c) => {
    const denied = requireGalleryAdmin(c); if (denied) return denied;
    const id = Number(c.req.param("id"));
    const addon = await galleryOne("SELECT additional_selection_limit as additionalLimit, edit_addon_status as status, edit_addon_pricing_mode as pricingMode, edit_addon_price as price, edit_addon_package_id as packageId FROM galleries WHERE id = ?", [id]);
    if (!addon) return c.json({ error: "Gallery not found" }, 404); return c.json({ addon });
});

adminGalleriesRouter.get("/addon-requests", async (c) => {
    const denied = requireGalleryAdmin(c); if (denied) return denied;
    const pageSize = Math.min(10, Math.max(1, Number(c.req.query("pageSize") || 10))); const page = Math.max(1, Number(c.req.query("page") || 1));
    const total = Number((await galleryOne<{ total: number }>("SELECT COUNT(*) as total FROM gallery_edit_requests"))?.total || 0);
    const requests = await galleryAll("SELECT r.id, r.gallery_id as galleryId, g.title as galleryTitle, r.requested_additional_count as requestedAdditionalCount, r.pricing_mode as pricingMode, r.package_id as packageId, r.unit_price as unitPrice, r.quoted_total as quotedTotal, r.status, r.client_note as clientNote, r.admin_note as adminNote, r.created_at as createdAt, r.updated_at as updatedAt FROM gallery_edit_requests r JOIN galleries g ON g.id = r.gallery_id ORDER BY r.id DESC LIMIT ? OFFSET ?", [pageSize, (page - 1) * pageSize]);
    return c.json({ requests, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
});

adminGalleriesRouter.post("/:id/addon", async (c) => {
    const denied = requireGalleryAdmin(c); if (denied) return denied;
    const galleryId = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const count = Number(body.requestedAdditionalCount ?? body.additionalSelectionLimit);
    const mode = body.pricingMode === "package" ? "package" : "per_photo";
    const packageId = body.packageId ? Number(body.packageId) : null;
    const unitPrice = body.unitPrice === undefined || body.unitPrice === "" ? null : Number(body.unitPrice);
    const quotedTotal = body.quotedTotal === undefined || body.quotedTotal === "" ? null : Number(body.quotedTotal);
    const status = normalizeAddonStatus(body.status);
    if (!Number.isInteger(count) || count < 0 || count > 500 || (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) || (quotedTotal !== null && (!Number.isFinite(quotedTotal) || quotedTotal < 0))) return c.json({ error: "Invalid add-on details." }, 400);
    const id = await galleryInsertReturningId("INSERT INTO gallery_edit_requests (gallery_id, requested_additional_count, pricing_mode, package_id, unit_price, quoted_total, status, client_note, admin_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [galleryId, count, mode, packageId, unitPrice, quotedTotal, status, String(body.clientNote || "").trim() || null, String(body.adminNote || "").trim() || null]);
    return c.json({ id, status: "created" }, 201);
});

adminGalleriesRouter.patch("/addon-requests/:requestId", async (c) => {
    const denied = requireGalleryAdmin(c); if (denied) return denied;
    const id = Number(c.req.param("requestId"));
    const existing = await galleryOne<any>("SELECT * FROM gallery_edit_requests WHERE id = ?", [id]);
    if (!existing) return c.json({ error: "Add-on request not found." }, 404);
    const body = await c.req.json().catch(() => ({}));
    const count = body.requestedAdditionalCount === undefined ? existing.requested_additional_count : Number(body.requestedAdditionalCount);
    const mode = body.pricingMode === "package" ? "package" : (body.pricingMode === "per_photo" ? "per_photo" : existing.pricing_mode);
    const status = body.status === undefined ? normalizeAddonStatus(existing.status) : normalizeAddonStatus(body.status);
    if (!Number.isInteger(count) || count < 0 || count > 500) return c.json({ error: "Invalid add-on request." }, 400);
    await galleryRun("UPDATE gallery_edit_requests SET requested_additional_count = ?, pricing_mode = ?, package_id = ?, unit_price = ?, quoted_total = ?, status = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [count, mode, body.packageId ?? existing.package_id ?? null, body.unitPrice ?? existing.unit_price ?? null, body.quotedTotal ?? existing.quoted_total ?? null, status, body.adminNote ?? existing.admin_note ?? null, id]);
    await galleryRun("UPDATE galleries SET additional_selection_limit = ?, edit_addon_status = ?, edit_addon_pricing_mode = ?, edit_addon_price = ?, edit_addon_package_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [count, status, mode, body.unitPrice ?? existing.unit_price ?? null, body.packageId ?? existing.package_id ?? null, existing.gallery_id]);
    return c.json({ status: "updated" });
});

adminGalleriesRouter.post("/:id/addon/approve", async (c) => {
    const denied = requireGalleryAdmin(c); if (denied) return denied;
    const galleryId = Number(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const requestId = Number(body.requestId);
    const request = await galleryOne<any>("SELECT * FROM gallery_edit_requests WHERE id = ? AND gallery_id = ?", [requestId, galleryId]);
    if (!request) return c.json({ error: "Add-on request not found." }, 404);
    await galleryRun("UPDATE gallery_edit_requests SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [requestId]);
    await galleryRun("UPDATE galleries SET additional_selection_limit = ?, edit_addon_status = 'paid', edit_addon_pricing_mode = ?, edit_addon_price = ?, edit_addon_package_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [request.requested_additional_count, request.pricing_mode, request.unit_price, request.package_id, galleryId]);
    return c.json({ status: "paid" });
});

adminGalleriesRouter.post("/", async (c) => {
    const denied = requireGalleryAdmin(c);
    if (denied) return denied;

    const body = await c.req.json().catch(() => ({}));
    const title = String(body.title || "").trim();
    const driveFolderId = normalizeDriveFolderId(body.driveFolderUrl ?? body.driveFolderId);
    const pin = String(body.pin || "").trim();
    const status = normalizeStatus(body.status, "draft");
    const maxSelections = Math.min(500, Math.max(0, Number(body.maxSelections ?? 50) || 50));

    if (!title || !driveFolderId || pin.length < 4) {
        return c.json({ error: "Title, Drive folder ID, and a PIN of at least 4 characters are required." }, 400);
    }

    const pinHash = await Bun.password.hash(pin, { algorithm: "bcrypt", cost: 10 });
    const publicKey = randomUUID().replaceAll("-", "");
    const id = await galleryInsertReturningId(
        "INSERT INTO galleries (title, public_key, max_selections, edit_addon_pricing_mode, edit_addon_price, drive_folder_id, pin_hash, status) VALUES (?, ?, ?, 'per_photo', ?, ?, ?, ?)",
        [title, publicKey, maxSelections, DEFAULT_ADDON_UNIT_PRICE, driveFolderId, pinHash, status],
    );
    const row = await galleryOne<GalleryRow>(`
        SELECT id, title, public_key as "publicKey", contact_whatsapp_url as "contactWhatsappUrl", drive_folder_id as "driveFolderId", pin_hash as "pinHash", status, max_selections as "maxSelections", additional_selection_limit as "additionalSelectionLimit", edit_addon_status as "editAddonStatus", edit_addon_pricing_mode as "editAddonPricingMode", edit_addon_price as "editAddonPrice",
               created_at as "createdAt", updated_at as "updatedAt", synced_at as "syncedAt"
        FROM galleries WHERE id = ?
    `, [id]);
    return c.json(galleryAdminShape(row!));
});

adminGalleriesRouter.get("/:id", async (c) => {
    const denied = requireGalleryAdmin(c);
    if (denied) return denied;

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid gallery ID" }, 400);
    const gallery = await galleryOne<GalleryRow>(`
        SELECT id, title, public_key as "publicKey", contact_whatsapp_url as "contactWhatsappUrl", drive_folder_id as "driveFolderId", pin_hash as "pinHash", status, max_selections as "maxSelections", additional_selection_limit as "additionalSelectionLimit", edit_addon_status as "editAddonStatus", edit_addon_pricing_mode as "editAddonPricingMode", edit_addon_price as "editAddonPrice",
               created_at as "createdAt", updated_at as "updatedAt", synced_at as "syncedAt"
        FROM galleries WHERE id = ?
    `, [id]);
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);
    const photos = await galleryAll<PhotoRow>(`
        SELECT id, gallery_id as "galleryId", drive_file_id as "driveFileId", filename, mime_type as "mimeType",
               thumbnail_url as "thumbnailUrl", web_view_url as "webViewUrl", width, height,
               display_order as "displayOrder", created_at as "createdAt"
        FROM gallery_photos WHERE gallery_id = ? ORDER BY display_order, filename
    `, [id]);
    const selections = await galleryAll<SelectionRow>(`
        SELECT id, gallery_id as "galleryId", selected_drive_file_id as "selectedDriveFileId",
               selected_filename as "selectedFilename", note, submitted_at as "submittedAt"
        FROM gallery_selections WHERE gallery_id = ? ORDER BY selected_filename
    `, [id]);
    return c.json({
        gallery: galleryAdminShape(gallery, { photoCount: photos.length, selectionCount: selections.length }),
        photos: photos.map((photo) => photoShape(photo as PhotoRow & Record<string, unknown>)),
        selections,
    });
});

adminGalleriesRouter.post("/:id/reset-pin-lock", async (c) => {
    const denied = requireGalleryAdmin(c);
    if (denied) return denied;
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid gallery ID" }, 400);
    const gallery = await galleryOne<GalleryRow>("SELECT id, public_key as \"publicKey\" FROM galleries WHERE id = ?", [id]);
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);
    await resetGalleryPinAttempts([String(gallery.id), gallery.publicKey || ""]);
    return c.json({ status: "reset" });
});

adminGalleriesRouter.patch("/:id", async (c) => {
    const denied = requireGalleryAdmin(c);
    if (denied) return denied;

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid gallery ID" }, 400);
    const existing = await galleryOne<GalleryRow>(`
        SELECT id, title, drive_folder_id as "driveFolderId", pin_hash as "pinHash", status, max_selections as "maxSelections", additional_selection_limit as "additionalSelectionLimit", edit_addon_status as "editAddonStatus", edit_addon_pricing_mode as "editAddonPricingMode", edit_addon_price as "editAddonPrice",
               created_at as "createdAt", updated_at as "updatedAt", synced_at as "syncedAt"
        FROM galleries WHERE id = ?
    `, [id]);
    if (!existing) return c.json({ error: "Gallery not found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const title = body.title === undefined ? existing.title : String(body.title || "").trim();
    const driveFolderId = body.driveFolderId === undefined && body.driveFolderUrl === undefined
        ? existing.driveFolderId
        : normalizeDriveFolderId(body.driveFolderUrl ?? body.driveFolderId);
    const status = normalizeStatus(body.status, existing.status);
    const contactWhatsappUrl = body.contactWhatsappUrl === undefined ? existing.contactWhatsappUrl || null : String(body.contactWhatsappUrl || "").trim() || null;
    const maxSelections = body.maxSelections === undefined ? Number(existing.maxSelections || 0) : Math.min(500, Math.max(0, Number(body.maxSelections) || 0));
    const additionalSelectionLimit = body.additionalSelectionLimit === undefined ? Number(existing.additionalSelectionLimit || 0) : Math.min(500, Math.max(0, Number(body.additionalSelectionLimit) || 0));
    const editAddonStatus = body.editAddonStatus === undefined ? normalizeAddonStatus(existing.editAddonStatus) : normalizeAddonStatus(body.editAddonStatus);
    const editAddonPricingMode = body.editAddonPricingMode === undefined ? existing.editAddonPricingMode || "per_photo" : String(body.editAddonPricingMode || "") || "per_photo";
    const editAddonPrice = body.editAddonPrice === undefined ? Number(existing.editAddonPrice ?? DEFAULT_ADDON_UNIT_PRICE) : Math.max(0, Number(body.editAddonPrice) || 0);
    const pin = body.pin === undefined ? "" : String(body.pin || "").trim();
    const pinHash = pin ? await Bun.password.hash(pin, { algorithm: "bcrypt", cost: 10 }) : existing.pinHash;
    const activeSelectionLimit = maxSelections ? maxSelections + (editAddonStatus === "paid" ? additionalSelectionLimit : 0) : 0;
    const selectionCount = await galleryOne<{ count: number }>("SELECT COUNT(*) as count FROM gallery_selections WHERE gallery_id = ?", [id]);

    if (!title || !driveFolderId) return c.json({ error: "Title and Drive folder ID are required." }, 400);
    if (body.pin !== undefined && pin.length > 0 && pin.length < 4) return c.json({ error: "PIN must be at least 4 characters." }, 400);
    if (activeSelectionLimit && Number(selectionCount?.count || 0) > activeSelectionLimit) {
        return c.json({ error: `Active limit cannot be lower than ${selectionCount?.count || 0} submitted selections.` }, 400);
    }

    await galleryRun(
        "UPDATE galleries SET title = ?, drive_folder_id = ?, pin_hash = ?, contact_whatsapp_url = ?, max_selections = ?, additional_selection_limit = ?, edit_addon_status = ?, edit_addon_pricing_mode = ?, edit_addon_price = ?, status = ?, access_version = access_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [title, driveFolderId, pinHash, contactWhatsappUrl, maxSelections, additionalSelectionLimit, editAddonStatus, editAddonPricingMode, editAddonPrice, status, id],
    );
    return c.json({ status: "updated" });
});

adminGalleriesRouter.delete("/:id", async (c) => {
    const denied = requireGalleryAdmin(c);
    if (denied) return denied;

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid gallery ID" }, 400);
    const gallery = await galleryOne<{ id: number }>("SELECT id FROM galleries WHERE id = ?", [id]);
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);

    // Delete dependent metadata explicitly so cleanup is reliable across SQLite/Turso settings.
    await galleryRun("DELETE FROM gallery_edit_requests WHERE gallery_id = ?", [id]);
    await galleryRun("DELETE FROM gallery_photos WHERE gallery_id = ?", [id]);
    await galleryRun("DELETE FROM gallery_selections WHERE gallery_id = ?", [id]);
    await galleryRun("DELETE FROM galleries WHERE id = ?", [id]);
    return c.json({ status: "deleted" });
});

adminGalleriesRouter.post("/:id/sync", async (c) => {
    const denied = requireGalleryAdmin(c);
    if (denied) return denied;

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid gallery ID" }, 400);
    const gallery = await galleryOne<GalleryRow>(`
        SELECT id, title, drive_folder_id as "driveFolderId", pin_hash as "pinHash", status,
               created_at as "createdAt", updated_at as "updatedAt", synced_at as "syncedAt"
        FROM galleries WHERE id = ?
    `, [id]);
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);

    const photos = await listDrivePhotos(gallery.driveFolderId);
    const syncStatements: Array<{ sql: string; params: unknown[] }> = [
        { sql: "DELETE FROM gallery_photos WHERE gallery_id = ?", params: [id] },
    ];
    for (const [index, photo] of photos.entries()) {
        syncStatements.push({ sql: `
            INSERT INTO gallery_photos (
                gallery_id, drive_file_id, filename, mime_type, thumbnail_url,
                web_view_url, width, height, display_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, params: [
            id,
            photo.id,
            photo.name,
            photo.mimeType,
            photo.thumbnailLink || null,
            photo.webViewLink || null,
            photo.width || null,
            photo.height || null,
            index,
        ] });
    }
    syncStatements.push({ sql: "UPDATE galleries SET synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?", params: [id] });
    await galleryBatch(syncStatements);
    return c.json({ status: "synced", photoCount: photos.length });
});

adminGalleriesRouter.get("/:id/export.csv", async (c) => {
    const denied = requireGalleryAdmin(c);
    if (denied) return denied;

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.text("Invalid gallery ID", 400);
    const gallery = await galleryOne<GalleryRow>("SELECT id, title, drive_folder_id as \"driveFolderId\", pin_hash as \"pinHash\", status, created_at as \"createdAt\", updated_at as \"updatedAt\", synced_at as \"syncedAt\", access_version as \"accessVersion\" FROM galleries WHERE id = ?", [id]);
    if (!gallery) return c.text("Gallery not found", 404);
    const selections = await galleryAll<SelectionRow>(`
        SELECT id, gallery_id as "galleryId", selected_drive_file_id as "selectedDriveFileId",
               selected_filename as "selectedFilename", note, submitted_at as "submittedAt"
        FROM gallery_selections WHERE gallery_id = ? ORDER BY selected_filename
    `, [id]);
    const lines = [
        ["gallery_id", "gallery_title", "drive_file_id", "filename", "note", "submitted_at"].map(csvEscape).join(","),
        ...selections.map((row) => [gallery.id, gallery.title, row.selectedDriveFileId, row.selectedFilename, row.note, row.submittedAt].map(csvEscape).join(",")),
    ];
    return new Response(lines.join("\n"), {
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="gallery-${id}-selections.csv"`,
        },
    });
});

adminGalleriesRouter.get("/:id/export.xlsx", async (c) => {
    const denied = requireGalleryAdmin(c);
    if (denied) return denied;

    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ error: "Invalid gallery ID" }, 400);
    const gallery = await galleryOne<GalleryRow>("SELECT id, title, drive_folder_id as \"driveFolderId\", pin_hash as \"pinHash\", status, created_at as \"createdAt\", updated_at as \"updatedAt\", synced_at as \"syncedAt\", access_version as \"accessVersion\" FROM galleries WHERE id = ?", [id]);
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);
    const selections = await galleryAll<SelectionRow>(`
        SELECT id, gallery_id as "galleryId", selected_drive_file_id as "selectedDriveFileId",
               selected_filename as "selectedFilename", note, submitted_at as "submittedAt"
        FROM gallery_selections WHERE gallery_id = ? ORDER BY selected_filename
    `, [id]);
    const rows = [
        ["No", "Gallery", "DriveFileId", "Filename", "Note", "SubmittedAt"],
        ...selections.map((row, index) => [
            index + 1,
            gallery.title,
            row.selectedDriveFileId,
            row.selectedFilename,
            row.note || "",
            row.submittedAt,
        ]),
    ];
    const file = await writeExcelFile(rows, { sheet: "Selections" }).toBuffer();
    return new Response(file, {
        headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="gallery-${id}-selections.xlsx"`,
        },
    });
});

publicGalleriesRouter.get("/:id/contact", async (c) => {
    const setting = await galleryOne<{ value: string }>("SELECT value FROM gallery_settings WHERE key = ?", ["contact_whatsapp_url"]);
    const message = await galleryOne<{ value: string }>("SELECT value FROM gallery_settings WHERE key = ?", ["contact_whatsapp_message"]);
    const requestMoreMessage = await galleryOne<{ value: string }>("SELECT value FROM gallery_settings WHERE key = ?", ["request_more_whatsapp_message"]);
    return c.json({ contactWhatsappUrl: setting?.value || null, message: message?.value || DEFAULT_CONTACT_MESSAGE, requestMoreMessage: requestMoreMessage?.value || DEFAULT_REQUEST_MORE_MESSAGE });
});

publicGalleriesRouter.post("/:id/verify", async (c) => {
    const identifier = c.req.param("id");
    const lookup = galleryLookup(identifier);
    const body = await c.req.json().catch(() => ({}));
    const pin = String(body.pin || "").trim();
    const gallery = await galleryOne<GalleryRow>(`
        SELECT id, title, drive_folder_id as "driveFolderId", pin_hash as "pinHash", status,
               created_at as "createdAt", updated_at as "updatedAt", synced_at as "syncedAt", access_version as "accessVersion", contact_whatsapp_url as "contactWhatsappUrl", max_selections as "maxSelections", additional_selection_limit as "additionalSelectionLimit", edit_addon_status as "editAddonStatus", edit_addon_pricing_mode as "editAddonPricingMode", edit_addon_price as "editAddonPrice"
        FROM galleries WHERE ${lookup.sql}
    `, lookup.params);
    if (!gallery) return c.json({ error: "Gallery not found" }, 404);
    const contact = await galleryOne<{ value: string }>("SELECT value FROM gallery_settings WHERE key = ?", ["contact_whatsapp_url"]);
    const message = await galleryOne<{ value: string }>("SELECT value FROM gallery_settings WHERE key = ?", ["contact_whatsapp_message"]);
    if (gallery.status !== "open") {
        const template = message?.value || DEFAULT_CONTACT_MESSAGE;
        const text = galleryContactMessage(template, gallery, c.req.url);
        return c.json({ error: "Gallery is locked. Please contact the admin to unlock it.", code: "GALLERY_CLOSED", contactUrl: contact?.value ? `https://wa.me/${contact.value}?text=${encodeURIComponent(text)}` : null }, 403);
    }
    if (!pin || !await Bun.password.verify(pin, gallery.pinHash)) return c.json({ error: "Invalid PIN." }, 401);
    const token = await createGalleryToken(gallery.id, gallery.accessVersion);
    return c.json({ token, expiresIn: GALLERY_TOKEN_TTL_SECONDS, gallery: galleryPublicShape(gallery) });
});

publicGalleriesRouter.get("/:id/photos", async (c) => {
    const result = await requirePublicGallery(c);
    if (result instanceof Response) return result;
    const total = Number((await galleryOne<{ total: number }>("SELECT COUNT(*) as total FROM gallery_photos WHERE gallery_id = ?", [result.gallery.id]))?.total || 0);
    const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") || 60) || 60));
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(totalPages, Math.max(1, Number(c.req.query("page") || 1) || 1));
    const offset = (page - 1) * pageSize;
    const photos = await galleryAll<PhotoRow>(`
        SELECT id, gallery_id as "galleryId", drive_file_id as "driveFileId", filename, mime_type as "mimeType",
               width, height, display_order as "displayOrder", created_at as "createdAt"
        FROM gallery_photos WHERE gallery_id = ? ORDER BY display_order, filename LIMIT ? OFFSET ?
    `, [result.gallery.id, pageSize, offset]);
    const selections = await galleryAll<{ selectedDriveFileId: string }>(`
        SELECT selected_drive_file_id as "selectedDriveFileId" FROM gallery_selections WHERE gallery_id = ?
    `, [result.gallery.id]);
    const selectedPhotos = await galleryAll<PhotoRow & { note?: string | null }>(`
        SELECT p.id, p.gallery_id as "galleryId", p.drive_file_id as "driveFileId", p.filename,
               p.mime_type as "mimeType", p.width, p.height, p.display_order as "displayOrder",
               p.created_at as "createdAt", s.note
        FROM gallery_photos p
        INNER JOIN gallery_selections s ON s.gallery_id = p.gallery_id AND s.selected_drive_file_id = p.drive_file_id
        WHERE p.gallery_id = ? ORDER BY p.display_order, p.filename
    `, [result.gallery.id]);
    return c.json({
        gallery: galleryPublicShape(result.gallery),
        photos: photos.map((photo) => photoShape(photo as PhotoRow & Record<string, unknown>)),
        page,
        pageSize,
        total,
        totalPages,
        selectedDriveFileIds: selections.map((row) => selectionDriveFileId(row as Record<string, unknown>)).filter(Boolean),
        selectedPhotos: selectedPhotos.map((photo) => photoShape(photo as PhotoRow & Record<string, unknown>)),
    });
});

publicGalleriesRouter.get("/:id/photos/:fileId/thumbnail", async (c) => {
    const result = await requirePublicGallery(c);
    if (result instanceof Response) return result;
    const fileId = c.req.param("fileId");
    const photo = await galleryOne<PhotoRow>(`
        SELECT id, gallery_id as "galleryId", drive_file_id as "driveFileId", filename, mime_type as "mimeType",
               thumbnail_url as "thumbnailUrl", web_view_url as "webViewUrl", width, height,
               display_order as "displayOrder", created_at as "createdAt"
        FROM gallery_photos WHERE gallery_id = ? AND drive_file_id = ?
    `, [result.gallery.id, fileId]);
    if (!photo) return c.json({ error: "Photo not found" }, 404);
    let driveResponse: Response;
    try {
        driveResponse = await fetchDriveFile(photo.driveFileId, photo.thumbnailUrl || undefined, 320);
    } catch {
        const refreshed = await getDrivePhotoMetadata(photo.driveFileId);
        if (!refreshed.thumbnailLink) throw new Error("Google Drive did not return a thumbnail for this photo.");
        await galleryRun("UPDATE gallery_photos SET thumbnail_url = ?, web_view_url = ? WHERE gallery_id = ? AND drive_file_id = ?", [refreshed.thumbnailLink, refreshed.webViewLink || null, result.gallery.id, photo.driveFileId]);
        driveResponse = await fetchDriveFile(photo.driveFileId, refreshed.thumbnailLink, 320);
    }
    return new Response(driveResponse.body, {
        headers: {
            "Content-Type": driveResponse.headers.get("Content-Type") || "image/jpeg",
            "Cache-Control": "private, max-age=3600, stale-while-revalidate=300",
        },
    });
});

publicGalleriesRouter.get("/:id/photos/:fileId/preview", async (c) => {
    const result = await requirePublicGallery(c);
    if (result instanceof Response) return result;
    const fileId = c.req.param("fileId");
    const photo = await galleryOne<PhotoRow>(`
        SELECT id, gallery_id as "galleryId", drive_file_id as "driveFileId", filename, mime_type as "mimeType",
               thumbnail_url as "thumbnailUrl", web_view_url as "webViewUrl", width, height,
               display_order as "displayOrder", created_at as "createdAt"
        FROM gallery_photos WHERE gallery_id = ? AND drive_file_id = ?
    `, [result.gallery.id, fileId]);
    if (!photo) return c.json({ error: "Photo not found" }, 404);

    let driveResponse: Response;
    try {
        driveResponse = await fetchDriveFile(photo.driveFileId, photo.thumbnailUrl || undefined, 1600);
    } catch {
        let refreshedThumbnail: string | undefined;
        try {
            const refreshed = await getDrivePhotoMetadata(photo.driveFileId);
            await galleryRun("UPDATE gallery_photos SET thumbnail_url = ?, web_view_url = ? WHERE gallery_id = ? AND drive_file_id = ?", [refreshed.thumbnailLink || null, refreshed.webViewLink || null, result.gallery.id, photo.driveFileId]);
            refreshedThumbnail = refreshed.thumbnailLink || undefined;
        } catch {
            refreshedThumbnail = undefined;
        }
        try {
            driveResponse = await fetchDriveFile(photo.driveFileId, refreshedThumbnail, 1600);
        } catch {
            driveResponse = await fetchDriveFile(photo.driveFileId);
        }
    }
    return new Response(driveResponse.body, {
        headers: {
            "Content-Type": driveResponse.headers.get("Content-Type") || "image/jpeg",
            "Cache-Control": "private, max-age=3600, stale-while-revalidate=300",
        },
    });
});

publicGalleriesRouter.get("/:id/photos/:fileId/content", async (c) => {
    const result = await requirePublicGallery(c);
    if (result instanceof Response) return result;
    const fileId = c.req.param("fileId");
    const photo = await galleryOne<PhotoRow>(`
        SELECT id, gallery_id as "galleryId", drive_file_id as "driveFileId", filename, mime_type as "mimeType",
               thumbnail_url as "thumbnailUrl", web_view_url as "webViewUrl", width, height,
               display_order as "displayOrder", created_at as "createdAt"
        FROM gallery_photos WHERE gallery_id = ? AND drive_file_id = ?
    `, [result.gallery.id, fileId]);
    if (!photo) return c.json({ error: "Photo not found" }, 404);
    const driveResponse = await fetchDriveFile(photo.driveFileId);
    return new Response(driveResponse.body, {
        headers: {
            "Content-Type": driveResponse.headers.get("Content-Type") || photo.mimeType || "application/octet-stream",
            "Cache-Control": "private, max-age=3600, stale-while-revalidate=300",
        },
    });
});

publicGalleriesRouter.post("/:id/selections", async (c) => {
    const result = await requirePublicGallery(c);
    if (result instanceof Response) return result;
    const body = await c.req.json().catch(() => ({})) as { selections?: unknown };
    const rawSelections = Array.isArray(body.selections) ? body.selections : [];
    const parsedSelections = rawSelections.flatMap((value: unknown) => {
        if (typeof value === "string" && value.length > 0) return [{ driveFileId: value, note: "" }];
        if (!value || typeof value !== "object") return [];
        const item = value as { driveFileId?: unknown; note?: unknown };
        if (typeof item.driveFileId !== "string" || !item.driveFileId) return [];
        const note = typeof item.note === "string" ? item.note.trim() : "";
        return note.length <= 500 ? [{ driveFileId: item.driveFileId, note }] : [];
    });
    const selections = Array.from(new Map(parsedSelections.map((item) => [item.driveFileId, item])).values());
    const paidAddonLimit = normalizeAddonStatus(result.gallery.editAddonStatus) === "paid" ? Number(result.gallery.additionalSelectionLimit || 0) : 0;
    const selectionLimit = (result.gallery.maxSelections || 0) + paidAddonLimit;
    if (selections.length > 500 || (selectionLimit && selections.length > selectionLimit) || selections.length !== rawSelections.length) return c.json({ error: `Choose no more than ${selectionLimit} photos.` }, 400);

    const photos = await galleryAll<PhotoRow>(`
        SELECT id, gallery_id as "galleryId", drive_file_id as "driveFileId", filename, mime_type as "mimeType",
               display_order as "displayOrder", created_at as "createdAt"
        FROM gallery_photos WHERE gallery_id = ?
    `, [result.gallery.id]);
    const photoMap = new Map(photos.map((photo) => [photo.driveFileId, photo]));
    const selectedPhotos = selections.flatMap((selection) => {
        const photo = photoMap.get(selection.driveFileId);
        return photo ? [{ photo, note: selection.note }] : [];
    });

    await galleryBatch([
        { sql: "DELETE FROM gallery_selections WHERE gallery_id = ?", params: [result.gallery.id] },
        ...selectedPhotos.map(({ photo, note }) => ({
            sql: "INSERT INTO gallery_selections (gallery_id, selected_drive_file_id, selected_filename, note) VALUES (?, ?, ?, ?)",
            params: [result.gallery.id, photo.driveFileId, photo.filename, note || null],
        })),
    ]);
    return c.json({
        status: "submitted",
        selectionCount: selectedPhotos.length,
        filenames: selectedPhotos.map(({ photo }) => photo.filename),
    });
});

export { adminGalleriesRouter, publicGalleriesRouter };
