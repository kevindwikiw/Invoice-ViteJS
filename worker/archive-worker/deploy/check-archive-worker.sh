#!/usr/bin/env bash
set -u

archive_dir=/opt/orbit-archive-worker/archives
min_free_bytes=5368709120
state_dir=/var/lib/orbit-archive-monitor
state_file="$state_dir/last-nrestarts"
alert_state_file="$state_dir/alert-state"
notifier=/usr/local/sbin/orbit-archive-monitor-email
failed=0
alert_messages=""

alert() {
    logger -p daemon.warning -t orbit-archive-monitor -- "$1"
    alert_messages+="- $1"$'\n'
    failed=1
}

send_notification() {
    local subject="$1"
    local body="$2"
    if [[ -z "${ORBIT_ARCHIVE_ALERT_TO:-}" ]]; then
        logger -p daemon.notice -t orbit-archive-monitor -- "Email alert not configured; skipped: $subject"
        return 0
    fi
    if [[ ! -x "$notifier" ]]; then
        logger -p daemon.err -t orbit-archive-monitor -- "Email notifier is missing: $notifier"
        return 1
    fi
    if ! printf '%s\n' "$body" | "$notifier" "$subject"; then
        logger -p daemon.err -t orbit-archive-monitor -- "Could not send email notification: $subject"
        return 1
    fi
    logger -p daemon.notice -t orbit-archive-monitor -- "Email notification sent: $subject"
}

install -d -m 0750 "$state_dir"

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

if ! curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8089/healthz >/dev/null 2>&1; then
    alert "archive worker health endpoint is not responding at 127.0.0.1:8089/healthz"
fi

tunnel_service="${ORBIT_ARCHIVE_TUNNEL_SERVICE:-cloudflared.service}"
if ! systemctl is-active --quiet "$tunnel_service"; then
    alert "$tunnel_service is not active"
fi

tunnel_health_url="${ORBIT_ARCHIVE_TUNNEL_HEALTH_URL:-}"
if [[ -n "$tunnel_health_url" ]] && ! curl --fail --silent --show-error --max-time 15 "$tunnel_health_url" >/dev/null 2>&1; then
    alert "archive tunnel health check failed for $tunnel_health_url"
fi

restarts="$(systemctl show orbit-archive-worker.service -p NRestarts --value 2>/dev/null || true)"
if [[ "$restarts" =~ ^[0-9]+$ ]]; then
    previous="$(cat "$state_file" 2>/dev/null || true)"
    if [[ "$previous" =~ ^[0-9]+$ ]] && (( restarts > previous )); then
        alert "archive worker restart count increased from $previous to $restarts"
    fi
    printf '%s\n' "$restarts" > "$state_file"
fi

previous_alert_state="$(cat "$alert_state_file" 2>/dev/null || true)"
if (( failed )); then
    if [[ "$previous_alert_state" != "failed" ]]; then
        failure_body="$(printf 'Archive worker monitoring detected a problem on %s at %s:\n\n%s\nCheck: sudo journalctl -t orbit-archive-monitor -n 50 --no-pager' "$(hostname)" "$(date --iso-8601=seconds)" "$alert_messages")"
        send_notification "[Orbit] Archive worker alert on $(hostname)" \
            "$failure_body"
    fi
    printf '%s\n' failed > "$alert_state_file"
    exit 1
fi

if [[ "$previous_alert_state" == "failed" ]]; then
    send_notification "[Orbit] Archive worker recovered on $(hostname)" \
        "All archive worker, disk, and configured tunnel health checks passed on $(hostname) at $(date --iso-8601=seconds)."
fi
printf '%s\n' healthy > "$alert_state_file"
