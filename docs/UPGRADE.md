# Upgrade and rollback

These steps apply to the standalone `compose.yaml` installation. The bind mount `./data:/data` stores accounts, sessions, requests, settings, audit records, and notifications outside the container image.

## Before an upgrade

Record the current release and create a private backup:

```sh
git describe --tags --always
install -d -m 700 backups
tar -czf "backups/provisionarr-data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" data
chmod 600 backups/provisionarr-data-*.tar.gz
```

Copy the backup to storage outside the Provisionarr host before changing the running release. Do not commit the `data` or `backups` directories.

## Upgrade

Fetch the release tag, check it out, rebuild the image, and recreate only the Provisionarr service:

```sh
git fetch --tags --prune
git checkout 1.0.0
docker compose build --pull provisionarr
docker compose up -d --no-deps provisionarr
curl --fail --silent http://127.0.0.1:3000/api/bootstrap
```

`docker compose up` preserves `./data`. Do not run `docker compose down --volumes`; that option deletes named volumes in deployments that use them.

## Roll back application code

Check out the previous release, rebuild it, and recreate only Provisionarr:

```sh
git checkout PREVIOUS_TAG
docker compose build provisionarr
docker compose up -d --no-deps provisionarr
curl --fail --silent http://127.0.0.1:3000/api/bootstrap
```

Code rollback leaves `./data` unchanged. If the newer release changed stored data in an incompatible way, stop Provisionarr and restore the backup made before the upgrade.

## Restore `/data`

Use an empty staging directory to inspect the archive before restoring it:

```sh
docker compose stop provisionarr
restore_dir=$(mktemp -d)
tar -xzf backups/PROVISIONARR_DATA_BACKUP.tar.gz -C "$restore_dir"
test -d "$restore_dir/data"
mv data "data.failed-$(date -u +%Y%m%dT%H%M%SZ)"
mv "$restore_dir/data" data
docker compose up -d provisionarr
curl --fail --silent http://127.0.0.1:3000/api/bootstrap
```

Keep the renamed failed data directory until the restored release has passed login, request-history, and settings checks.
