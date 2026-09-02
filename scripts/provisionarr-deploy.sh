#!/usr/bin/env bash
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=${PROVISIONARR_PROJECT_DIR:-$(dirname -- "$SCRIPT_DIR")}
RELEASE_ROOT=${PROVISIONARR_RELEASE_ROOT:-"$HOME/.provisionarr-release"}
ROLLBACK_DIR=${PROVISIONARR_ROLLBACK_DIR:-"$HOME/.provisionarr-rollbacks"}
DEPLOYED_PROJECT_DIR="$RELEASE_ROOT/current/provisionarr"
PREVIOUS_FILE="$RELEASE_ROOT/previous-snapshot"
BASE_COMPOSE_FILE=${PROVISIONARR_BASE_COMPOSE_FILE:-"$PROJECT_DIR/compose.yaml"}
COMPOSE_FILE=${PROVISIONARR_COMPOSE_FILE:-}
SNAPSHOT_SCRIPT="$PROJECT_DIR/scripts/provisionarr-snapshot.sh"

usage() {
  printf '%s\n' "Usage: $0 [--dry-run] [--yes] [--previous SNAPSHOT.tar.gz]"
}

dry_run=false
assume_yes=false
previous=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --yes) assume_yes=true ;;
    --previous) shift; [ "$#" -gt 0 ] || { printf '%s\n' '--previous requires a snapshot path.' >&2; exit 2; }; previous=$1 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[ -x "$SNAPSHOT_SCRIPT" ] || { printf 'Snapshot tool missing: %s\n' "$SNAPSHOT_SCRIPT" >&2; exit 1; }
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

printf '%s\n' 'Provisionarr deploy'
printf '%s\n' '  The previously deployed release will be registered for one-click rollback.'
printf '%s\n' '  Only Provisionarr will be recreated; application data is preserved.'
if [ "$assume_yes" = false ] && [ "$dry_run" = false ]; then
  printf '%s' 'Continue? [y/N] '
  read -r answer
  [ "$answer" = y ] || [ "$answer" = Y ] || { printf '%s\n' 'Cancelled.'; exit 0; }
fi

if [ "$dry_run" = true ]; then
  if [ -n "$previous" ]; then
    printf 'DRY RUN: use explicit previous snapshot %s\n' "$previous"
  elif [ -d "$DEPLOYED_PROJECT_DIR" ]; then
    "$SNAPSHOT_SCRIPT" --dry-run --deployed previous
  else
    printf '%s\n' 'DRY RUN: no deployed-release mirror exists; --previous is required for the first deployment.'
  fi
  printf '%s\n' 'DRY RUN: recreate only the Provisionarr service from the configured Compose files.'
  printf '%s\n' 'DRY RUN: verify http://127.0.0.1:3000/api/bootstrap'
  exit 0
fi

install -d -m 700 "$RELEASE_ROOT"
if [ -n "$previous" ]; then
  previous=$(realpath -e "$previous")
  rollback_root=$(realpath -e "$ROLLBACK_DIR")
  case "$previous" in "$rollback_root"/*.tar.gz) ;; *) printf '%s\n' 'Previous snapshot must be inside the rollback directory.' >&2; exit 2 ;; esac
elif [ -d "$DEPLOYED_PROJECT_DIR" ]; then
  previous=$("$SNAPSHOT_SCRIPT" --deployed previous | tee /dev/stderr | sed -n 's/^Created: //p')
else
  printf '%s\n' 'First deployment requires --previous with a known-good snapshot.' >&2
  exit 2
fi
printf '%s\n' "$previous" > "$PREVIOUS_FILE"
chmod 600 "$PREVIOUS_FILE"
compose_up
wait_for_bootstrap
install -d -m 700 "$RELEASE_ROOT/current"
install -d -m 700 "$DEPLOYED_PROJECT_DIR"
rsync -a --delete --exclude='.git' --exclude='node_modules' --exclude='test-results' "$PROJECT_DIR/" "$DEPLOYED_PROJECT_DIR/"
printf '%s\n' 'Deploy complete: Provisionarr is responding.'
printf 'One-click rollback: %s --yes --previous\n' "$PROJECT_DIR/scripts/provisionarr-rollback.sh"
