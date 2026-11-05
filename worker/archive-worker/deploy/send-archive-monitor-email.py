#!/usr/bin/env python3
"""Send a monitor notification using an SMTP server with STARTTLS."""

from __future__ import annotations

import os
import smtplib
import sys
import ssl
from email.message import EmailMessage


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: orbit-archive-monitor-email SUBJECT", file=sys.stderr)
        return 2

    host = os.getenv("ORBIT_ARCHIVE_SMTP_HOST", "smtp.gmail.com").strip()
    port = int(os.getenv("ORBIT_ARCHIVE_SMTP_PORT", "587"))
    username = os.getenv("ORBIT_ARCHIVE_SMTP_USERNAME", "").strip()
    password = os.getenv("ORBIT_ARCHIVE_SMTP_PASSWORD", "")
    sender = os.getenv("ORBIT_ARCHIVE_SMTP_FROM", username).strip()
    recipient = os.getenv("ORBIT_ARCHIVE_ALERT_TO", "").strip()

    if not all((host, username, password, sender, recipient)):
        print("SMTP host, username, password, sender, and recipient are required", file=sys.stderr)
        return 2

    message = EmailMessage()
    message["Subject"] = sys.argv[1]
    message["From"] = sender
    message["To"] = recipient
    message.set_content(sys.stdin.read())

    try:
        with smtplib.SMTP(host, port, timeout=15) as client:
            client.ehlo()
            client.starttls(context=ssl.create_default_context())
            client.ehlo()
            client.login(username, password)
            client.send_message(message)
    except (OSError, smtplib.SMTPException) as error:
        print(f"SMTP notification failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
