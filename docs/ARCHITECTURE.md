# Architecture

Provisionarr is a Node.js service and browser application. It translates a
small set of user and administrator actions into fixed native API requests for
Sonarr, Radarr, Prowlarr, and qBittorrent.

## Product surfaces

- Household users: Home, Discover, Search, Existing Library, Requests, and
  Account
- System administrator: Admin, Guided setup, Downloads, Activity, Status,
  Logs, and Settings

The server enforces these role boundaries. Navigation visibility isn't the
authorization control.

## Service integrations

- Sonarr: series lookup, season requests, root folders, quality profiles,
  download clients, queue, history, health, and allowlisted settings
- Radarr: movie lookup, root folders, quality profiles, download clients,
  queue, history, health, and allowlisted settings
- Prowlarr: health, indexer visibility, and native Sonarr/Radarr application
  links
- qBittorrent: authenticated connection checks, save location, queue state,
  progress, and the download-client configuration used by Sonarr and Radarr
- Emby: existing-library synchronization and recommendation data

Provisionarr never creates indexer-provider credentials. The administrator adds
the provider in Prowlarr, which remains responsible for synchronizing that
indexer to linked applications.

## Fresh-stack onboarding

The owner-only onboarding transaction accepts service connections and a small
set of deployment choices. It builds an expiring preview containing only
allowlisted native requests:

1. create or retain the selected Sonarr root folder;
2. create or retain the selected Radarr root folder;
3. create or update qBittorrent as Sonarr's download client with the TV
   category;
4. create or update qBittorrent as Radarr's download client with the movie
   category; and
5. create or update Prowlarr's Sonarr and Radarr application links.

The administrator reviews the preview before apply. The service tests proposed
links, writes a private backup, applies changes in a fixed order, verifies the
resulting resources, and restores recorded resources when a multi-service write
fails. A manual rollback uses the same backup record.

The web service doesn't execute Docker, mount a Docker socket, run shell
commands, or accept arbitrary endpoints. The separate host deployment command
handles generated Compose lifecycle actions.

## State and credentials

Users, settings, connection credentials, request history, audit events,
notification state, and hashed sessions live in the mounted data directory.
Structured state uses temporary files and atomic replacement. API keys and
qBittorrent passwords aren't returned to the browser after saving.

Onboarding previews are short-lived and bound to the administrator who created
them. The server rejects an expired, reused, or altered preview. Apply is
serialized so two multi-service changes can't update the same stack at once.

Provisionarr never opens, moves, executes, or classifies rejected release files.
Failed-release repair is sent to the owning Sonarr or Radarr API, which handles
removal, deletion, blocklisting, and replacement search.

## Access profiles

Provisionarr supports LAN HTTP, tailnet-only HTTPS, and administrator-managed
reverse proxies. Tailnet-only HTTPS is an access profile, not a product
requirement. Public access needs a separate HTTPS and access-policy review.

Upstream service ports remain private. Forwarded headers are trusted only when
a reviewed reverse proxy replaces them and direct access to Provisionarr is
blocked.

## Deferred operations

Automatic media movement across mounts remains outside the onboarding
transaction until approved mount roots, free-space behavior, verification, and
recovery actions are defined. The same allowlist and rollback rules apply to
future storage features.
