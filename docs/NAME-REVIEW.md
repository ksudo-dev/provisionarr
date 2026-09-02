# Provisionarr name and namespace review

This review records technical namespace checks completed on 2026-08-31. It is not a trademark opinion or legal clearance.

## Reserved release names

- Source repository: `github.com/ksudo-dev/provisionarr`
- Container image: `ghcr.io/ksudo-dev/provisionarr`
- Application and package metadata: `provisionarr`
- Release tags: `v1.0.0` and later semantic versions

The Node package remains private and is not published to npm. Provisionarr 1.0 does not claim or require a custom domain.

## Checks completed

- GitHub repository search returned no separate repository whose exact name is `Provisionarr`.
- The npm registry returned no package named `provisionarr`.
- Docker Hub returned no repository at `provisionarr/provisionarr` or `ksudodev/provisionarr`.
- The intended GHCR image did not exist before the first release workflow was added.
- The `.com`, `.net`, `.org`, and `.dev` names returned no active DNS records and no registration record from their RDAP services. No claim is made for unverified domain extensions.

Searches can change after this review. Recheck the source and container namespaces before changing the project name, publishing to another registry, or adopting a domain. Anyone planning commercial use should perform an independent trademark review.
