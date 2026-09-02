# Security policy

Provisionarr is designed to place a small, authenticated interface in front of Sonarr, Radarr, Prowlarr, qBittorrent, and optional media services. It must not be treated as an authorization boundary for those upstream services unless the deployment guidance is followed.

## Supported version

Provisionarr supports the latest `1.x` release. Earlier `1.x` releases stop receiving fixes when a newer `1.x` release is published. Commits without a release tag and versions below `1.0.0` are not supported release lines.

## Reporting a vulnerability

The security contact is the repository owner, [@ksudo-dev](https://github.com/ksudo-dev). Do not open a public issue containing credentials, private URLs, file paths, exploit steps, or user data. Use GitHub's private vulnerability report form at `https://github.com/ksudo-dev/provisionarr/security/advisories/new`. Include the affected version, impact, reproduction steps, and any suggested mitigation.

If the private report form is unavailable, wait for the repository owner to restore it. Do not move the report into a public issue.

## Security boundaries

- Service API keys and SMTP credentials remain server-side.
- Ordinary users cannot receive filesystem paths, torrent hashes, raw upstream errors, or administrative diagnostics.
- Every mutation requires authentication and CSRF validation.
- User-facing media requests are translated into fixed, allowlisted Sonarr and Radarr operations; no arbitrary command or filesystem operation is exposed.
- Unsafe releases are never opened, inspected, moved, or unpacked. After confirmation, the owning ARR service removes them from the client, deletes their files, blocklists the release, and searches again.
- Automatic file movement is out of scope until fixed source and destination roots, dry runs, verification, and audit logging are implemented.

## Public exposure

Do not expose the application over plain HTTP or direct port forwarding. Use an HTTPS reverse proxy or an authenticated private network. Tailscale Funnel is public internet exposure and does not replace Provisionarr authentication.
