import { Buffer } from "node:buffer";

type DriveToken = {
    accessToken: string;
    expiresAt: number;
};

export type DrivePhoto = {
    id: string;
    name: string;
    mimeType: string;
    thumbnailLink?: string;
    webViewLink?: string;
    size?: string;
    width?: number | null;
    height?: number | null;
};

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const DRIVE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

let tokenCache: DriveToken | null = null;

function base64Url(input: string | ArrayBuffer): string {
    const buffer = typeof input === "string" ? Buffer.from(input) : Buffer.from(input);
    return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function serviceAccountConfig(): { clientEmail: string; privateKey: string } {
    const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (rawJson) {
        const parsed = JSON.parse(rawJson);
        if (!parsed.client_email || !parsed.private_key) {
            throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must include client_email and private_key.");
        }
        return {
            clientEmail: String(parsed.client_email),
            privateKey: String(parsed.private_key).replace(/\\n/g, "\n"),
        };
    }

    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
    if (!clientEmail || !privateKey) {
        throw new Error("Google Drive is not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.");
    }
    return { clientEmail, privateKey: privateKey.replace(/\\n/g, "\n") };
}

async function importPrivateKey(privateKey: string): Promise<CryptoKey> {
    const body = privateKey
        .replace("-----BEGIN PRIVATE KEY-----", "")
        .replace("-----END PRIVATE KEY-----", "")
        .replace(/\s/g, "");
    const binary = Buffer.from(body, "base64");
    return crypto.subtle.importKey(
        "pkcs8",
        binary,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
    );
}

async function createServiceAccountAssertion(): Promise<string> {
    const { clientEmail, privateKey } = serviceAccountConfig();
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = base64Url(JSON.stringify({
        iss: clientEmail,
        scope: DRIVE_SCOPE,
        aud: DRIVE_TOKEN_URL,
        exp: now + 3600,
        iat: now,
    }));
    const input = `${header}.${claim}`;
    const key = await importPrivateKey(privateKey);
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
    return `${input}.${base64Url(signature)}`;
}

export async function getDriveAccessToken(): Promise<string> {
    if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
        return tokenCache.accessToken;
    }

    const assertion = await createServiceAccountAssertion();
    const response = await fetch(DRIVE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion,
        }),
    });

    const data = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
    if (!response.ok || !data.access_token) {
        throw new Error(data.error_description || data.error || "Unable to authenticate with Google Drive.");
    }

    tokenCache = {
        accessToken: data.access_token,
        expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
    };
    return tokenCache.accessToken;
}

function driveSearchQuery(folderId: string): string {
    const safeFolderId = folderId.replace(/'/g, "\\'");
    return `'${safeFolderId}' in parents and trashed = false and mimeType contains 'image/'`;
}

export async function listDrivePhotos(folderId: string): Promise<DrivePhoto[]> {
    const token = await getDriveAccessToken();
    const photos: DrivePhoto[] = [];
    let pageToken = "";

    do {
        const params = new URLSearchParams({
            q: driveSearchQuery(folderId),
            pageSize: "1000",
            orderBy: "name_natural",
            fields: "nextPageToken,files(id,name,mimeType,thumbnailLink,webViewLink,size,imageMediaMetadata(width,height))",
            supportsAllDrives: "true",
            includeItemsFromAllDrives: "true",
        });
        if (pageToken) params.set("pageToken", pageToken);

        const response = await fetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json().catch(() => ({})) as {
            nextPageToken?: string;
            files?: Array<DrivePhoto & { imageMediaMetadata?: { width?: number; height?: number } }>;
            error?: { message?: string };
        };
        if (!response.ok) throw new Error(data.error?.message || "Unable to list Google Drive photos.");

        for (const file of data.files || []) {
            photos.push({
                id: file.id,
                name: file.name,
                mimeType: file.mimeType,
                thumbnailLink: file.thumbnailLink,
                webViewLink: file.webViewLink,
                size: file.size,
                width: file.imageMediaMetadata?.width ?? null,
                height: file.imageMediaMetadata?.height ?? null,
            });
        }
        pageToken = data.nextPageToken || "";
    } while (pageToken);

    return photos;
}

export async function getDrivePhotoMetadata(fileId: string): Promise<DrivePhoto> {
    const token = await getDriveAccessToken();
    const response = await fetch(`${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,name,mimeType,thumbnailLink,webViewLink,size,imageMediaMetadata(width,height)`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({})) as DrivePhoto & { error?: { message?: string }; imageMediaMetadata?: { width?: number; height?: number } };
    if (!response.ok || !data.id) throw new Error(data.error?.message || `Unable to refresh Google Drive photo (${response.status}).`);
    return {
        id: data.id,
        name: data.name,
        mimeType: data.mimeType,
        thumbnailLink: data.thumbnailLink,
        webViewLink: data.webViewLink,
        size: data.size,
        width: data.imageMediaMetadata?.width ?? null,
        height: data.imageMediaMetadata?.height ?? null,
    };
}

function resizedThumbnailUrl(thumbnailLink: string, width: number): string {
    return thumbnailLink.replace(/=s\d+(?:-[^?]*)?$/, `=w${width}-h${width}`);
}

export async function fetchDriveFile(fileId: string, thumbnailLink?: string, width?: number): Promise<Response> {
    const token = await getDriveAccessToken();
    const url = thumbnailLink
        ? resizedThumbnailUrl(thumbnailLink, width || 320)
        : `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
        const message = await response.text().catch(() => "");
        throw new Error(message || `Unable to fetch Google Drive file (${response.status}).`);
    }
    return response;
}
