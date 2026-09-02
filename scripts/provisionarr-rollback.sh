#!/usr/bin/env bash
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=${PROVISIONARR_PROJECT_DIR:-$(dirname -- "$SCRIPT_DIR")}
ROLLBACK_DIR=${PROVISIONARR_ROLLBACK_DIR:-"$HOME/.provisionarr-rollbacks"}
RELEASE_ROOT=${PROVISIONARR_RELEASE_ROOT:-"$HOME/.provisionarr-release"}
DEPLOYED_PROJECT_DIR="$RELEASE_ROOT/current/provisionarr"
PREVIOUS_FILE="$RELEASE_ROOT/previous-snapshot"
BASE_COMPOSE_FILE=${PROVISIONARR_BASE_COMPOSE_FILE:-"$PROJECT_DIR/compose.yaml"}
COMPOSE_FILE=${PROVISIONARR_COMPOSE_FILE:-}
SNAPSHOT_SCRIPT="$PROJECT_DIR/scripts/provisionarr-snapshot.sh"

usage() {
  printf '%s\n' "Usage: $0 [--dry-run] [--yes] SNAPSHOT.tar.gz"
  printf '%s\n' "       $0 --dry-run --latest"
  printf '%s\n' "       $0 --yes --previous"
}

dry_run=false
assume_yes=false
selected=
latest=false
previous=false
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --yes) assume_yes=true ;;
    --latest) latest=true ;;
    --previous) previous=true ;;
    --help|-h) usage; exit 0 ;;
    --*) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
    *) [ -z "$selected" ] || { printf '%s\n' 'Specify only one snapshot.' >&2; exit 2; }; selected=$1 ;;
  esac
  shift
done

if [ "$previous" = true ]; then
  [ "$latest" = false ] && [ -z "$selected" ] || { printf '%s\n' 'Do not combine --previous with another selection.' >&2; exit 2; }
  [ -f "$PREVIOUS_FILE" ] || { printf '%s\n' 'No previous deployment is registered.' >&2; exit 1; }
  selected=$(sed -n '1p' "$PREVIOUS_FILE")
elif [ "$latest" = true ]; then
  [ -z "$selected" ] || { printf '%s\n' 'Do not combine --latest with a path.' >&2; exit 2; }
  selected=$(find "$ROLLBACK_DIR" -maxdepth 1 -type f -name 'provisionarr-*.tar.gz' -printf '%T@ %p\n' 2>/dev/null | sort -nr | sed -n '1s/^[^ ]* //p')
fi
[ -n "$selected" ] || { printf '%s\n' 'A snapshot path or --latest is required.' >&2; usage >&2; exit 2; }
[ -f "$BASE_COMPOSE_FILE" ] || { printf 'Base compose file missing: %s\n' "$BASE_COMPOSE_FILE" >&2; exit 1; }
[ -z "$COMPOSE_FILE" ] || [ -f "$COMPOSE_FILE" ] || { printf 'Compose override missing: %s\n' "$COMPOSE_FILE" >&2; exit 1; }

compose_up() {
  if [ -n "$COMPOSE_FILE" ]; then
    docker compose -f "$BASE_COMPOSE_FILE" -f "$COMPOSE_FILE" up -d --no-deps --force-recreate provisionarr
  else
    docker compose -f "$BASE_COMPOSE_FILE" up -d --no-deps --force-recreate provisionarr
  fi
}

wait_for_bootstrap() {
  attempts=0
  while [ "$attempts" -lt 30 ]; do
    if curl --fail --silent --show-error --max-time 3 http://127.0.0.1:3000/api/bootstrap >/dev/null 2>&1; then return 0; fi
    attempts=$((attempts + 1))
    sleep 1
  done
  printf '%s\n' 'Provisionarr did not become ready within 30 seconds.' >&2
  return 1
}
case "$selected" in
  /*) archive=$selected ;;
  *) archive="$ROLLBACK_DIR/$selected" ;;
esac
[ -f "$archive" ] || { printf 'Snapshot not found: %s\n' "$archive" >&2; exit 1; }
archive_real=$(realpath -e "$archive")
rollback_real=$(realpath -e "$ROLLBACK_DIR")
case "$archive_real" in
  "$rollback_real"/*.tar.gz) ;;
  *) printf '%s\n' 'Snapshot must be inside the rollback directory.' >&2; exit 2 ;;
esac

validate_archive() {
  printf '%s\n' 'Validating snapshot paths...'
  while IFS= read -r entry; do
    case "$entry" in
      /*|*../*|../*|*'/..'|*'//'*) printf 'Unsafe archive path: %s\n' "$entry" >&2; return 1 ;;
      provisionarr|provisionarr/*) ;;
      *) printf 'Unexpected archive path: %s\n' "$entry" >&2; return 1 ;;
    esac
  done <<EOF
$(tar -tzf "$archive")
EOF
  tar -tvzf "$archive" | awk 'substr($0,1,1) ~ /[lh]/ { print "Links are not allowed: " $0 > "/dev/stderr"; bad=1 } END { exit bad }'
  tar -tzf "$archive" | grep -q '^provisionarr/' || { printf '%s\n' 'Snapshot is missing project code.' >&2; return 1; }
}

validate_archive
printf 'Selected: %s\n' "$archive"
printf '%s\n' 'A pre-rollback safety snapshot will be created.'
printf '%s\n' 'The external Provisionarr data directory will be preserved.'
if [ "$assume_yes" = false ] && [ "$dry_run" = false ]; then
  printf '%s' 'Rollback now? [y/N] '
  read -r answer
  [ "$answer" = y ] || [ "$answer" = Y ] || { printf '%s\n' 'Cancelled.'; exit 0; }
fi

if [ "$dry_run" = true ]; then
  "$SNAPSHOT_SCRIPT" --dry-run pre-rollback
  printf '%s\n' 'DRY RUN: extract to private staging, restore code and compose, restart arr-home, verify bootstrap.'
  exit 0
fi

"$SNAPSHOT_SCRIPT" pre-rollback
staging=$(mktemp -d /tmp/provisionarr-rollback.XXXXXX)
cleanup() { rm -rf "$staging"; }
trap cleanup EXIT
tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$staging"
rsync -a --delete --exclude='.git' --exclude='node_modules' --exclude='test-results' "$staging/provisionarr/" "$PROJECT_DIR/"
compose_up
wait_for_bootstrap
install -d -m 700 "$RELEASE_ROOT/current"
install -d -m 700 "$DEPLOYED_PROJECT_DIR"
rsync -a --delete --exclude='.git' --exclude='node_modules' --exclude='test-results' "$PROJECT_DIR/" "$DEPLOYED_PROJECT_DIR/"
printf '%s\n' 'Rollback complete: Provisionarr is responding.'
