# Contributing

Provisionarr is preparing its first public release. Keep changes aligned with its central rule: ordinary users receive a simple media-request experience, while technical and destructive operations remain authenticated, owner-only, explicit, and auditable.

Read `docs/PROJECT-SCOPE.md` before starting work. Choose one contribution
lane and keep the pull request inside it. Managed-stack work is preview code
until its clean-install and rollback evidence is complete.

Before opening a pull request:

```sh
npm ci --ignore-scripts
npm run public-safety
npm run check
npm test
npm audit
docker build -t provisionarr:test .
```

Pull requests run the Node.js checks on AMD64 and build and smoke-test both AMD64 and ARM64 container images.

Configure the repository hook once after cloning:

```sh
git config core.hooksPath .githooks
```

The pre-push hook runs the same credential and private-data scan as CI. Do not bypass it. Do not commit credentials, private service URLs, request history, setup tokens, screenshots containing personal data, or runtime data. Security concerns should follow `SECURITY.md` rather than a public issue.
