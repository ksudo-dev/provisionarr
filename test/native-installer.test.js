const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const installer = path.join(root, 'scripts', 'install-native.sh');
const uninstaller = path.join(root, 'scripts', 'uninstall-native.sh');

test('native installer scripts pass bash syntax validation', () => {
  execFileSync('bash', ['-n', installer]);
  execFileSync('bash', ['-n', uninstaller]);
});

test('native installer help is non-mutating', () => {
  const help = execFileSync(installer, ['--help'], { encoding: 'utf8' });
  assert.match(help, /--dry-run/);
  assert.match(help, /dependencies are never downloaded/i);
  const uninstallHelp = execFileSync(uninstaller, ['--help'], { encoding: 'utf8' });
  assert.match(uninstallHelp, /--purge --yes/);
  assert.match(uninstallHelp, /remain\s+untouched/i);
});

test('native service is loopback-only and unprivileged', () => {
  const unit = fs.readFileSync(path.join(root, 'packaging', 'systemd', 'provisionarr.service'), 'utf8');
  assert.match(unit, /User=provisionarr/);
  assert.match(unit, /Group=provisionarr/);
  assert.match(unit, /Environment=PROVISIONARR_LISTEN_HOST=127\.0\.0\.1/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /NoNewPrivileges=true/);
});

test('container image includes server modules', () => {
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /COPY --chown=node:node lib \.\/lib/);
});

test('media stack deployment command documents dry run and rollback', () => {
  const script = path.join(root, 'scripts', 'deploy-media-stack.mjs');
  const help = execFileSync(process.execPath, [script, '--help'], {encoding:'utf8'});
  assert.match(help, /--dry-run/);
  assert.match(help, /--verify/);
  assert.match(help, /--apply --yes/);
  assert.match(help, /--rollback --yes/);
  assert.match(help, /preserving configuration, downloads, and media/i);
});
