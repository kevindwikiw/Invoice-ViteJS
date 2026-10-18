#!/usr/bin/env bash
set -u

archive_dir=/opt/orbit-archive-worker/archives
min_free_bytes=5368709120
state_dir=/var/lib/orbit-archive-monitor
state_file="$state_dir/last-nrestarts"
failed=0

alert() {
    logger -p daemon.warning -t orbit-archive-monitor -- "$1"
    failed=1
}

mount_target="$(findmnt -n -o TARGET --target "$archive_dir" 2>/dev/null || true)"
if [[ "$mount_target" != "$archive_dir" ]]; then
    alert "archive volume is not mounted at $archive_dir (found: ${mount_target:-none})"
fi

if [[ -d "$archive_dir" ]]; then
    free_bytes="$(df -B1 --output=avail "$archive_dir" 2>/dev/null | awk 'NR == 2 { print $1 }' || true)"
    if [[ "$free_bytes" =~ ^[0-9]+$ ]] && (( free_bytes < min_free_bytes )); then
        alert "archive volume has less than 5 GiB free (${free_bytes} bytes)"
    elif [[ ! "$free_bytes" =~ ^[0-9]+$ ]]; then
        alert "could not read free space for $archive_dir"
    fi
else
    alert "archive directory is missing: $archive_dir"
fi

if ! systemctl is-active --quiet orbit-archive-worker.service; then
    alert "orbit-archive-worker.service is not active"
fi

restarts="$(systemctl show orbit-archive-worker.service -p NRestarts --value 2>/dev/null || true)"
if [[ "$restarts" =~ ^[0-9]+$ ]]; then
    install -d -m 0750 "$state_dir"
    previous="$(cat "$state_file" 2>/dev/null || true)"
    if [[ "$previous" =~ ^[0-9]+$ ]] && (( restarts > previous )); then
        alert "archive worker restart count increased from $previous to $restarts"
    fi
    printf '%s\n' "$restarts" > "$state_file"
fi

if (( failed )); then
    exit 1
fi
