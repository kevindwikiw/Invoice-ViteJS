# Client Gallery Infrastructure

Dokumen ini menjelaskan alur kerja Client Culling Gallery: dari admin membuat gallery, sync foto dari Google Drive, client membuka PIN, memilih foto, sampai submit pilihan.

## High Level Architecture

```mermaid
flowchart LR
    Admin[Admin Browser] -->|JWT admin| AppAPI[Fly Backend API]
    Client[Client Browser] -->|Public gallery URL + PIN| AppAPI

    AppAPI -->|Gallery metadata, photos, selections| Turso[(Turso Gallery DB)]
    AppAPI -->|List files, fetch image bytes| GDrive[Google Drive API]
    AppAPI -->|PIN attempt lock| RateLimit[(Rate Limit Storage)]

    Client -->|Thumbnail, preview, submit| AppAPI
    Admin -->|Create, sync, export| AppAPI
```

Main idea:

- Browser selalu masuk lewat backend dulu, supaya PIN, token, deadline, dan photo token tetap divalidasi.
- Turso menyimpan metadata kecil: gallery, foto, selection, deadline, dan add-on.
- Binary image tidak disimpan di Turso.
- Thumbnail dan preview diambil dari Google Drive melalui backend image endpoint.
- Supabase Storage image cache tidak aktif pada arsitektur saat ini.

## Public URL Naming

Gallery baru memakai public key berbasis judul dan tanggal create.

```text
/culling/{title-slug}-{yyyymmdd}
```

Contoh:

```text
/culling/kevin-putri-prewedding-20260904
```

Catatan:

- Existing gallery lama tetap bisa memakai public key lama.
- `public_key` tetap unik di database.
- Jika ada dua gallery dengan judul sama pada tanggal yang sama, database akan menolak create karena URL bentrok.

## Admin Flow

```mermaid
sequenceDiagram
    participant Admin as Admin Browser
    participant API as Backend /api/galleries
    participant Turso as Turso Gallery DB
    participant Drive as Google Drive

    Admin->>API: POST /galleries
    API->>API: Normalize Drive folder URL
    API->>API: Hash client PIN
    API->>API: Build public_key from title + date
    API->>Turso: INSERT gallery metadata
    API-->>Admin: Gallery summary + public URL

    Admin->>API: POST /galleries/:id/sync
    API->>Drive: listDrivePhotos(folderId)
    Drive-->>API: Photo metadata + thumbnailLink
    API->>Turso: Upsert gallery_photos
    API->>Turso: Update photo_count + synced_at
    API-->>Admin: Sync result
```

Admin responsibilities:

- Create gallery with title, Drive folder, PIN, selection limit, and selection window in hours.
- Sync Drive folder when photos are ready.
- Open or close gallery status.
- Export submitted selection as CSV/XLSX.

## Client Unlock Flow

```mermaid
sequenceDiagram
    participant Client as Client Browser
    participant API as Backend /api/public/galleries
    participant Turso as Turso Gallery DB
    participant Lock as Rate Limit Storage

    Client->>API: POST /:publicKey/verify { pin }
    API->>Turso: Load gallery by public_key
    API->>API: Check status + dynamic deadline
    API->>Lock: Check PIN attempt limit
    API->>API: Verify bcrypt PIN
    API->>API: Create gallery session token
    API-->>Client: token + public gallery shape
```

Important behavior:

- Gallery status must be `open`.
- Expired deadline behaves like closed gallery.
- PIN failures are rate-limited.
- Client receives a short lived gallery session token.
- Frontend stores token in localStorage per gallery.

## Photo List Flow

```mermaid
sequenceDiagram
    participant Client as Client Browser
    participant API as GET /public/galleries/:id/photos
    participant Turso as Turso Gallery DB

    Client->>API: GET photos?page=1&pageSize=50&token=...
    API->>API: Verify gallery session token
    API->>Turso: Load gallery metadata
    API->>API: Check status + deadline
    API->>Turso: Query paged gallery_photos
    API->>Turso: Query selectedDriveFileIds when needed
    API->>API: Mint photoToken per photo
    API-->>Client: photos + selected ids + gallery state
```

Frontend behavior:

- Page size is fixed at 50.
- Grid thumbnail uses backend thumbnail URL.
- Lightbox opens by `driveFileId`, not by fragile page index.
- Picked filter uses local selection state before submit, so client can review choices first.
- Browser draft stores selected ids and notes in localStorage.

## Image Delivery Flow

```mermaid
flowchart TD
    Client[Client img tag] --> ThumbEndpoint[Backend thumbnail/preview endpoint]
    ThumbEndpoint --> TokenCheck{Valid gallery token or photo token?}
    TokenCheck -->|No| Reject[401 or 404]
    TokenCheck -->|Yes| DeadlineCheck{Gallery open and not expired?}
    DeadlineCheck -->|No| Closed[Gallery expired or closed]
    DeadlineCheck -->|Yes| DriveFetch[Fetch Google Drive image]
    DriveFetch --> BrowserCache[Return image with Cache-Control]
    BrowserCache --> Client
```

Image variants:

| Variant | Endpoint | Google Drive size | Purpose |
| --- | --- | --- | --- |
| Thumbnail | `/photos/:fileId/thumbnail` | width 320 | Grid image |
| Preview | `/photos/:fileId/preview` | width 1600 | Lightbox image |
| Content | `/photos/:fileId/content` | original | Manual/original access only |

Notes:

- Thumbnail grid may be cropped visually by CSS.
- Preview keeps the original frame using width-only Drive resize.
- Browser image cache is private and long-lived while token remains valid.
- Frontend also keeps a small in-memory preview cache for smoother lightbox navigation.

## Submit Selection Flow

```mermaid
sequenceDiagram
    participant Client as Client Browser
    participant API as POST /public/galleries/:id/selections
    participant Turso as Turso Gallery DB

    Client->>API: Submit selected driveFileIds + notes
    API->>API: Verify gallery token
    API->>API: Check open status + deadline + selection limit
    API->>Turso: Load valid gallery photos
    API->>Turso: Replace gallery_selections in batch
    API->>Turso: Update selection_count
    API-->>Client: selectionCount + filenames
```

Selection rules:

- Client can revise choices and submit again.
- Submitted rows are replaced with the latest selection.
- Selection count cannot exceed gallery master limit plus approved add-on limit.
- Notes are stored per selected photo.

## Deadline Model

```mermaid
flowchart LR
    Create[Create gallery] --> Duration[selection_duration_hours]
    Duration --> Deadline[selection_deadline_at UTC]
    Deadline --> DynamicCheck[Dynamic expiry check on verify/photos/submit]
    DynamicCheck -->|Expired| Locked[Behaves like closed]
    DynamicCheck -->|Not expired| Open[Client can continue]
```

There is no cron requirement.

Every public request checks whether `selection_deadline_at` has passed. Admin UI can show expired galleries as closed. To reopen an expired gallery, admin sets a new duration/window and opens the gallery again.

## Security Layers

```mermaid
flowchart TD
    PublicURL[Public URL] --> Pin[Client PIN]
    Pin --> GalleryToken[Gallery session token]
    GalleryToken --> PhotoToken[Per-photo token]
    PhotoToken --> ImageEndpoint[Image endpoint]
    ImageEndpoint --> Drive[Google Drive]

    Deadline[Selection deadline] --> ImageEndpoint
    AccessVersion[access_version] --> GalleryToken
    AccessVersion --> PhotoToken
```

Security controls:

- Public URL alone is not enough.
- PIN unlock creates session token.
- Photo token avoids repeated DB lookup for every image when possible.
- `access_version` invalidates old tokens after sensitive updates.
- Selection deadline can shorten effective photo token lifetime.
- PIN attempt lock prevents brute force.

## Data Stores

| Store | Data |
| --- | --- |
| `galleries` | Title, public key, Drive folder, PIN hash, status, limits, deadline, counts |
| `gallery_photos` | Drive file id, filename, mime type, thumbnail link, dimensions, order |
| `gallery_selections` | Submitted drive file id, filename, note, submitted timestamp |
| `gallery_settings` | Admin WhatsApp number and message templates |
| Rate limit storage | PIN attempt lock data |
| Google Drive | Source image files and generated thumbnails/previews |

## Key Endpoints

Admin:

```text
GET    /api/galleries
POST   /api/galleries
GET    /api/galleries/:id
PATCH  /api/galleries/:id
POST   /api/galleries/:id/sync
GET    /api/galleries/:id/export.csv
GET    /api/galleries/:id/export.xlsx
```

Public client:

```text
GET    /api/public/galleries/:id/contact
POST   /api/public/galleries/:id/verify
GET    /api/public/galleries/:id/photos
GET    /api/public/galleries/:id/photos/:fileId/thumbnail
GET    /api/public/galleries/:id/photos/:fileId/preview
GET    /api/public/galleries/:id/photos/:fileId/content
POST   /api/public/galleries/:id/selections
```

## Cost And Performance Notes

- Turso stores metadata only, not binary photos.
- `photo_count` and `selection_count` avoid repeated expensive count scans.
- Public settings are cached in memory for short periods.
- Google Drive image fetch is the main image path.
- Supabase egress is not expected from Client Gallery images unless a future Supabase Storage cache is reintroduced.
- Fixed page size 50 keeps payload predictable and avoids user-driven heavy loads.

