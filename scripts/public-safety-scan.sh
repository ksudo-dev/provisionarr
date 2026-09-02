#!/usr/bin/env bash
set -eu

ROOT=$(git rev-parse --show-toplevel)
GIT_COMMON=$(git rev-parse --path-format=absolute --git-common-dir)
GITLEAKS_IMAGE="zricethezav/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"

cd "$ROOT"

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git "$ROOT" --redact --no-banner
  gitleaks dir "$ROOT" --redact --no-banner
elif command -v docker >/dev/null 2>&1; then
  docker image inspect "$GITLEAKS_IMAGE" >/dev/null 2>&1 || docker pull -q "$GITLEAKS_IMAGE" >/dev/null
  docker run --rm --volume "$ROOT:$ROOT:ro" --volume "$GIT_COMMON:$GIT_COMMON:ro" "$GITLEAKS_IMAGE" git "$ROOT" --redact --no-banner
  docker run --rm --volume "$ROOT:/repo:ro" "$GITLEAKS_IMAGE" dir /repo --redact --no-banner
else
  printf '%s\n' 'Public-safety scan requires Gitleaks or Docker.' >&2
  exit 1
fi

node "$ROOT/scripts/public-data-scan.mjs"
printf '%s\n' 'Public-safety scan passed.'
