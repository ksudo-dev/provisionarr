#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
project_dir=$(dirname -- "$script_dir")
baseline_ref=${PROVISIONARR_UPGRADE_BASELINE:-f74fcbd}
baseline_sha=$(git -C "$project_dir" rev-parse "$baseline_ref^{commit}")
current_sha=$(git -C "$project_dir" rev-parse HEAD)
git -C "$project_dir" merge-base --is-ancestor "$baseline_sha" "$current_sha" || {
  printf 'Upgrade baseline is not an ancestor of the current commit.\n' >&2
  exit 1
}

work=$(mktemp -d /tmp/provisionarr-upgrade.XXXXXX)
name="provisionarr-upgrade-$$-$RANDOM"
baseline_image="provisionarr-upgrade-baseline:$name"
current_image="provisionarr-upgrade-current:$name"
container_id=''
cleanup() {
  if [ -n "$container_id" ]; then docker rm -f "$container_id" >/dev/null 2>&1 || true; fi
  docker image rm "$baseline_image" "$current_image" >/dev/null 2>&1 || true
  rm -rf -- "$work"
}
trap cleanup EXIT

mkdir -p "$work/baseline" "$work/data"
chmod 700 "$work" "$work/data"
git -C "$project_dir" archive "$baseline_sha" | tar -x -C "$work/baseline"

port=''
for attempt in $(seq 1 100); do
  candidate=$((30000 + RANDOM % 20000))
  if ! (echo >/dev/tcp/127.0.0.1/"$candidate") >/dev/null 2>&1; then
    port=$candidate
    break
  fi
done
[ -n "$port" ] || { printf 'No unused loopback port was found.\n' >&2; exit 1; }
export UPGRADE_APP_URL="http://127.0.0.1:$port"
export UPGRADE_DATA_ROOT="$work/data"

printf 'Building isolated baseline and current Provisionarr images.\n'
docker build --quiet --tag "$baseline_image" "$work/baseline" >/dev/null
docker build --quiet --tag "$current_image" "$project_dir" >/dev/null
baseline_image_id=$(docker image inspect "$baseline_image" --format '{{.Id}}')
current_image_id=$(docker image inspect "$current_image" --format '{{.Id}}')

wait_for_app() {
  for attempt in $(seq 1 90); do
    if curl --fail --silent --max-time 3 "$UPGRADE_APP_URL/api/bootstrap" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  printf 'Disposable Provisionarr did not become ready.\n' >&2
  return 1
}
start_version() {
  image=$1
  container_id=$(docker run --detach --name "$name" --read-only --tmpfs /tmp:rw,nosuid,size=64m \
    --user "$(id -u):$(id -g)" \
    --env PORT=3000 --env PROVISIONARR_LISTEN_HOST=0.0.0.0 \
    --env PROVISIONARR_CONFIG_ROOT=/data --env PROVISIONARR_REQUEST_LOG=/data/requests.json \
    --env PROVISIONARR_SECURE_COOKIES=false \
    --volume "$work/data:/data" --publish "127.0.0.1:$port:3000" \
    "$image")
  wait_for_app
}
replace_version() {
  docker rm -f "$container_id" >/dev/null
  container_id=''
  start_version "$1"
}

start_version "$baseline_image"
for attempt in $(seq 1 30); do
  [ -s "$work/data/setup-token.txt" ] && break
  sleep 1
done
[ -s "$work/data/setup-token.txt" ] || { printf 'Baseline setup token was not created.\n' >&2; exit 1; }
node "$project_dir/test/fixtures/disposable-upgrade-persistence.mjs" seed

replace_version "$baseline_image"
node "$project_dir/test/fixtures/disposable-upgrade-persistence.mjs" verify
printf 'Baseline state verified after recreation.\n'

replace_version "$current_image"
node "$project_dir/test/fixtures/disposable-upgrade-persistence.mjs" verify
printf 'State verified after version upgrade.\n'

replace_version "$baseline_image"
node "$project_dir/test/fixtures/disposable-upgrade-persistence.mjs" verify
printf 'State verified after version rollback.\n'

printf 'Upgrade and rollback passed on %s.\n' "$(uname -m)"
printf 'Baseline commit: %s\nCurrent commit: %s\n' "$baseline_sha" "$current_sha"
printf 'Baseline image: %s\nCurrent image: %s\n' "$baseline_image_id" "$current_image_id"
