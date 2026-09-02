#!/usr/bin/env bash
set -Eeuo pipefail

CODE_DIR="/opt/provisionarr"
DATA_DIR="/var/lib/provisionarr"
CONFIG_DIR="/etc/provisionarr"
UNIT_FILE="/etc/systemd/system/provisionarr.service"
PURGE=0
YES=0
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: sudo ./scripts/uninstall-native.sh [--purge --yes] [--dry-run] [--help]

Remove the Provisionarr native service and code. Data and configuration remain
untouched by default. --purge --yes additionally removes /var/lib/provisionarr
and /etc/provisionarr; this is irreversible.
EOF
}
die() { printf '%s\n' "[provisionarr] ERROR: $*" >&2; exit 1; }
run() { if (( DRY_RUN )); then printf '%s\n' "+ $*"; else "$@"; fi; }

while (($#)); do
  case "$1" in
    --purge) PURGE=1; shift ;;
    --yes) YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option: $1 (use --help)" ;;
  esac
done
if (( EUID != 0 && !DRY_RUN )); then die "run as root (for example: sudo $0)"; fi
if (( PURGE && !YES )); then die "--purge requires --yes; data deletion is irreversible"; fi
command -v systemctl >/dev/null || die "systemd is required"

run systemctl disable --now provisionarr.service
run rm -f -- "$UNIT_FILE"
run systemctl daemon-reload
run rm -rf -- "$CODE_DIR"
if (( PURGE )); then
  run rm -rf -- "$DATA_DIR" "$CONFIG_DIR"
  if (( !DRY_RUN )); then
    if id -u provisionarr >/dev/null 2>&1; then userdel provisionarr; fi
    if getent group provisionarr >/dev/null; then groupdel provisionarr; fi
  fi
else
  printf '%s\n' "[provisionarr] preserved data: $DATA_DIR" "[provisionarr] preserved configuration: $CONFIG_DIR"
fi
printf '%s\n' "[provisionarr] native service and code removed"
