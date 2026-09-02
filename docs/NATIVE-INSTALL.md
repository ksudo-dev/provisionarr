# Native installation

Provisionarr can run directly under systemd on Debian-like systems without
Docker. This foundation deliberately performs no network downloads: production
dependencies must already be present in the checkout or in the local npm cache.
The host must provide Node.js 22 or newer.

## Install or upgrade

From the repository checkout, run:

```sh
sudo ./scripts/install-native.sh --dry-run
sudo ./scripts/install-native.sh
```

The installer creates:

- `/opt/provisionarr` for root-owned application code;
- `/var/lib/provisionarr` for the unprivileged service's state;
- `/etc/provisionarr/provisionarr.env` for owner-supplied configuration, mode
  `600`; and
- `provisionarr.service`, listening on `127.0.0.1` by default.

The service account is `provisionarr` and has no login shell. The installer
preserves the data directory and existing environment file on upgrades. Set
upstream URLs and API keys only in the environment file; do not commit it.
After changing it, run `sudo systemctl restart provisionarr`.

Guided setup can validate Sonarr, Radarr, Prowlarr, and qBittorrent. Sonarr and
Radarr configuration is preview-only by default. When writes are enabled, the
onboarding workflow can create root folders and register qBittorrent with
separate TV and movie categories. The Prowlarr workflow
previews native Sonarr/Radarr application links, tests each link through
Prowlarr, creates a private backup before applying changes, verifies the
resulting links, and supports rollback from the administration UI. Keep
`PROVISIONARR_ORCHESTRATION_WRITES_ENABLED=false` until the connected services
and backup path have been validated. Enabling it permits only Provisionarr's
fixed, allowlisted configuration workflow; each application creates a private
configuration backup first and supports rollback from the administration UI.

Put a separately reviewed reverse proxy or private access layer in front of
the loopback listener if remote access is needed. This installer does not alter
DNS, networking, certificates, firewall rules, or production deployments.
The service accepts HTTP for loopback, private LAN, Tailnet, and local service
upstream names. Public upstream addresses still require HTTPS.

Useful checks:

```sh
systemctl status provisionarr
journalctl -u provisionarr --since today
curl http://127.0.0.1:3000/api/bootstrap
```

## Remove

The default uninstall removes the service and code while preserving state:

```sh
sudo ./scripts/uninstall-native.sh
```

Only use the explicit purge form when the stored requests, sessions, logs,
configuration, and setup state are no longer wanted:

```sh
sudo ./scripts/uninstall-native.sh --purge --yes
```

## Scope and limitations

This is a bounded installation path. It does not install Node.js, Sonarr,
Radarr, Prowlarr, qBittorrent, a reverse proxy, or any system packages. The
guided workflow inventories Sonarr and Radarr, translates a small, allowlisted
settings surface, and can configure the fresh-stack resources described above.
It can also generate reviewable Compose files for a separate four-service
stack. A separate administrator-run host command can apply those files; the web
service doesn't receive a Docker socket or expose a host command runner.
Automated indexer-provider setup and broader service configuration remain
roadmap work.
