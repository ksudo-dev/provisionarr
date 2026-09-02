const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const scanner = path.join(__dirname, '..', 'scripts', 'public-data-scan.mjs');

function git(root, ...args) {
  return execFileSync('git', args, {cwd:root, encoding:'utf8', stdio:['ignore', 'pipe', 'pipe']});
}

function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.writeFileSync(target, content);
}

test('public-data scan checks commits reachable from non-HEAD refs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provisionarr-public-scan-'));
  try {
    git(root, 'init', '-b', 'main');
    git(root, 'config', 'user.name', 'Provisionarr Test');
    git(root, 'config', 'user.email', 'provisionarr-test@users.noreply.github.com');
    write(root, 'Dockerfile', `FROM node:22-alpine@sha256:${'a'.repeat(64)}\n`);
    write(root, 'scripts/public-safety-scan.sh', `GITLEAKS_IMAGE="zricethezav/gitleaks@sha256:${'b'.repeat(64)}"\n`);
    write(root, '.github/workflows/ci.yml', `steps:\n  - uses: actions/checkout@${'c'.repeat(40)}\n`);
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'safe root');
    git(root, 'checkout', '-b', 'retained-history');
    write(root, '.github/workflows/ci.yml', 'steps:\n  - uses: actions/checkout@v7\n');
    git(root, 'add', '.github/workflows/ci.yml');
    git(root, 'commit', '-m', 'mutable action reference');
    git(root, 'checkout', 'main');

    assert.throws(
      () => execFileSync(process.execPath, [scanner], {cwd:root, encoding:'utf8', stdio:['ignore', 'pipe', 'pipe']}),
      error => String(error.stderr).includes('Mutable GitHub Action reference')
    );
  } finally {
    fs.rmSync(root, {recursive:true, force:true});
  }
});
