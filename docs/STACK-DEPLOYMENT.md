# Generated stack deployment

Provisionarr can generate a four-service Compose bundle for Sonarr, Radarr,
Prowlarr, and qBittorrent. The web service returns the files; it doesn't
receive a Docker socket or execute host commands. The system administrator
chooses when and where to run the bundle.

The host deployment command requires Node.js 22 or newer, Docker Engine, and
the Docker Compose plugin.

## Generate and inspect

Use Guided setup to generate the bundle. It contains `compose.yaml`, `.env`,
and an instruction file. The generated environment file contains the selected
configuration root, media root, download root, numeric user and group IDs, and
timezone. It doesn't contain service API keys or passwords.

Download all generated files into one directory, then validate that directory
from a Provisionarr checkout:

```sh
npm run stack:deploy -- --bundle /path/to/bundle --dry-run
```

Dry run checks that the files are unchanged from Provisionarr's generator and
asks Docker Compose to validate the model. It doesn't create directories,
containers, networks, or service settings.

## Apply and onboard

After reviewing the paths and ports in the dry-run output, start the bundle:

```sh
npm run stack:deploy -- --bundle /path/to/bundle --apply --yes
```

Apply creates the generated directories and starts the four-service Compose
project. It refuses changed bundle files and occupied service ports. If startup
doesn't reach four running services, it removes the new containers and project
network while preserving configuration, downloads, and media.

qBittorrent creates a temporary Web UI password during first start. Change it
in qBittorrent before saving the qBittorrent connection in Provisionarr.

In Guided setup, enter the service addresses reachable from the ARR services,
then run the connection tests. The onboarding plan uses the selected paths to:

1. create the Sonarr and Radarr root folders;
2. register qBittorrent in Sonarr with the TV category and in Radarr with the
   movie category;
3. test and create the Sonarr and Radarr application links in Prowlarr; and
4. verify all created resources before reporting success.

Indexer provider credentials are not part of the generated bundle or the
onboarding plan. Add an indexer in Prowlarr after onboarding; Prowlarr then
synchronizes it to Sonarr and Radarr.

Every write plan is previewed before apply. A private backup is created for
affected resources. The administration UI exposes rollback after a successful
apply, and a failed multi-service apply attempts automatic restoration.

## Verify

Check the running project and generated directories:

```sh
npm run stack:deploy -- --bundle /path/to/bundle --verify
```

Verification checks four running containers, the fixed local service ports, and
read/write access to generated directories. Guided setup performs the separate
native API authentication, root-folder, qBittorrent download-client, and
Prowlarr-link checks.

## Roll back

Stop and remove the generated containers and project network while preserving
configuration, downloads, and media:

```sh
npm run stack:deploy -- --bundle /path/to/bundle --rollback --yes
```

To reverse an onboarding change, use the backup list in the owner-only
administration UI and select the matching backup. Rollback restores only the
resources recorded in that backup.

## Provisionarr installation choices

Docker is the shortest path for the web service and supports the published
container workflow. Native installation runs Provisionarr under systemd with a
dedicated unprivileged service account. Native installation doesn't install
Docker, Sonarr, Radarr, Prowlarr, qBittorrent, a reverse proxy, DNS, or system
packages. See [native installation](NATIVE-INSTALL.md).

## Access boundaries

LAN HTTP is supported for a trusted private network. Tailnet-only HTTPS through
Tailscale Serve is an optional private access profile. A separately configured
reverse proxy is also supported. None of these profiles should publish the ARR
service ports directly.
