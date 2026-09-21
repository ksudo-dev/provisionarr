# Provisionarr release evidence

I record verified release evidence here. `PENDING` means I have not
recorded a passing result.

## Current status

- Candidate: `PENDING`
- Release version: `PENDING`
- Release commit: `PENDING`
- Validation date: `PENDING`
- Container image digest: `PENDING`
- Release publication: `PENDING`

## Current development snapshot

- `PASS`: JavaScript syntax checks
- `PASS`: 79 Node.js tests
- `PASS`: two Playwright browser flows for guided setup and categorized media
- `PASS`: complete-history credential and public-data scan
- `PASS`: native ARM64 disposable lifecycle with separate existing-stack and
  managed-stack Provisionarr instances
- `PASS`: managed preview, apply, verification, controlled failure, automatic
  recovery, manual rollback, restart, and container recreation
- `PASS`: native AMD64 disposable lifecycle in CI run `35649519776`
- `PASS`: disposable version upgrade and rollback with `/data` preserved on
  ARM64 and native AMD64 (details below)
- `PENDING`: tagged release-to-release upgrade migration with `/data` preserved

These results describe development validation. I don't count them as release
candidate evidence or promote managed onboarding out of preview.

## Disposable version upgrade and rollback trial

- Date: 2026-09-21
- Baseline: `f74fcbd8064f791d88d36250c969d1d6a4960c00`
- Upgraded version: `93a5b4c83598b2fcc14a811cb07779e90b5f683a`
- Command: `npm run test:upgrade`
- Native AMD64: `PASS` in [CI run 35649519776](https://github.com/ksudo-dev/provisionarr/actions/runs/35649519776), with all seven jobs passing
- Native ARM64: `PASS` in the local disposable run
- AMD64 baseline image ID: `sha256:69540015328c5d8d1367411deda53b6060532925e26e5439e13e7f4e77f4ce62`
- AMD64 upgraded image ID: `sha256:89b2148fab3e2b9fac17c01cdef5295bcb31f0055ca32f3e21251cb46f9bdb4e`

The test starts the baseline image, sets up an owner, changes settings and
onboarding mode through its API, then verifies account, settings, request,
saved connection, audit, and recovery records after baseline recreation,
upgrade, and rollback. Every version uses the same temporary `/data` directory.
The request, saved connections, and recovery record are synthetic files in that
directory. The trial does not exercise real ARR services, a published release
tag, or a production installation. Those release checks remain pending.

## Automated checks

- `PENDING`: syntax checks
- `PENDING`: Node.js test suite
- `PENDING`: browser checks on desktop and mobile layouts
- `PENDING`: dependency audit
- `PENDING`: working-tree secret scan
- `PENDING`: complete reachable-history secret scan
- `PENDING`: private infrastructure and personal-data scan
- `PENDING`: immutable dependency check
- `PENDING`: AMD64 container build and smoke test
- `PENDING`: ARM64 container build and smoke test
- `PENDING`: clean CI workflow

## Installation checks

- `PENDING`: clean Docker installation from the documented files
- `PENDING`: native Provisionarr installation
- `PENDING`: first-run authentication and owner setup
- `PENDING`: upgrade with `/data` preserved
- `PENDING`: one-click application rollback
- `PENDING`: generated Compose rollback with media and downloads preserved

## ARR onboarding checks

- `PENDING`: Sonarr connection and native API test
- `PENDING`: Radarr connection and native API test
- `PENDING`: Prowlarr connection and native API test
- `PENDING`: qBittorrent connection and native API test
- `PENDING`: Sonarr root-folder creation or retention
- `PENDING`: Radarr root-folder creation or retention
- `PENDING`: qBittorrent registration in Sonarr with the TV category
- `PENDING`: qBittorrent registration in Radarr with the movie category
- `PENDING`: Prowlarr Sonarr application-link creation and verification
- `PENDING`: Prowlarr Radarr application-link creation and verification
- `PENDING`: provider credentials remain administrator-supplied in Prowlarr
- `PENDING`: failed apply recovery and manual rollback

## Known limits

Indexer provider setup requires administrator-supplied credentials in Prowlarr.
Tailnet-only HTTPS is optional; LAN HTTP and reviewed reverse-proxy deployments
remain supported. Automatic storage movement across mounts is outside this
release until its approved roots and recovery behavior are documented.
