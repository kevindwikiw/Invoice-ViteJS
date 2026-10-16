# Edited Photos UI PRD

## Scope

The public Edited Photos view serves both selection-and-delivery galleries and
delivery-only Wedding galleries. Both workflows support Selfie search over the
published edited snapshot using their existing delivery password and token.

## Header And Navigation

- Use exactly two sticky bars above the gallery content on mobile and desktop.
- Bar 1 shows the Orbit logo, `Edited Photos`, the event title, access status,
  and the theme control. The event title is not repeated above the photo grid.
- Bar 2 shows Edited Photos and Selfie in both workflows, plus All Photos in
  selection/delivery galleries. Download All remains aligned to the right.
- When folders exist, a fixed bottom bar shows the active folder in one button.
  It opens a vertically scrollable panel above the bar with root and subfolder
  links, full folder names, and a clear active state. No horizontal scrolling or
  photo counts are needed.
- At each level, show direct child folders as icon-and-name tiles before photos
  that belong directly to that level. Folder tiles do not request cover images.
  A folder view has a link to its parent; folder and photo sections are labeled
  separately only when both exist. Empty folders remain navigable.
- After Edited Photos data is ready, show a per-gallery guide once, including
  when access came from a saved token. Help reopens it. The guide explains
  folders, the bottom picker, and viewing or downloading photos, adapting when
  folders or a ZIP are absent.
- Pagination and the footer remain reachable above the bottom bar.
- Keep the same responsive alignment, type scale, and 44px control targets as
  the Photo Selection header. Long event names truncate without pushing actions
  out of view; tapping the title reveals its full name.

## Access States

- Open access shows the edited photos, folders, optional archive download, and
  remaining access time.
- Draft, closed, and expired access never expose stale private thumbnails or
  download controls. Show a clear unavailable or expired message and Check again.
- When Edited Photos access expires, the Edited Photos view control becomes
  visibly muted and labeled Expired, like an unavailable Submitted option.
  Wedding uses the same muted access state; Selfie also requires open access.
- Expiry while the page is open must update the UI at the deadline and refresh
  server status. Reopening requires a new valid publication; the client must
  not extend access locally.

## Acceptance

- Both gallery workflows use the same two-bar hierarchy at 320px, 390px, and
  desktop widths in light and dark modes.
- No overlap, horizontal overflow, duplicate visible title, or inaccessible
  icon-only controls.
- Expired access removes photos and download actions from the visible UI even
  when the browser previously cached the gallery response.
- Deep links to an expired Edited Photos view explain why access is unavailable.
- Existing password, photo, folder, preview, and download behavior remains
  unchanged while access is open.
- Folder links preserve URL state, reset the edited page to 1, and remain usable
  at 320px and larger viewport widths.
- A root containing only folders does not show a no-photos message. The guide
  requires no extra media request or loading state and supports Escape, focus,
  and reduced-motion preferences.

## Sync After Publication

- Save updates the Edited Photos Drive folder or ZIP source but does not change
  the existing public photo snapshot. The admin sees that Sync is still needed.
- Sync validates the new Drive tree and ZIP, then atomically replaces the
  published photo, folder, comparison, and archive snapshot. A failed Sync
  leaves the previous snapshot intact.
- Sync preserves the current password, publication time, access status, token
  version, and access expiry. It does not reopen an expired or closed gallery.
- Before the first Publish, Sync only validates the source and reports that a
  password and Publish are still required.

## Selfie Search

- The existing Selfie button follows its source view: Selection searches raw
  photos; Edited Photos and Wedding search all published edited folders.
- `view=selfie&selfieSource=edited|selection` records the context. Edited search
  uses `selfiePage`; folder and `editedPage` remain unchanged for returning.
- Results are a flat grid with folder paths, 54 photos per page, the delivery
  lightbox, and individual download actions. The folder picker is hidden in
  Selfie view. Download All always downloads the complete gallery archive.
- Matching photo IDs are cached in memory per gallery/token and source version,
  allowing Edited/Selfie navigation without another upload. Reload asks for a
  new selfie; a changed snapshot invalidates the previous results.
- If search finishes against a newer snapshot than the browser has loaded,
  refresh gallery metadata before enabling Show photos. Cancellation discards
  late results instead of navigating back into Selfie.
- Edited source fingerprints use file IDs and checksums or Drive file versions.
  Per-photo versioned image URLs avoid reusing an old thumbnail after Sync.
- Publish and published Sync prepare the edited index in the background. An
  unchanged source reuses its index; changes cancel outdated edited jobs.
  Unpublish removes edited jobs and embeddings while preserving Selection.
- SQLite/Turso initialization upgrades legacy indexes to `source_scope=selection`
  and adds scoped uniqueness for embeddings and indexed-photo metadata. Each
  source has its own fingerprint, active jobs, cache reuse, and callback checks.
- Worker requests retain their current protocol: globally unique job IDs
  distinguish Selection and Edited snapshots, including zero-face snapshots.
- `GET /public/galleries/:id/edit-results/face-search/status` and `POST` to
  `/edit-results/face-search` require Edited access, enforce body/rate limits,
  and recheck access and source before returning matching edited photo metadata.
- The existing modal handles camera/upload, sensitivity, solo-only, indexing,
  cancellation, retry, empty matches, focus, Escape, and reduced motion.
- Release the updated API across instances before enabling Edited search clients;
  legacy API callback handlers do not understand the new index scopes. Existing
  galleries prepare their first edited index on demand or their next Sync.
