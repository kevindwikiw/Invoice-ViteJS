"""Generate a production JWT secret without putting it in source control.

Usage:
  python scripts/generate-jwt-secret.py
  python scripts/generate-jwt-secret.py --set-fly --app invoice-web-v2
"""

from __future__ import annotations

import argparse
import secrets
import shutil
import subprocess
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", default="invoice-web-v2", help="Fly app name")
    parser.add_argument(
        "--set-fly",
        action="store_true",
        help="Set JWT_SECRET directly with the authenticated fly CLI",
    )
    args = parser.parse_args()

    # 32 random bytes encoded as hex = 64 unpredictable ASCII characters.
    jwt_secret = secrets.token_hex(32)

    if not args.set_fly:
        print(f"JWT_SECRET={jwt_secret}")
        print("Copy this value to Fly Secrets; do not commit or share it.", file=sys.stderr)
        return 0

    fly_cli = shutil.which("fly") or shutil.which("flyctl")
    if not fly_cli:
        print("Fly CLI not found. Run without --set-fly and copy the generated value manually.", file=sys.stderr)
        return 1

    result = subprocess.run(
        [fly_cli, "secrets", "set", f"JWT_SECRET={jwt_secret}", "-a", args.app],
        check=False,
    )
    if result.returncode == 0:
        print(f"JWT_SECRET set for Fly app {args.app}.")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
