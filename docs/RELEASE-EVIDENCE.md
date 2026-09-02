# Provisionarr release evidence

This file records release evidence supplied by the release owner. It doesn't
turn an intended check into a passed check.

## Current status

- Candidate: `PENDING`
- Release version: `PENDING`
- Release commit: `PENDING`
- Validation date: `PENDING`
- Container image digest: `PENDING`
- GitHub publication: `PENDING`

## Onboarding branch snapshot

- `PASS`: JavaScript syntax checks
- `PASS`: 79 Node.js tests
- `PASS`: two Playwright browser flows for guided setup and categorized media
- `PASS`: complete-history credential and public-data scan
- `PENDING`: clean AMD64 installation on an independent host

This snapshot records development evidence. It is not release evidence and does
not promote managed onboarding out of preview.

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
