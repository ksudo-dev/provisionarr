#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="provisionarr"
SERVICE_USER="provisionarr"
CODE_DIR="/opt/provisionarr"
DATA_DIR="/var/lib/provisionarr"
CONFIG_DIR="/etc/provisionarr"
ENV_FILE="${CONFIG_DIR}/provisionarr.env"
UNIT_FILE="/etc/systemd/system/provisionarr.service"
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: sudo ./scripts/install-native.sh [--dry-run] [--help]

Install or upgrade Provisionarr as a loopback-only systemd service.
Dependencies are never downloaded. If production dependencies are not already
available in the npm cache, prepare them separately and run this installer again.
Existing data and configuration are preserved during upgrades.
EOF
}

log() { printf '%s\n' "[provisionarr] $*"; }
die() { printf '%s\n' "[provisionarr] ERROR: $*" >&2; exit 1; }
run() {
  if (( DRY_RUN )); then printf '%s\n' "+ $*"; else "$@"; fi
}

while (($#)); do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option: $1 (use --help)" ;;
  esac
done

if (( EUID != 0 && !DRY_RUN )); then die "run as root (for example: sudo $0)"; fi
if [[ ! -f /etc/debian_version ]]; then die "this installer supports Debian-like systems only"; fi
command -v systemctl >/dev/null || die "systemd is required"
command -v node >/dev/null || die "Node.js 22 or newer is required"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" =~ ^[0-9]+$ ]] && (( NODE_MAJOR >= 22 )) || die "Node.js 22 or newer is required (found $(node --version))"
[[ -f "$SOURCE_DIR/server.js" && -f "$SOURCE_DIR/package-lock.json" ]] || die "run this from a Provisionarr source checkout"
[[ -f "$SOURCE_DIR/packaging/systemd/provisionarr.service" ]] || die "service unit is missing"

if (( DRY_RUN )); then
  log "dry run: no files, users, packages, or services will be changed"
  printf '%s\n' "+ create system account $SERVICE_USER" "+ install code in $CODE_DIR" "+ preserve or create mode-600 config $ENV_FILE" "+ preserve data in $DATA_DIR" "+ enable and start $APP_NAME.service"
  exit 0
fi

if ! getent group "$SERVICE_USER" >/dev/null; then run groupadd --system "$SERVICE_USER"; fi
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  run useradd --system --gid "$SERVICE_USER" --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi
run install -d -m 0755 "$CODE_DIR" "$CONFIG_DIR"
run install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0700 "$DATA_DIR"
run chown "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR"

STAGE_DIR="$(mktemp -d /tmp/provisionarr-install.XXXXXX)"
cleanup() { rm -rf -- "$STAGE_DIR"; }
trap cleanup EXIT
run mkdir -p "$STAGE_DIR/app"
run cp -a "$SOURCE_DIR/." "$STAGE_DIR/app/"
run rm -rf -- "$STAGE_DIR/app/.git" "$STAGE_DIR/app/data" "$STAGE_DIR/app/logs"

if [[ ! -d "$STAGE_DIR/app/node_modules" ]]; then
  log "production dependencies are absent; attempting npm ci from the local cache only"
  run npm ci --omit=dev --offline --ignore-scripts --prefix "$STAGE_DIR/app"
fi
[[ -d "$STAGE_DIR/app/node_modules" ]] || die "production dependencies are unavailable offline"
run chown -R root:"$SERVICE_USER" "$STAGE_DIR/app"
run chmod -R u+rwX,g+rX,o-rwx "$STAGE_DIR/app"
run rm -rf -- "$CODE_DIR.previous"
if [[ -d "$CODE_DIR" && -n "$(find "$CODE_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
  run mv "$CODE_DIR" "$CODE_DIR.previous"
fi
run mv "$STAGE_DIR/app" "$CODE_DIR"
run rm -rf -- "$CODE_DIR.previous"
run install -o root -g root -m 0644 "$SOURCE_DIR/packaging/systemd/provisionarr.service" "$UNIT_FILE"

if [[ ! -e "$ENV_FILE" ]]; then
  if (( DRY_RUN )); then
    printf '%s\n' "+ create $ENV_FILE mode 600 (blank secret fields)"
  else
    install -d -m 0755 "$CONFIG_DIR"
    umask 077
    cat >"$ENV_FILE" <<'EOF'
# Provisionarr native service configuration. Keep this file mode 600.
# Set upstream URLs and API keys here; this template contains no secrets.
PROVISIONARR_HOST=127.0.0.1
PROVISIONARR_MIN_FREE_GB=50
PROVISIONARR_MIN_FREE_PERCENT=15
# Guided setup is read/preview-only unless an administrator deliberately enables writes.
PROVISIONARR_ORCHESTRATION_WRITES_ENABLED=false
# PROVISIONARR_QBIT_URL=http://127.0.0.1:8080
# PROVISIONARR_QBIT_USERNAME=
# PROVISIONARR_QBIT_PASSWORD=
# SONARR_URL=http://127.0.0.1:8989
# SONARR_API_KEY=
# RADARR_URL=http://127.0.0.1:7878
# RADARR_API_KEY=
# PROWLARR_URL=http://127.0.0.1:9696
# PROWLARR_API_KEY=
# PROVISIONARR_EMBY_URL=http://127.0.0.1:8096
# PROVISIONARR_EMBY_API_KEY=
EOF
    chmod 600 "$ENV_FILE"
  fi
else
  run chmod 600 "$ENV_FILE"
fi

run systemctl daemon-reload
run systemctl enable --now "$APP_NAME.service"
log "installed $APP_NAME at $CODE_DIR; data is preserved at $DATA_DIR"
log "edit $ENV_FILE, then run: systemctl restart $APP_NAME"
