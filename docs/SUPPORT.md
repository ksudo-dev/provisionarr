# Provisionarr support policy

## Supported releases

The latest published major release receives bug and security fixes according to
the support statement in its release notes. Untagged commits and unreleased
versions are development builds.

## Bug reports

Open a GitHub issue for a reproducible Provisionarr defect. Include the
Provisionarr version, host architecture, installation method, browser, redacted
logs, and the steps that reproduce the failure.

Remove API keys, passwords, setup tokens, private URLs, private IP addresses,
hostnames, filesystem paths, torrent identifiers, media history, and user data
before attaching logs or screenshots. Use the private reporting process in
`SECURITY.md` when a report exposes data or crosses an authorization boundary.

## Supported deployment scope

Provisionarr accepts defects for its documented Docker and native installations,
fresh-stack onboarding, LAN access, tailnet-only HTTPS, and reviewed reverse
proxy arrangements. Upstream Sonarr, Radarr, Prowlarr, qBittorrent, Emby,
Docker, reverse-proxy, DNS, and operating-system defects belong in those
projects' support channels.

Provisionarr doesn't provide indexer access, media files, copyright guidance,
or support for exposing Sonarr, Radarr, Prowlarr, or qBittorrent directly to the
internet.

## Security reports

Don't publish credentials or exploitation details in a public issue. Follow the
private reporting instructions in `SECURITY.md`, which is the authoritative
security contact and response path.
