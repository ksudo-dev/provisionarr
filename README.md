# Provisionarr

<img src="public/brand/provisionarr-mark.svg" alt="Provisionarr terminal, media, and wrench mark" width="112">

Provisionarr is a request and administration layer for Sonarr, Radarr,
Prowlarr, and qBittorrent. Users search for movies and shows, request titles,
and track request status. The system administrator gets a separate setup and
operations surface.

Service credentials stay on the server. Users don't receive API keys, torrent
identifiers, filesystem paths, or raw upstream errors.

## Development status

The existing-stack request and administration interface is the supported core.
Managed-stack onboarding is under active development on the `onboarding`
branch. It remains a preview until clean ARM64 and AMD64 installation, upgrade,
and rollback checks are recorded.

See [project scope](docs/PROJECT-SCOPE.md) before opening an issue or pull
request. It separates the supported core, onboarding preview, contribution
lanes, and deferred work.

## Onboarding preview

The owner-only onboarding work connects and tests Sonarr, Radarr, Prowlarr, and
qBittorrent through their native APIs. The current preview can:

- create the selected Sonarr and Radarr root folders;
- register qBittorrent in Sonarr and Radarr with separate TV and movie
  categories;
- create and test the Sonarr and Radarr application links in Prowlarr;
- show every proposed change before it is applied;
- verify the resulting root folders, download clients, and Prowlarr links; and
- keep a private backup for one-click rollback.

These capabilities aren't a supported managed installation yet. Keep write
orchestration disabled outside an isolated test stack.

Indexer provider credentials aren't created by Provisionarr. The system
administrator adds an indexer in Prowlarr, then Prowlarr synchronizes it to the
linked applications.

Keep `PROVISIONARR_ORCHESTRATION_WRITES_ENABLED=false` while reviewing a plan.
The write path is owner-only and rejects an expired or altered preview.

## Run Provisionarr

Provisionarr supports Docker and a native Node.js service. The web service can
run without Docker; the generated four-service media bundle uses Docker Compose
when that deployment option is selected. See [native installation](docs/NATIVE-INSTALL.md)
for the systemd path.

For a local checkout with Node.js 22 or newer:

```sh
npm ci --ignore-scripts
npm start
```

The default listener uses port `3000`. Set `PORT` and the documented
`PROVISIONARR_*` environment variables in a private environment file when the
default is unsuitable. Never commit that file.

## Access profiles

LAN HTTP, a separately configured reverse proxy, and tailnet-only HTTPS are
supported access profiles. Tailnet-only HTTPS is optional. It does not change
the application authentication requirement, and it must not expose Sonarr,
Radarr, Prowlarr, or qBittorrent ports directly.

Remote browser access uses HTTPS. A private LAN deployment can remain on HTTP
when the network boundary is trusted. Tailscale Serve is one private HTTPS
recipe; a conventional reverse proxy is another. Public tunnel access requires
its own access policy and release review.

## Requests

Search accepts an exact movie or series title and an optional season. A
confirmed request is translated into the native Sonarr or Radarr action. The
request history reports queue, download, import, ready, and failure states from
the ARR services and qBittorrent.

Storage holds and request limits are shown before a request is confirmed. A
held request stays visible to the system administrator instead of silently
starting a download that the configured storage cannot support.

## Generated stack deployment

Guided setup can generate pinned Compose, environment, and instruction files
for Sonarr, Radarr, Prowlarr, and qBittorrent. Generation only returns files.
The separate host command provides dry-run, apply, verify, and rollback actions.

See [generated stack deployment](docs/STACK-DEPLOYMENT.md) for the commands and
the data-preserving rollback behavior.

## Operations and project status

- [Upgrade and rollback](docs/UPGRADE.md)
- [Generated stack deployment](docs/STACK-DEPLOYMENT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Project scope](docs/PROJECT-SCOPE.md)
- [Support policy](docs/SUPPORT.md)
- [Security policy](SECURITY.md)
- [Release checklist](docs/RELEASE-CHECKLIST.md)
- [Roadmap](docs/ROADMAP.md)

Release status and test results are recorded in
[release evidence](docs/RELEASE-EVIDENCE.md). A pending item is not a passed
release gate.

## License

Provisionarr is licensed under the GNU Affero General Public License v3.0 only
(`AGPL-3.0-only`).
