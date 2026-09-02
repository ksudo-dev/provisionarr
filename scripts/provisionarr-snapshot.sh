#!/usr/bin/env bash
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=${PROVISIONARR_PROJECT_DIR:-$(dirname -- "$SCRIPT_DIR")}
RELEASE_ROOT=${PROVISIONARR_RELEASE_ROOT:-"$HOME/.provisionarr-release"}
DEPLOYED_PROJECT_DIR=${PROVISIONARR_DEPLOYED_PROJECT_DIR:-"$RELEASE_ROOT/current/provisionarr"}
ROLLBACK_DIR=${PROVISIONARR_ROLLBACK_DIR:-"$HOME/.provisionarr-rollbacks"}

usage() {
  printf '%s\n' "Usage: $0 [--dry-run] [--deployed] [label]"
}

dry_run=false
deployed=false
label=manual
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --deployed) deployed=true ;;
    --help|-h) usage; exit 0 ;;
    --*) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
    *) label=$1 ;;
  esac
  shift
done

case "$label" in
  *[!A-Za-z0-9._-]*) printf '%s\n' 'Invalid snapshot label.' >&2; exit 2 ;;
esac
source_project=$PROJECT_DIR
[ "$deployed" = false ] || source_project=$DEPLOYED_PROJECT_DIR
[ -d "$source_project" ] || { printf '%s\n' 'Project source is missing.' >&2; exit 1; }

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="$ROLLBACK_DIR/provisionarr-${timestamp}-${label}.tar.gz"
printf '%s\n' 'Provisionarr snapshot'
printf '  Archive: %s\n' "$archive"
printf '  Source: %s\n' "$source_project"
printf '%s\n' '  Includes: project code and its standalone Compose file'
printf '%s\n' '  Excludes: .git, node_modules, test-results, and ARR data'

if [ "$dry_run" = true ]; then
  printf '%s\n' 'DRY RUN: no snapshot was written.'
  exit 0
fi

umask 077
install -d -m 700 "$ROLLBACK_DIR"
chmod 700 "$ROLLBACK_DIR"
tar -czf "$archive" --exclude=provisionarr/.git --exclude=provisionarr/node_modules --exclude=provisionarr/test-results -C "$(dirname "$source_project")" provisionarr
chmod 600 "$archive"
sha256sum "$archive" > "$archive.sha256"
chmod 600 "$archive.sha256"
printf 'Created: %s\n' "$archive"
