# Provisionarr project scope

Provisionarr has one product with two setup paths. Both paths lead to the same
request and administration interface.

## Supported core

The core product connects to an existing Sonarr, Radarr, Prowlarr, and
qBittorrent installation. It provides:

- separate household and system-administrator accounts;
- Movie and TV discovery sections, title search, and request confirmation;
- Emby-backed library state;
- request, download, import, health, and audit views; and
- server-side credentials with owner-only administration.

Changes to this area must preserve existing installations and user data.

## Onboarding preview

The onboarding branch is adding two explicit first-run choices:

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

These features are outside the current release commitment:

- VPN installation or interface binding;
- automatic media movement across mounts;
- arbitrary shell commands or unrestricted filesystem paths;
- a local AI assistant;
- public tunnel or DNS automation;
- automatic acquisition of indexer-provider credentials; and
- native installation of the complete third-party media stack.

They may be proposed later with a narrow threat model, recovery plan, and test
environment. Deferring them keeps the first public collaboration surface small
enough to review.

## Promotion rule

A preview feature becomes supported only after its API tests, browser flow,
clean ARM64 installation, clean AMD64 installation, upgrade, and rollback checks
are recorded in `docs/RELEASE-EVIDENCE.md`.
