import { afterAll, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Hono } from "hono";

// Set these before importing storage. Tests must never open developer/remote data.
process.env.DATABASE_DRIVER = "sqlite";
process.env.SQLITE_PATH = ":memory:";
for (const key of ["GALLERY_DATABASE_URL", "GALLERY_AUTH_TOKEN", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "DATABASE_URL", "SUPABASE_DB_URL"]) delete process.env[key];
process.env.FACE_WORKER_URL = "http://worker.test";
process.env.FACE_WORKER_TOKEN = "test-worker";
process.env.FACE_WORKER_INTERNAL_TOKEN = "test-internal";
process.env.FACE_WORKER_CALLBACK_ORIGIN = "http://api.test";

const { galleryRun, galleryAll, ensureGalleryStorage } = await import("../db/galleries");
const { sqlite } = await import("../db/runtime");
const { getFaceSourceVersion, FaceSourceChanged } = await import("../lib/face-source");
const { createOrReuseJob, currentJob, faceIndexRouter, MODEL_VERSION, publicFaceSearchStatus, handlePublicFaceSearch, prepareGalleryFaceIndex, faceSearchBodyLimit } = await import("./face-index");
const capabilities = ["embedding-cache-v1", "drive-direct-v1"];

test("direct dispatch requires capability and includes source and thumbnail", async () => {
    await galleryRun("UPDATE gallery_photos SET thumbnail_url = 'https://lh3.googleusercontent.com/test=s220'");
    await createOrReuseJob(1);
    expect(dispatched[0]).toMatchObject({ photoSource: "drive", photos: [{ driveFileId: "a", thumbnailUrl: "https://lh3.googleusercontent.com/test=s220" }] });
    fetchMock.mockImplementation(async () => Response.json({ model: MODEL_VERSION, capabilities: ["embedding-cache-v1"] }));
    expect(await publicFaceSearchStatus(1)).toMatchObject({ available: false, code: "worker_update_required" });
});

test("Drive token auth, scope isolation, expiry and refresh never expose issuer failures", async () => {
    const headers = { "x-face-worker-token": "test-internal" };
    const denied = await faceIndexRouter.request("/drive-token", { method: "POST", headers: { "x-face-worker-token": "wrong" } });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("cache-control")).toBe("no-store");
    const { generateKeyPairSync } = await import("node:crypto");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    const saved = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "test@example.invalid", private_key: privateKey });
    const scopes: string[] = [];
    fetchMock.mockImplementation(async (_input, init) => {
        const assertion = new URLSearchParams(String(init?.body)).get("assertion")!;
        scopes.push(JSON.parse(Buffer.from(assertion.split(".")[1]!, "base64url").toString()).scope);
        return Response.json({ access_token: `temporary-${scopes.length}`, expires_in: 3600 });
    });
    try {
        const responses = await Promise.all(Array.from({ length: 3 }, () => faceIndexRouter.request("/drive-token", { method: "POST", headers })));
        expect(scopes).toEqual(["https://www.googleapis.com/auth/drive.readonly"]);
        for (const response of responses) {
            expect(response.headers.get("cache-control")).toBe("no-store");
            expect(await response.json()).toMatchObject({ accessToken: "temporary-1", expiresAt: expect.any(Number) });
        }
        const { getDriveAccessToken } = await import("../lib/google-drive");
        expect(await getDriveAccessToken()).toBe("temporary-2");
        expect(scopes[1]).toContain("https://www.googleapis.com/auth/drive.file");
        expect((await faceIndexRouter.request("/drive-token?refresh=1", { method: "POST", headers })).status).toBe(200);
        expect(scopes[2]).toBe("https://www.googleapis.com/auth/drive.readonly");
        fetchMock.mockImplementation(async () => { throw new Error("PRIVATE GOOGLE DETAIL"); });
        const failed = await faceIndexRouter.request("/drive-token?refresh=1", { method: "POST", headers });
        expect(failed.status).toBe(503);
        expect(await failed.text()).not.toContain("PRIVATE GOOGLE DETAIL");
    } finally {
        if (saved === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
        else process.env.GOOGLE_SERVICE_ACCOUNT_JSON = saved;
    }
});

test("legacy photo proxy is disabled by default", async () => {
    const saved = process.env.FACE_WORKER_LEGACY_ASSET_PROXY;
    delete process.env.FACE_WORKER_LEGACY_ASSET_PROXY;
    try {
        const result = await faceIndexRouter.request("/assets/galleries/1/photos/a", { headers: { "x-face-worker-token": "test-internal" } });
        expect(result.status).toBe(410);
        expect(await result.json()).toMatchObject({ code: "legacy_proxy_disabled" });
    } finally {
        if (saved !== undefined) process.env.FACE_WORKER_LEGACY_ASSET_PROXY = saved;
    }
});

test("selfie limit rejects oversized files and chunked bodies", async () => {
    await complete((await createOrReuseJob(1))!);
    const app = new Hono<{ Variables: { user?: { sub: number; email: string; name: string; role: string } } }>();
    app.use("/search", faceSearchBodyLimit);
    app.post("/search", (c) => handlePublicFaceSearch(c, 1));
    const body = new FormData();
    body.set("selfie", new File([new Uint8Array(4 * 1024 * 1024 + 1)], "selfie.jpg"));
    expect((await app.request("/search", { method: "POST", body })).status).toBe(413);
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(5 * 1024 * 1024)); controller.close(); } });
    expect((await app.request("/search", { method: "POST", body: stream })).status).toBe(413);
});
await ensureGalleryStorage();
const originalFetch = globalThis.fetch;
const dispatched: any[] = [];
let ready = true;
const fetchMock = mock(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/readyz")) return Response.json({ model: MODEL_VERSION, capabilities, code: "model_loading" }, { status: ready ? 200 : 503 });
    return Response.json({ accepted: true });
});
globalThis.fetch = fetchMock as unknown as typeof fetch;
afterAll(() => { globalThis.fetch = originalFetch; });

beforeEach(async () => {
    ready = true;
    dispatched.length = 0;
    fetchMock.mockImplementation(async (input, init?: RequestInit) => {
        if (String(input).endsWith("/readyz")) return Response.json({ model: MODEL_VERSION, capabilities, code: "model_loading" }, { status: ready ? 200 : 503 });
        if (String(input).endsWith("/v1/index/jobs")) dispatched.push(JSON.parse(String(init?.body)));
        if (String(input).endsWith("/v1/search")) return Response.json({ matches: [{ driveFileId: "a" }, { driveFileId: "b" }] });
        return Response.json({ accepted: true });
    });
    for (const table of ["face_index_photos", "face_embeddings", "face_index_jobs", "gallery_photos", "galleries"]) await galleryRun(`DELETE FROM ${table}`);
    await galleryRun("INSERT INTO galleries (id, title, drive_folder_id, pin_hash) VALUES (1, 'test', 'folder', 'hash')");
    await addPhoto("a");
});

async function addPhoto(fileId: string, version = "v1") {
    await galleryRun("INSERT INTO gallery_photos (gallery_id, drive_file_id, filename, mime_type, source_version) VALUES (1, ?, ?, 'image/jpeg', ?)", [fileId, fileId, version]);
}

async function complete(job: NonNullable<Awaited<ReturnType<typeof currentJob>>>, embeddings: unknown[] = []) {
    return faceIndexRouter.request(`/callbacks/jobs/${job.id}/complete`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-face-worker-token": "test-internal" },
        body: JSON.stringify({ galleryId: 1, modelVersion: MODEL_VERSION, sourceVersion: job.sourceVersion, embeddings }),
    });
}

test("ready model is required and offline pre-indexing creates no job", async () => {
    ready = false;
    await prepareGalleryFaceIndex(1);
    expect(await galleryAll("SELECT id FROM face_index_jobs")).toHaveLength(0);
    expect((await publicFaceSearchStatus(1)).status).toBe("unavailable");
});

test("empty faces is a valid index; repeat sync and title edits reuse it", async () => {
    const job = (await createOrReuseJob(1))!;
    expect((await complete(job)).status).toBe(200);
    await galleryRun("UPDATE galleries SET title = 'changed', synced_at = CURRENT_TIMESTAMP WHERE id = 1");
    expect((await createOrReuseJob(1))?.id).toBe(job.id);
    expect(dispatched).toHaveLength(1);
    expect((await publicFaceSearchStatus(1)).status).toBe("ready");
});

test("incremental jobs reuse both faces and no-face results; changed files are scanned", async () => {
    await addPhoto("b");
    const first = (await createOrReuseJob(1))!;
    expect((await complete(first, [{ driveFileId: "a", faceIndex: 0, sourceVersion: "v1", embedding: Array(128).fill(1 / Math.sqrt(128)) }])).status).toBe(200);
    await addPhoto("c");
    const next = (await createOrReuseJob(1))!;
    const payload = dispatched[1];
    expect(payload.photos.find((p: any) => p.driveFileId === "a").cachedFaces).toHaveLength(1);
    expect(payload.photos.find((p: any) => p.driveFileId === "b").cachedFaces).toEqual([]);
    expect(payload.photos.find((p: any) => p.driveFileId === "c").cachedFaces).toBeUndefined();
    await complete(next, payload.photos[0].cachedFaces);
    await galleryRun("UPDATE gallery_photos SET source_version = 'v2' WHERE drive_file_id = 'a'");
    await createOrReuseJob(1);
    expect(dispatched[2].photos.find((p: any) => p.driveFileId === "a").cachedFaces).toBeUndefined();
});

test("stale job can retry, and late completion cannot overwrite newer results", async () => {
    const first = (await createOrReuseJob(1))!;
    await galleryRun("UPDATE face_index_jobs SET updated_at = '2000-01-01 00:00:00' WHERE id = ?", [first.id]);
    expect((await currentJob(1))?.status).toBe("failed");
    const next = (await createOrReuseJob(1))!;
    expect(next.id).not.toBe(first.id);
    await complete(next);
    expect((await complete(first)).status).toBe(409);
    expect((await currentJob(1))?.status).toBe("completed");
});

test("source changes reject old callbacks without deleting the published index", async () => {
    const first = (await createOrReuseJob(1))!;
    await complete(first);
    await addPhoto("b");
    const second = (await createOrReuseJob(1))!;
    await galleryRun("UPDATE gallery_photos SET source_version = 'v2' WHERE drive_file_id = 'b'");
    expect((await complete(second)).status).toBe(409);
    expect(await galleryAll("SELECT * FROM face_index_photos")).toHaveLength(1);
});

test("concurrent requests dispatch once and complete before dispatch returns safely", async () => {
    fetchMock.mockImplementation(async (input, init?: RequestInit) => {
        if (String(input).endsWith("/readyz")) return Response.json({ model: MODEL_VERSION, capabilities });
        const body = JSON.parse(String(init?.body));
        dispatched.push(body);
        const job = (await currentJob(1))!;
        expect((await complete(job)).status).toBe(200);
        return Response.json({ accepted: true });
    });
    await Promise.all([createOrReuseJob(1), createOrReuseJob(1)]);
    expect(dispatched).toHaveLength(1);
    expect((await currentJob(1))?.status).toBe("completed");
});

test("returning to an older source never reuses a superseded embedding snapshot", async () => {
    await complete((await createOrReuseJob(1))!);
    await addPhoto("b");
    await complete((await createOrReuseJob(1))!);
    await galleryRun("DELETE FROM gallery_photos WHERE drive_file_id = 'b'");
    expect((await createOrReuseJob(1))?.status).toBe("running");
    expect(dispatched).toHaveLength(3);
});

test("worker matches use public serialization and gallery order across all photos", async () => {
    await addPhoto("b");
    await galleryRun("UPDATE gallery_photos SET display_order = 2 WHERE drive_file_id = 'a'");
    await complete((await createOrReuseJob(1))!);
    const app = new Hono<{ Variables: { user?: { sub: number; email: string; name: string; role: string } } }>();
    app.post("/search", (c) => handlePublicFaceSearch(c, 1, (photo) => ({ driveFileId: photo.driveFileId, photoToken: `signed-${photo.driveFileId}` })));
    const form = new FormData();
    form.set("selfie", new File(["test"], "selfie.jpg", { type: "image/jpeg" }));
    const result = await app.request("/search", { method: "POST", body: form });
    expect(result.status).toBe(200);
    const body = await result.json() as { matches: unknown[] };
    expect(body.matches).toEqual([{ driveFileId: "b", photoToken: "signed-b" }, { driveFileId: "a", photoToken: "signed-a" }]);
});

test("worker search errors use safe codes and messages without echoing private details", async () => {
    await complete((await createOrReuseJob(1))!);
    const app = new Hono<{ Variables: { user?: { sub: number; email: string; name: string; role: string } } }>();
    app.post("/search", (c) => handlePublicFaceSearch(c, 1));
    const cases = [
        { workerStatus: 413, detail: { code: "embeddings_too_large" }, status: 413, code: "embeddings_too_large" },
        { workerStatus: 400, detail: "Part exceeded maximum size of 1024KB.", status: 413, code: "embeddings_too_large" },
        { workerStatus: 413, detail: { code: "too_many_embeddings" }, status: 413, code: "too_many_embeddings" },
        { workerStatus: 413, detail: { code: "selfie_too_large" }, status: 413, code: "selfie_too_large" },
        { workerStatus: 400, detail: { code: "invalid_embeddings" }, status: 502, code: "invalid_embeddings" },
        { workerStatus: 400, detail: { code: "invalid_search_form" }, status: 502, code: "invalid_search_form" },
        { workerStatus: 422, detail: { code: "no_face" }, status: 422, code: "no_face" },
        { workerStatus: 422, detail: "No face found in the selfie", status: 422, code: "no_face" },
        { workerStatus: 422, detail: { code: "invalid_selfie" }, status: 422, code: "invalid_selfie" },
        { workerStatus: 409, detail: { code: "model_version_mismatch" }, status: 503, code: "model_version_mismatch" },
        { workerStatus: 400, detail: { code: "PRIVATE_SELFIE_TOKEN_EMBEDDING", input: "PRIVATE_SELFIE_TOKEN_EMBEDDING" }, status: 502, code: "worker_search_failed" },
        { workerStatus: 422, detail: [{ input: "PRIVATE_SELFIE_TOKEN_EMBEDDING" }], status: 502, code: "worker_search_failed" },
    ];
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
        for (const item of cases) {
            fetchMock.mockImplementation(async (input) => String(input).endsWith("/readyz")
                ? Response.json({ model: MODEL_VERSION, capabilities })
                : Response.json({ detail: item.detail }, { status: item.workerStatus }));
            const form = new FormData();
            form.set("selfie", new File(["test"], "selfie.jpg", { type: "image/jpeg" }));
            const response = await app.request("/search", { method: "POST", body: form });
            expect(response.status).toBe(item.status);
            const body = await response.json() as { error: string; code: string };
            expect(body.code).toBe(item.code);
            expect(body.error).not.toContain("Face worker search failed");
            expect(JSON.stringify(body)).not.toContain("PRIVATE_SELFIE_TOKEN_EMBEDDING");
        }
        expect(warning).toHaveBeenCalledTimes(cases.length);
        expect(JSON.stringify(warning.mock.calls)).not.toContain("PRIVATE_SELFIE_TOKEN_EMBEDDING");
    } finally {
        warning.mockRestore();
    }
});

test("source metadata invalidates only fingerprint inputs, including moves and legacy dimensions", async () => {
    const original = await getFaceSourceVersion(1);
    const header = () => galleryAll("SELECT face_source_revision, face_source_version FROM galleries WHERE id = 1");
    const before = await header();
    await galleryRun("UPDATE gallery_photos SET filename = 'renamed', thumbnail_url = 'refreshed', display_order = 5, width = 200 WHERE gallery_id = 1");
    await galleryRun("UPDATE galleries SET title = 'renamed' WHERE id = 1");
    expect(await header()).toEqual(before);
    await galleryRun("UPDATE gallery_photos SET source_version = 'v2' WHERE gallery_id = 1");
    expect((await header())[0]!.face_source_version).toBeNull();
    expect(await getFaceSourceVersion(1)).not.toBe(original);
    await galleryRun("UPDATE gallery_photos SET source_version = '' WHERE gallery_id = 1");
    const legacy = await getFaceSourceVersion(1);
    await galleryRun("UPDATE gallery_photos SET width = 300 WHERE gallery_id = 1");
    expect(await getFaceSourceVersion(1)).not.toBe(legacy);
    await galleryRun("INSERT INTO galleries (id, title, drive_folder_id, pin_hash) VALUES (2, 'other', 'folder2', 'hash')");
    const empty = await getFaceSourceVersion(2);
    await galleryRun("UPDATE gallery_photos SET gallery_id = 2 WHERE gallery_id = 1");
    expect(await getFaceSourceVersion(1)).toBe(empty);
    expect(await getFaceSourceVersion(2)).not.toBe(empty);
    await galleryRun("DELETE FROM gallery_photos WHERE gallery_id = 2");
    expect(await getFaceSourceVersion(2)).toBe(empty);
});

test("warm polling does not read photos; warm search sends only index identity, not embeddings", async () => {
    const job = (await createOrReuseJob(1))!;
    await complete(job);
    const prepare = spyOn(sqlite!, "prepare");
    try {
        for (let i = 0; i < 3; i++) expect((await publicFaceSearchStatus(1)).status).toBe("ready");
        expect(prepare.mock.calls.some(([sql]) => /FROM gallery_photos/i.test(String(sql)))).toBe(false);
        const app = new Hono<{ Variables: { user?: { sub: number; email: string; name: string; role: string } } }>();
        app.post("/search", (c) => handlePublicFaceSearch(c, 1));
        for (let i = 0; i < 2; i++) {
            const body = new FormData();
            body.set("selfie", new File(["test"], "test.jpg"));
            expect((await app.request("/search", { method: "POST", body })).status).toBe(200);
        }
        expect(prepare.mock.calls.some(([sql]) => /FROM face_embeddings/i.test(String(sql)))).toBe(false);
        const searches = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/search"));
        expect(searches.length).toBeGreaterThanOrEqual(2);
        for (const call of searches.slice(-2)) {
            const body = (call[1] as RequestInit).body as FormData;
            expect(body.has("embeddings")).toBe(false);
            expect(body.get("completedJobId")).toBe(String(job.id));
            expect(body.get("sourceVersion")).toBe(job.sourceVersion);
        }
    } finally { prepare.mockRestore(); }
});

test("snapshot endpoint authenticates and rejects changed or replaced indices, including empty indices", async () => {
    const job = (await createOrReuseJob(1))!;
    const request = (id: number) => faceIndexRouter.request(`/indexes/${id}`, { headers: { "x-face-worker-token": "test-internal" } });
    expect((await request(job.id)).status).toBe(409);
    await complete(job);
    expect((await faceIndexRouter.request(`/indexes/${job.id}`)).status).toBe(401);
    const snapshot = await request(job.id);
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({ completedJobId: job.id, sourceVersion: job.sourceVersion, embeddings: [] });
    await addPhoto("b");
    expect((await request(job.id)).status).toBe(409);
    const next = (await createOrReuseJob(1))!;
    await complete(next, [{ driveFileId: "a", faceIndex: 0, sourceVersion: "v1", embedding: Array(128).fill(0.1) }]);
    expect((await request(job.id)).status).toBe(409);
    expect((await (await request(next.id)).json() as { embeddings: unknown[] }).embeddings).toHaveLength(1);
    await galleryRun("DELETE FROM galleries WHERE id = 1");
    expect((await request(next.id)).status).toBe(409);
});

test("source fingerprint retries at most twice if photos keep changing", async () => {
    const originalPrepare = sqlite!.prepare.bind(sqlite!);
    const prepare = spyOn(sqlite!, "prepare").mockImplementation((...args: Parameters<typeof originalPrepare>) => {
        if (/UPDATE galleries SET face_source_version = \?/i.test(String(args[0]))) {
            sqlite!.exec("UPDATE gallery_photos SET source_version = source_version || 'x' WHERE gallery_id = 1");
        }
        return originalPrepare(...args);
    });
    try {
        await expect(getFaceSourceVersion(1)).rejects.toBeInstanceOf(FaceSourceChanged);
        expect(prepare.mock.calls.filter(([sql]) => /UPDATE galleries SET face_source_version = \?/i.test(String(sql)))).toHaveLength(3);
    } finally { prepare.mockRestore(); }
});

test("legacy metadata backfill reuses a valid completed index and leaves selections intact", async () => {
    const job = (await createOrReuseJob(1))!;
    await complete(job);
    await galleryRun("INSERT INTO gallery_selections (gallery_id, selected_drive_file_id, selected_filename) VALUES (1, 'a', 'a.jpg')");
    await galleryRun("UPDATE galleries SET face_source_version = NULL WHERE id = 1");
    expect((await publicFaceSearchStatus(1)).status).toBe("ready");
    expect((await createOrReuseJob(1))?.id).toBe(job.id);
    expect(await galleryAll("SELECT selected_drive_file_id FROM gallery_selections WHERE gallery_id = 1")).toEqual([{ selected_drive_file_id: "a" }]);
    await galleryRun("DELETE FROM gallery_selections WHERE gallery_id = 1");
});

test("photo changes inside publication transaction cannot mark a stale index complete", async () => {
    const first = (await createOrReuseJob(1))!;
    await complete(first);
    await addPhoto("b");
    const next = (await createOrReuseJob(1))!;
    const originalPrepare = sqlite!.prepare.bind(sqlite!);
    let changed = false;
    const prepare = spyOn(sqlite!, "prepare").mockImplementation((...args: Parameters<typeof originalPrepare>) => {
        if (!changed && String(args[0]).startsWith("UPDATE face_index_jobs SET status = 'cancelled'")) {
            changed = true;
            sqlite!.exec("UPDATE gallery_photos SET source_version = 'changed' WHERE drive_file_id = 'a'");
        }
        return originalPrepare(...args);
    });
    try {
        expect((await complete(next)).status).toBe(409);
        expect(await galleryAll("SELECT status FROM face_index_jobs WHERE id = ?", [next.id])).toEqual([{ status: "running" }]);
        expect(await galleryAll("SELECT drive_file_id FROM face_index_photos WHERE gallery_id = 1")).toEqual([{ drive_file_id: "a" }]);
    } finally { prepare.mockRestore(); }
});

test("search rechecks source and access after inference, and old workers are unavailable", async () => {
    await complete((await createOrReuseJob(1))!);
    const app = new Hono<{ Variables: { user?: { sub: number; email: string; name: string; role: string } } }>();
    let revoke = false;
    app.post("/search", (c) => handlePublicFaceSearch(c, 1, (photo) => photo, async () => revoke ? new Response("Denied", { status: 401 }) : null));
    const search = () => {
        const body = new FormData();
        body.set("selfie", new File(["test"], "test.jpg"));
        return app.request("/search", { method: "POST", body });
    };
    revoke = true;
    expect((await search()).status).toBe(401);
    revoke = false;
    fetchMock.mockImplementation(async (input) => {
        if (String(input).endsWith("/readyz")) return Response.json({ model: MODEL_VERSION, capabilities });
        await addPhoto("new");
        return Response.json({ matches: [{ driveFileId: "a" }] });
    });
    expect((await search()).status).toBe(409);
    fetchMock.mockImplementation(async () => Response.json({ model: MODEL_VERSION }));
    expect(await publicFaceSearchStatus(1)).toMatchObject({ available: false, code: "worker_update_required" });
});
