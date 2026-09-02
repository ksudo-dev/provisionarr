# Optional deploy and rollback adapter

This adapter records the last deployed Provisionarr source and provides a
single-command code rollback. Standalone installations can also follow
[UPGRADE.md](UPGRADE.md). The adapter is not required to install or run
Provisionarr.

Run these from the Provisionarr checkout:

```sh
./scripts/provisionarr-deploy.sh
./scripts/provisionarr-deploy.sh --yes
./scripts/provisionarr-deploy.sh --yes --previous "$HOME/.provisionarr-rollbacks/known-good.tar.gz"
./scripts/provisionarr-deploy.sh --dry-run
./scripts/provisionarr-rollback.sh --latest
./scripts/provisionarr-rollback.sh --yes --previous
./scripts/provisionarr-rollback.sh --yes provisionarr-YYYYMMDDTHHMMSSZ-deploy.tar.gz
./scripts/provisionarr-rollback.sh --dry-run --latest
```

Deploy snapshots the last successfully deployed release, registers it as the
previous release, then recreates only `arr-home`. On the first tracked deploy,
provide `--previous` with a known-good snapshot. Later deploys use the private
deployed-release mirror automatically.
Rollback creates a new pre-rollback safety snapshot, validates the selected
archive, stages it privately, restores the project, recreates only the
`provisionarr` service, and verifies the local bootstrap endpoint.

Both operations use the checkout's `compose.yaml`. Set
`PROVISIONARR_BASE_COMPOSE_FILE` to select another base file and
`PROVISIONARR_COMPOSE_FILE` to add a separately maintained override. External
overrides and environment files aren't copied into snapshots or modified.

Snapshots are stored in `$HOME/.provisionarr-rollbacks` with directory
mode `0700` and archive/checksum mode `0600`. They contain no application data,
and rollback never changes the mounted `/data` directory.
Archive validation rejects absolute paths, traversal, unexpected paths, and
symbolic or hard links. Extraction happens in a private temporary directory.
`--dry-run` validates and prints the plan without writing, restarting, or
deleting. `--yes` skips confirmation.

`./scripts/provisionarr-rollback.sh --yes --previous` is the one-click rollback
path. It restores the exact release registered by the most recent successful
deployment while preserving `/data`.

The tools intentionally do not restart Sonarr, Radarr, qBittorrent, or any
other service.

Set `PROVISIONARR_PROJECT_DIR`, `PROVISIONARR_RELEASE_ROOT`, or
`PROVISIONARR_ROLLBACK_DIR` to use different locations.
