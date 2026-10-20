# Orbit Archive Worker

This folder contains the independent Edited Photos folder ZIP service. It runs
on port `8089`; Selfie continues to run from `worker/face-recognition` on port
`8088`. The archive app has its own Python environment, settings and service.
The Drive downloader is shared from `worker/shared/drive_source.py`.

## Local Windows

Open a separate terminal in `worker/archive-worker`:

```powershell
.\setup-windows.ps1
Copy-Item .env.example .env
```

Set `FACE_ARCHIVE_WORKER_TOKEN` to a new local token,
`FACE_ARCHIVE_WORKER_CALLBACK_ORIGIN=http://127.0.0.1:3000`, and
`FACE_ARCHIVE_WORKER_CALLBACK_TOKEN` to the local server's
`FACE_WORKER_INTERNAL_TOKEN`. Set `FACE_ARCHIVE_WORKER_DIR=archives`.
Configure the server's `FACE_ARCHIVE_WORKER_URL=http://127.0.0.1:8089`, plus
the same archive token. Start the service:

```powershell
.\run-worker.ps1
```

Selfie runs in its own terminal from `worker/face-recognition` with
`.\run-worker.ps1` on port `8088`.

## Ubuntu

Run from this directory after updating the worker source files on the VM:

```bash
bash deploy/setup-ubuntu.sh
sudo install -m 0600 .env.example /etc/orbit-archive-worker.env
sudoedit /etc/orbit-archive-worker.env
sudo systemctl daemon-reload
sudo systemctl enable --now orbit-archive-worker
sudo systemctl enable --now orbit-archive-monitor.timer
```

Create the environment file only for the initial install. Set the archive token
to a new value and set `FACE_ARCHIVE_WORKER_CALLBACK_TOKEN` to Fly's existing
`FACE_WORKER_INTERNAL_TOKEN`. The callback origin should be the Hono API origin.
The archive service obtains short-lived Drive credentials through that API.

For later code updates, rerun `bash deploy/setup-ubuntu.sh`, then restart only
the ZIP service:

```bash
sudo systemctl daemon-reload
sudo systemctl restart orbit-archive-worker
```

Verify both local listeners:

```bash
sudo systemctl status orbit-face-worker orbit-archive-worker
curl --fail http://127.0.0.1:8088/healthz
curl --fail http://127.0.0.1:8089/healthz
```

## Fly And HTTPS

Set these Fly secrets to the HTTPS reverse proxy host and the matching archive
token on Ubuntu:

```dotenv
FACE_ARCHIVE_WORKER_URL=https://your-worker-host.example
FACE_ARCHIVE_WORKER_PUBLIC_URL=https://your-worker-host.example
FACE_ARCHIVE_WORKER_TOKEN=the-same-archive-token-as-ubuntu
```

The Fly server uses the archive URL for job creation and status. The browser
downloads the finished ZIP directly through the public URL. Both values use the
same host here; do not use the Selfie worker URL or token.

Add `deploy/nginx-location.conf` inside the existing HTTPS Nginx server block.
It routes `/v1/archive/*` to `127.0.0.1:8089`, leaves buffering off for file
downloads and disables access logs because download tickets are in the query
string. Do not expose port `8089` directly to the Internet.

Edited Photos downloads use `scope=direct`: root downloads include only root
photos, and folder downloads include only photos directly in that folder, with
files at the ZIP root. The API retains subtree scope for legacy callers, but
the gallery UI does not offer recursive downloads.

After expanding the mounted archive volume and verifying free space, enable
`FACE_ARCHIVE_PREBUILD_ENABLED=1` on Fly. Publishing or syncing Edited Photos
then queues one flat ZIP for root photos and one for each folder with direct
photos.
For a production pilot, also set `FACE_ARCHIVE_PREBUILD_GALLERY_IDS` to one
comma-separated gallery ID, for example `123`. With this allowlist configured,
only that gallery is prebuilt; omit the allowlist after the pilot to enable all
galleries. A successful Drive Sync is required first so every image has a known
size.
The admin Edited Photos panel shows how many ZIPs are ready and offers a retry
button. Existing galleries can be queued with that retry button. Share a new
gallery only after the panel reports all ZIPs ready; publishing queues the work
but does not wait for large Drive downloads to finish.

The worker stores job manifests and finished ZIPs on the archive volume, so a
service restart resumes unfinished jobs and retains completed ZIPs. Prebuilt
ZIPs live until the Edited Photos access expiry or 30 days, whichever comes
first. The cache limit defaults to 80 GiB and leaves at least 5 GiB free;
older completed ZIPs may be evicted when space is needed. When a prebuilt ZIP
is unavailable, the normal on-demand download path still works. Customer-
requested ZIPs expire seven days after becoming ready if nobody downloads them.
The first valid download starts their six-hour retention window; later downloads
do not extend it. Download tickets still expire after 15 minutes. Prebuilt ZIPs
remain available until the Edited Photos access expiry or the prebuild TTL,
whichever comes first.

Prebuild estimates use each Drive file's size plus a 64 KiB per-entry ZIP
overhead allowance. Each photo is included only in the ZIP for its own level.
The worker rejects unknown sizes and jobs whose estimate exceeds safe disk/cache
capacity. Existing galleries need a successful Sync to populate file sizes. The
admin status shows estimated and currently available storage before retrying.
The worker also stores each gallery's active snapshot in
`gallery-snapshots.json`; unpublish and Sync revoke old jobs/tickets before
replacing that snapshot. Keep this file on the mounted archive volume.

The Ubuntu setup also installs a five-minute systemd monitor. It checks that
the archive volume is mounted, that at least 5 GiB remains free, and that the
worker stays active; new service restarts and unhealthy states are recorded in
the system journal under `orbit-archive-monitor`. This is local monitoring,
not an external notification channel.

## Limits And Tests

Configure limits in `/etc/orbit-archive-worker.env`. Defaults are 20 GiB per
ZIP, 2,000 images per job, 4 active jobs, 1 ZIP built at a time, and 6 hours
before customer-requested ZIP files expire. The service stores ZIPs and job
metadata under its own `archives/` directory. A background sweep removes
expired ZIPs once per minute. Startup removes orphaned files but preserves
valid jobs and the filesystem's `lost+found` directory.

Run archive tests from this folder:

```powershell
python -m unittest test_worker
```

Run the Selfie and two-process isolation tests from `worker/face-recognition`:

```powershell
python -m unittest test_worker_processes test_drive_source test_worker
```
