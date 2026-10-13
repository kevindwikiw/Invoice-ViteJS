# Edited Photos UI PRD

## Scope

The public Edited Photos view serves both selection-and-delivery galleries and
delivery-only Wedding galleries. This phase aligns the client UI; it does not
change publication, password, token, expiry, or download APIs.

## Header And Navigation

- Use exactly two sticky bars above the gallery content on mobile and desktop.
- Bar 1 shows the Orbit logo, `Edited Photos`, the event title, access status,
  and the theme control. The event title is not repeated above the photo grid.
- Bar 2 shows gallery view controls where other views exist. Wedding has only an
  Edited Photos label, not a tab for a view that cannot change. Download All is
  aligned to the right when an archive is available.
- When folders exist, a fixed bottom bar shows root and subfolder links directly
  in a horizontally scrollable row. Each link has a folder icon, and the active
  folder has a clear underline; opening a menu is not required to switch folders.
- Pagination and the footer remain reachable above the bottom bar.
- Keep the same responsive alignment, type scale, and 44px control targets as
  the Photo Selection header. Long event names truncate without pushing actions
  out of view.

## Access States

- Open access shows the edited photos, folders, optional archive download, and
  remaining access time.
- Draft, closed, and expired access never expose stale private thumbnails or
  download controls. Show a clear unavailable or expired message and Check again.
- When Edited Photos access expires, the Edited Photos view control becomes
  visibly muted and labeled Expired, like an unavailable Submitted option.
  Wedding uses the same muted access state without adding a fake tab.
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
