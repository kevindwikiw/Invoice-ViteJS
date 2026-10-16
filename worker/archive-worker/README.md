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

## Limits And Tests

Configure limits in `/etc/orbit-archive-worker.env`. Defaults are 20 GiB per
ZIP, 2,000 images per job, 4 active jobs, 1 ZIP built at a time, and 12 hours
before completed ZIP files expire. The service stores temporary ZIPs under its
own `archives/` directory. A service restart cancels running jobs; clients can
retry.

Run archive tests from this folder:

```powershell
python -m unittest test_worker
```

Run the Selfie and two-process isolation tests from `worker/face-recognition`:

```powershell
python -m unittest test_worker_processes test_drive_source test_worker
```
