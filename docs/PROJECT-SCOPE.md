# Provisionarr project scope

I maintain one Provisionarr product with two setup paths. Both lead to the
same request and administration interface.

## Supported core

The core product connects to an existing Sonarr, Radarr, Prowlarr, and
qBittorrent installation. It provides:

- separate household and system-administrator accounts;
- Movie and TV discovery sections, title search, and request confirmation;
- Emby-backed library state;
- request, download, import, health, and audit views; and
- server-side credentials with owner-only administration.

I require changes to this area to preserve existing installations and user data.

## Onboarding preview

The onboarding preview on `main` provides two explicit first-run choices:

1. Connect services that already exist.
2. Prepare a managed Sonarr, Radarr, Prowlarr, and qBittorrent stack.

The managed path may generate pinned deployment files and review native ARR
changes. It does not receive a Docker socket or run arbitrary host commands.
Apply actions stay behind an owner-only feature flag until clean installation,
rollback, ARM64, and AMD64 checks pass.

## Public collaboration lanes

Issues and pull requests should fit one lane:

- **Core:** requests, accounts, discovery, library, downloads, and reliability.
- **Existing stack setup:** service connections, validation, and readable
  configuration.
- **Managed stack setup:** generated deployment files, native API
  orchestration, verification, and rollback.
- **Documentation and testing:** installation, migration, security, and
  architecture-specific validation.

A pull request should change one lane unless a tested interface change requires
two. New server behavior needs tests before it is moved into a release
milestone.

## Deferred work

I'm deferring these features beyond the current release:

- VPN installation or interface binding;
- automatic media movement across mounts;
- arbitrary shell commands or unrestricted filesystem paths;
- a local AI assistant;
- public tunnel or DNS automation;
- automatic acquisition of indexer-provider credentials; and
- native installation of the complete third-party media stack.

You can propose them later with a narrow threat model, recovery plan, and test
environment. This keeps the first public collaboration surface small enough to
review.

## Promotion rule

I mark a preview feature as supported only after recording its API tests,
browser flow, clean ARM64 installation, clean AMD64 installation, upgrade, and
rollback checks in `docs/RELEASE-EVIDENCE.md`.
