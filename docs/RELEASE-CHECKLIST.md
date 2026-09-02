# Release checklist

Provisionarr stays private until every required gate has current evidence in
the publication repository. An unchecked item is not a passed gate.

## Product and installation

- [ ] Sonarr, Radarr, Prowlarr, and qBittorrent connection tests pass
- [ ] Fresh-stack onboarding creates or retains both ARR root folders
- [ ] Fresh-stack onboarding registers qBittorrent with separate TV and movie
  categories
- [ ] Fresh-stack onboarding creates and verifies both Prowlarr application
  links
- [ ] Indexer credentials remain administrator-supplied in Prowlarr
- [ ] Preview, apply, verification, automatic failure recovery, and manual
  rollback pass against an isolated four-service stack
- [ ] Docker installation passes from the documented files
- [ ] Native Provisionarr installation passes with the documented systemd path
- [ ] Upgrade and rollback preserve `/data`

## Security and publication

- [ ] Complete reachable Git history and working tree pass the secret scan
- [ ] Private infrastructure and personal data scans pass
- [ ] Owner and ordinary-user authorization tests pass
- [ ] CSRF, session, request-body, upstream URL, and rate-limit tests pass
- [ ] Repository, package, image, and domain namespace review is complete
- [ ] Approved source artwork and favicon are reproducible
- [ ] `SECURITY.md` names the generic private reporting process
- [ ] Support policy is documented without personal contact data

## Build and release

- [ ] Node.js checks and test suite pass
- [ ] Browser checks pass for desktop and mobile layouts
- [ ] AMD64 container build and smoke test pass
- [ ] ARM64 container build and smoke test pass
- [ ] CI checks pass on the clean publication commit
- [ ] Container release workflow has provenance and an SBOM enabled
- [ ] Changelog and support policy identify the published release
- [ ] Release tag points to the clean commit with passing checks
- [ ] GitHub publication is complete only after all preceding items pass

## Evidence rule

Record exact commands, commit identifiers, image digests, tested platforms,
browser dimensions, install results, migration results, and rollback results in
[RELEASE-EVIDENCE.md](RELEASE-EVIDENCE.md). Do not record API keys, passwords,
setup tokens, private URLs, private IP addresses, hostnames, filesystem paths,
user data, or torrent identifiers.
