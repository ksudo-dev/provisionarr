#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR=$(dirname -- "$SCRIPT_DIR")
run_id="provisionarr-disposable-$$-${RANDOM}"
project="$run_id"
work=$(mktemp -d /tmp/provisionarr-disposable.XXXXXX)
compose="$work/compose.yaml"

SONARR_IMAGE=${SONARR_TEST_IMAGE:-lscr.io/linuxserver/sonarr@sha256:60f3b6b5c7647ba2bafd81163acfe34b11117b9b834ebd7fbcc3e5f1b309c7ef}
RADARR_IMAGE=${RADARR_TEST_IMAGE:-lscr.io/linuxserver/radarr@sha256:079e48870584baf2a3e7e43e7ba6d3c834555931851a59c82c51cc792d285caf}
PROWLARR_IMAGE=${PROWLARR_TEST_IMAGE:-lscr.io/linuxserver/prowlarr@sha256:a89f252d6a22bd25af14a5380aec0adcc3c3af2e3282164f981680e6844070f3}
QBITTORRENT_IMAGE=${QBITTORRENT_TEST_IMAGE:-lscr.io/linuxserver/qbittorrent@sha256:eeea9f8a8cdde23555186843d26e8ded1222421f31f98a5cc1b50c2882ebcf4e}
export DISPOSABLE_SONARR_KEY=not-ready DISPOSABLE_RADARR_KEY=not-ready DISPOSABLE_PROWLARR_KEY=not-ready DISPOSABLE_QBIT_PASSWORD=not-ready

cleanup() {
  docker compose --project-name "$project" --file "$compose" down --remove-orphans --volumes >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

pick_port() {
  local output=$1 port
  for _ in $(seq 1 100); do
    port=$((30000 + RANDOM % 20000))
    case " $used_ports " in *" $port "*) continue;; esac
    if ! (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1; then
      used_ports="$used_ports $port"
      printf -v "$output" '%s' "$port"
      return 0
    fi
  done
  printf 'Could not find an unused loopback port.\n' >&2
  return 1
}

used_ports=''
pick_port app_port
pick_port existing_app_port
pick_port sonarr_port
pick_port radarr_port
pick_port prowlarr_port
pick_port qbit_port
mkdir -p "$work"/{sonarr,radarr,prowlarr,qbittorrent/qBittorrent,tv,movies,downloads,data-managed,data-existing,media}
printf '%s\n' '[Preferences]' 'WebUI\\AuthSubnetWhitelistEnabled=true' 'WebUI\\AuthSubnetWhitelist=0.0.0.0/0,::/0' >"$work/qbittorrent/qBittorrent/qBittorrent.conf"

cat >"$compose" <<EOF
name: $project
services:
  sonarr:
    image: $SONARR_IMAGE
    environment: {PUID: "$(id -u)", PGID: "$(id -g)", TZ: Etc/UTC}
    volumes: ["$work/sonarr:/config", "$work/tv:/tv", "$work/downloads:/downloads"]
    ports: ["127.0.0.1:$sonarr_port:8989"]
    networks: [media]
  radarr:
    image: $RADARR_IMAGE
    environment: {PUID: "$(id -u)", PGID: "$(id -g)", TZ: Etc/UTC}
    volumes: ["$work/radarr:/config", "$work/movies:/movies", "$work/downloads:/downloads"]
    ports: ["127.0.0.1:$radarr_port:7878"]
    networks: [media]
  prowlarr:
    image: $PROWLARR_IMAGE
    environment: {PUID: "$(id -u)", PGID: "$(id -g)", TZ: Etc/UTC}
    volumes: ["$work/prowlarr:/config"]
    ports: ["127.0.0.1:$prowlarr_port:9696"]
    networks: [media]
  qbittorrent:
    image: $QBITTORRENT_IMAGE
    environment: {PUID: "$(id -u)", PGID: "$(id -g)", TZ: Etc/UTC, WEBUI_PORT: "8080", TORRENTING_PORT: "6881"}
    volumes: ["$work/qbittorrent:/config", "$work/downloads:/downloads"]
    ports: ["127.0.0.1:$qbit_port:8080"]
    networks: [media]
  provisionarr:
    image: provisionarr-disposable:$run_id
    build: $PROJECT_DIR
    user: "$(id -u):$(id -g)"
    environment:
      PORT: "3000"
      PROVISIONARR_LISTEN_HOST: 0.0.0.0
      PROVISIONARR_CONFIG_ROOT: /data
      PROVISIONARR_REQUEST_LOG: /data/requests.json
      PROVISIONARR_MEDIA_ROOT: /media
      PROVISIONARR_ORCHESTRATION_WRITES_ENABLED: "true"
      SONARR_URL: http://sonarr:8989
      RADARR_URL: http://radarr:7878
      PROWLARR_URL: http://prowlarr:9696
      PROVISIONARR_QBIT_URL: http://qbittorrent:8080
      SONARR_API_KEY: "\${DISPOSABLE_SONARR_KEY}"
      RADARR_API_KEY: "\${DISPOSABLE_RADARR_KEY}"
      PROWLARR_API_KEY: "\${DISPOSABLE_PROWLARR_KEY}"
      PROVISIONARR_QBIT_USERNAME: admin
      PROVISIONARR_QBIT_PASSWORD: "\${DISPOSABLE_QBIT_PASSWORD}"
    volumes: ["$work/data-managed:/data", "$work/media:/media"]
    ports: ["127.0.0.1:$app_port:3000"]
    networks: [media]
  provisionarr-existing:
    image: provisionarr-disposable:$run_id
    user: "$(id -u):$(id -g)"
    environment:
      PORT: "3000"
      PROVISIONARR_LISTEN_HOST: 0.0.0.0
      PROVISIONARR_CONFIG_ROOT: /data
      PROVISIONARR_REQUEST_LOG: /data/requests.json
      PROVISIONARR_MEDIA_ROOT: /media
      PROVISIONARR_ORCHESTRATION_WRITES_ENABLED: "true"
      SONARR_URL: http://sonarr:8989
      RADARR_URL: http://radarr:7878
      PROWLARR_URL: http://prowlarr:9696
      PROVISIONARR_QBIT_URL: http://qbittorrent:8080
      SONARR_API_KEY: "\${DISPOSABLE_SONARR_KEY}"
      RADARR_API_KEY: "\${DISPOSABLE_RADARR_KEY}"
      PROWLARR_API_KEY: "\${DISPOSABLE_PROWLARR_KEY}"
      PROVISIONARR_QBIT_USERNAME: admin
      PROVISIONARR_QBIT_PASSWORD: "\${DISPOSABLE_QBIT_PASSWORD}"
    volumes: ["$work/data-existing:/data", "$work/media:/media"]
    ports: ["127.0.0.1:$existing_app_port:3000"]
    networks: [media]
networks: {media: {}}
EOF

docker compose --project-name "$project" --file "$compose" build provisionarr >/dev/null
docker compose --project-name "$project" --file "$compose" up -d sonarr radarr prowlarr qbittorrent >/dev/null

wait_for_file() {
  local file=$1 attempts=0
  while [ "$attempts" -lt 180 ]; do
    [ -s "$file" ] && return 0
    attempts=$((attempts + 1)); sleep 1
  done
  printf 'Timed out waiting for disposable service configuration.\n' >&2
  return 1
}

redacted_logs() {
  local service=$1
  docker compose --project-name "$project" --file "$compose" logs --no-color "$service" 2>&1 |
    perl -pe 'BEGIN {@secrets=grep {defined($_) && length($_)} @ENV{qw(DISPOSABLE_SONARR_KEY DISPOSABLE_RADARR_KEY DISPOSABLE_PROWLARR_KEY DISPOSABLE_QBIT_PASSWORD DISPOSABLE_SETUP_TOKEN)}} for $secret (@secrets) {s/\Q$secret\E/[redacted]/g}'
}

wait_for_service() {
  local service=$1 url=$2 header=${3:-} attempts=0
  while [ "$attempts" -lt 180 ]; do
    if [ -n "$header" ]; then
      if curl --fail --silent --max-time 3 -H "$header" "$url" >/dev/null 2>&1; then return 0; fi
    elif curl --fail --silent --max-time 3 "$url" >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts + 1)); sleep 1
  done
  printf 'Timed out waiting for disposable %s.\n' "$service" >&2
  docker compose --project-name "$project" --file "$compose" ps "$service" >&2 || true
  redacted_logs "$service" >&2 || true
  return 1
}

wait_for_file "$work/sonarr/config.xml"
wait_for_file "$work/radarr/config.xml"
wait_for_file "$work/prowlarr/config.xml"
wait_for_file "$work/qbittorrent/qBittorrent/qBittorrent.conf"
sonarr_key=$(sed -n 's:.*<ApiKey>\([^<]*\)</ApiKey>.*:\1:p' "$work/sonarr/config.xml")
radarr_key=$(sed -n 's:.*<ApiKey>\([^<]*\)</ApiKey>.*:\1:p' "$work/radarr/config.xml")
prowlarr_key=$(sed -n 's:.*<ApiKey>\([^<]*\)</ApiKey>.*:\1:p' "$work/prowlarr/config.xml")
qbit_password=''
for _ in $(seq 1 90); do
  qbit_password=$(docker compose --project-name "$project" --file "$compose" logs qbittorrent 2>/dev/null | sed -n 's/.*temporary password is provided for this session: \([^ ]*\).*/\1/p' | tail -1)
  [ -n "$qbit_password" ] && break
  sleep 1
done
if [ -z "$sonarr_key" ] || [ -z "$radarr_key" ] || [ -z "$prowlarr_key" ] || [ -z "$qbit_password" ]; then
  printf 'Disposable credentials were not generated by the fresh services.\n' >&2
  exit 1
fi

wait_for_service sonarr "http://127.0.0.1:$sonarr_port/api/v3/system/status" "X-Api-Key: $sonarr_key"
wait_for_service radarr "http://127.0.0.1:$radarr_port/api/v3/system/status" "X-Api-Key: $radarr_key"
wait_for_service prowlarr "http://127.0.0.1:$prowlarr_port/api/v1/system/status" "X-Api-Key: $prowlarr_key"

docker compose --project-name "$project" --file "$compose" exec -T -e QBIT_PASSWORD="$qbit_password" sonarr sh -ec '
  cookie_jar=/tmp/provisionarr-qbit-cookie
  unauthenticated_status=$(curl --silent --show-error --output /dev/null --write-out "%{http_code}" http://qbittorrent:8080/api/v2/app/version)
  login_result=$(curl --silent --show-error --cookie-jar "$cookie_jar" --output /tmp/provisionarr-qbit-login --write-out "%{http_code}" --request POST --data-urlencode "username=admin" --data-urlencode "password=$QBIT_PASSWORD" http://qbittorrent:8080/api/v2/auth/login)
  login_body=$(tr -d "\r\n" </tmp/provisionarr-qbit-login)
  cookie_present=no
  grep -q SID "$cookie_jar" && cookie_present=yes
  version_status=$(curl --silent --show-error --cookie "$cookie_jar" --output /dev/null --write-out "%{http_code}" http://qbittorrent:8080/api/v2/app/version)
  rm -f "$cookie_jar" /tmp/provisionarr-qbit-login
  { [ "$login_result" = "204" ] || [ "$login_body" = "Ok." ]; } && [ "$cookie_present" = yes ] && [ "$version_status" = "200" ] || { printf "Direct qBittorrent API probe failed: login=%s response=%s cookie=%s version=%s.\n" "$login_result" "$login_body" "$cookie_present" "$version_status" >&2; exit 1; }
  printf "Disposable qBittorrent direct API probe passed (unauthenticated status %s).\n" "$unauthenticated_status"
'

export DISPOSABLE_SONARR_NATIVE_URL="http://127.0.0.1:$sonarr_port"
export DISPOSABLE_RADARR_NATIVE_URL="http://127.0.0.1:$radarr_port"
export DISPOSABLE_PROWLARR_NATIVE_URL="http://127.0.0.1:$prowlarr_port"
export DISPOSABLE_SONARR_KEY="$sonarr_key" DISPOSABLE_RADARR_KEY="$radarr_key" DISPOSABLE_PROWLARR_KEY="$prowlarr_key" DISPOSABLE_QBIT_PASSWORD="$qbit_password"

docker compose --project-name "$project" --file "$compose" up -d provisionarr-existing >/dev/null
wait_for_service provisionarr-existing "http://127.0.0.1:$existing_app_port/api/bootstrap"
wait_for_file "$work/data-existing/setup-token.txt"
export DISPOSABLE_APP_URL="http://127.0.0.1:$existing_app_port"
export DISPOSABLE_SETUP_TOKEN
DISPOSABLE_SETUP_TOKEN=$(tr -d '\r\n' <"$work/data-existing/setup-token.txt")
node "$PROJECT_DIR/test/fixtures/disposable-arr-existing-setup.mjs"
docker compose --project-name "$project" --file "$compose" restart provisionarr-existing >/dev/null
wait_for_service provisionarr-existing "http://127.0.0.1:$existing_app_port/api/bootstrap"
export DISPOSABLE_EXPECTED_MODE=existing
node "$PROJECT_DIR/test/fixtures/disposable-arr-persistence.mjs"
docker compose --project-name "$project" --file "$compose" stop provisionarr-existing >/dev/null

docker compose --project-name "$project" --file "$compose" up -d provisionarr >/dev/null
wait_for_service provisionarr "http://127.0.0.1:$app_port/api/bootstrap"
wait_for_file "$work/data-managed/setup-token.txt"
export DISPOSABLE_APP_URL="http://127.0.0.1:$app_port"
DISPOSABLE_SETUP_TOKEN=$(tr -d '\r\n' <"$work/data-managed/setup-token.txt")
if ! node "$PROJECT_DIR/test/fixtures/disposable-arr-guided-setup.mjs"; then
  redacted_logs provisionarr >&2 || true
  exit 1
fi

export DISPOSABLE_FAILURE_STATE="$work/failure-state.json"
node "$PROJECT_DIR/test/fixtures/disposable-arr-failure-recovery.mjs" prepare
docker compose --project-name "$project" --file "$compose" stop radarr >/dev/null
node "$PROJECT_DIR/test/fixtures/disposable-arr-failure-recovery.mjs" apply
docker compose --project-name "$project" --file "$compose" start radarr >/dev/null
wait_for_service radarr "http://127.0.0.1:$radarr_port/api/v3/system/status" "X-Api-Key: $radarr_key"
node "$PROJECT_DIR/test/fixtures/disposable-arr-failure-recovery.mjs" verify

docker compose --project-name "$project" --file "$compose" restart provisionarr >/dev/null
wait_for_service provisionarr "http://127.0.0.1:$app_port/api/bootstrap"
export DISPOSABLE_EXPECTED_MODE=managed
node "$PROJECT_DIR/test/fixtures/disposable-arr-persistence.mjs"

docker compose --project-name "$project" --file "$compose" up -d --force-recreate provisionarr >/dev/null
wait_for_service provisionarr "http://127.0.0.1:$app_port/api/bootstrap"
node "$PROJECT_DIR/test/fixtures/disposable-arr-persistence.mjs"

printf '%s\n' 'Disposable ARR lifecycle passed for separate existing-stack and managed-stack Provisionarr instances.'
