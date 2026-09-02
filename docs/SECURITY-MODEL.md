# Security model

## Roles

`owner` is the system administrator. The owner may view service health, logs, download/import diagnostics, integration settings, and safe ARR controls.

`user` may search, view requestable recommendations, see the existing media library, and manage their own requests. Technical service details are replaced with: "Something needs attention. Please contact your system administrator."

## Request execution model

Search text is interpreted into a small media intent schema. Deterministic server code resolves titles, seasons, users, and ARR records. Provisionarr accepts neither arbitrary URLs nor shell instructions, and users cannot supply raw ARR request bodies.

Mutations use short-lived, single-use, user-bound proposals. A visible confirmation is required. Confirmation endpoints revalidate the session, CSRF token, proposal lifetime, target, and current upstream state.

## Deployment assumptions

- HTTPS terminates at a trusted local reverse proxy or Tailscale Serve.
- Upstream ARR and download-client ports are not publicly exposed.
- Runtime data is mounted outside the image with owner-only permissions.
- The container runs without unnecessary capabilities and without a broad host configuration mount in the standalone deployment.
- Reverse-proxy headers are ignored by default. `PROVISIONARR_TRUST_PROXY=true` is valid only when direct access to the application port is blocked.
- `PROVISIONARR_SECURE_COOKIES=true` is required when HTTPS is the only supported browser entry point.
