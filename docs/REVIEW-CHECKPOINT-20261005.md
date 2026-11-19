# Fixture catalog and monitoring review checkpoint — 2026-10-05

Base: `64e40a80507250a4a8ef3342bbe69769dcac81d8`.

## What this checkpoint contains

- Strict movie/TV catalog contexts, typed identities, independent paging and
  library sorting, with owned items excluded from discovery and search.
- Linked-user, privacy-scoped recommendation seeds and deduplicated unowned
  cards; unlinked users retain an honest generic fallback.
- Generic TVmaze catalog support behind an explicit configuration flag. The
  source default is disabled; the provider is not presented as trending or
  personalized. Its tests use loopback fixtures only.
- Fixture-only owner catalog views and preview controls.
- A narrow fixture-only monitored-state execution route. It requires owner and
  CSRF checks, exact `{type,itemId,monitored}` preview input, a current
  read-back revision, a short-lived owner-bound one-time plan, stale-state
  rejection, exact fixture PUT, final read-back, and explicit audit outcomes.
  Seasons, profiles, root folders, tags, and minimum availability remain
  preview-only. No delete, move, import, download, grab, or live upstream
  mutation is included.

## Runtime relationship and boundaries

The currently running isolated image is
`localhost/provisionarr-isolated:monitor-fixture-20261005`. It was built from
the exact working tree frozen by this checkpoint before this local commit was
created. Its upstream configuration is disconnected loopback fixtures; no
credentials, real library/history data, or runtime data are committed here.

The TV provider is default-disabled in source. Monitoring execution is
fixture-gated and rejects disabled fixture mode and non-loopback ARR targets.
The sanitised production compatibility evidence is not a source of runtime
configuration and is deliberately not included in this commit.

## Evidence

- Full backend Node suite in a disposable rootless container: **89/89 passed**.
- Focused fixture catalog/admin gate: **7/7 passed**.
- Fixture-only Chromium browser gate: **3/3 passed**.
- `git diff --check` passed before this checkpoint.

Browser screenshots are synthetic test artifacts. They remain outside this
commit and bundle; they are not release evidence or user-content captures.

## Reviewer focus

Review the typed ownership/privacy boundaries in `server.js`, the execution
guardrails around `/api/admin/catalog/monitor/*`, and their loopback fixture
coverage in `test/discovery-catalog.test.js`. This is a local review checkpoint
only: it has not been pushed, merged, or deployed by this commit.
