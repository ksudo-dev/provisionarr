# Provisionarr roadmap

## Current milestone: preserve the core

Give household users a short request path while giving the system administrator
an owner-only setup and operations surface for the ARR services.

- Keep existing-stack installation and upgrades predictable
- Keep Movies and TV shows in separate discovery and search sections
- Preserve authentication, request, download, library, and audit behavior
- Split large server and browser modules only through behavior-preserving
  changes with tests

## Next milestone: validate onboarding

- Finish the existing-stack connection walkthrough
- Finish the managed-stack file preview without host control
- Validate root folders, qBittorrent clients, and Prowlarr application links
  on an isolated stack
- Record clean ARM64 and AMD64 installation evidence
- Verify failed-apply recovery, upgrade, and rollback before promotion

## Later onboarding milestones

- Plain-language movie and episode size limits
- Guided Prowlarr indexer fields after the administrator supplies provider
  credentials
- Post-install service verification and repair guidance
- Native Provisionarr installation without Docker

## End-user experience

- Home and Discover rows for requestable movies and shows
- Exact title search with season selection
- Existing Library synchronized from Emby
- Per-user request history and readable availability states
- Persistent notification inbox with optional email delivery
- Storage holds that explain why a request is waiting

## System administrator experience

- One operations view for service health, storage, requests, and alerts
- Plain-language controls translated into fixed Sonarr and Radarr API actions
- User, notification, quality, storage-threshold, and request-policy settings
- Redacted application and audit logs
- Detailed service controls restricted to the system administrator
- Preview, verification, and rollback for multi-service changes

## Later releases

- Native installation and upgrade tooling for the complete media stack
- Allowlisted media migration with dry runs, checksums, and recovery steps
- Browser push notifications for installed HTTPS applications
- Backup, restore, and migration helpers
- Additional download clients behind the same allowlisted orchestration model

## Access profiles

Provisionarr treats access as a deployment choice:

- trusted LAN HTTP for local use;
- tailnet-only HTTPS through a private service proxy;
- an administrator-managed reverse proxy with certificates; or
- a managed tunnel with an explicit access policy.

Each remote recipe must keep upstream service ports private, require HTTPS,
validate forwarded headers, document failure recovery, and include rollback.

Remote access is documentation work for now. Provisionarr won't change DNS,
certificates, tunnels, or Tailscale settings from the application.

## Deferred storage actions

Provisionarr won't move media across mounts until the administrator defines
approved source and destination roots, free-space thresholds, verification
checks, and recovery behavior. The system won't accept arbitrary paths or shell
commands.
