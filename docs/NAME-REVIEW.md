# Provisionarr name and namespace review

We completed these technical namespace checks on 2026-08-31. This is not a trademark opinion or legal clearance.

## Reserved release names

- Source repository: `github.com/ksudo-dev/provisionarr`
- Container image: `ghcr.io/ksudo-dev/provisionarr`
- Application and package metadata: `provisionarr`
- Release tags: `v1.0.0` and later semantic versions

We keep the Node package private and have not published it to npm. We don't claim or require a custom domain for Provisionarr 1.0.

## Checks completed

Our checks found:

- no separate GitHub repository named exactly `Provisionarr`;
- no npm package named `provisionarr`;
- no Docker Hub repository at `provisionarr/provisionarr` or
  `ksudodev/provisionarr`;
- no intended GHCR image before we added the first release workflow; and
- no active DNS records or RDAP registration records for the `.com`, `.net`,
  `.org`, and `.dev` names. We did not check other extensions.

Searches can change after this review. Recheck the source and container namespaces before changing the project name, publishing to another registry, or adopting a domain. Anyone planning commercial use should perform an independent trademark review.
