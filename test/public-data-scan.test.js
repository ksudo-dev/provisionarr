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

const allowanceModule = path.join(__dirname, '..', 'scripts', 'public-data-fixture-allowances.mjs');
const historicalBlobs = {
  c648: ['147f6e2ff758f003', 'b031b0943dd64897', '32a20376'].join(''),
  checkpoint: ['2f449baf8b1c5b64', '8bdd6f0c2247db62', 'bb9a74fa'].join(''),
  latest: ['bc20d8769840db64', '7d729502a01258fd', '23b05747'].join(''),
};
const historicalPrivateAddress = ['192', '168', '50', '9'].join('.');
const historicalPosterUserinfo = 'user' + '@' + 'static.tvmaze.com';

test('historical fixture allowance is exact to blob, path, rule, and value', async () => {
  const {isHistoricalSyntheticFixture} = await import(allowanceModule);
  const context = {path:'test/discovery-catalog.test.js'};
  for (const blob of Object.values(historicalBlobs)) {
    assert.equal(isHistoricalSyntheticFixture({...context, rule:'private IPv4 address', value:historicalPrivateAddress, blob}), true);
  }
  for (const blob of [historicalBlobs.c648, historicalBlobs.latest]) {
    assert.equal(isHistoricalSyntheticFixture({...context, rule:'personal email address', value:historicalPosterUserinfo, blob}), true);
  }
  assert.equal(isHistoricalSyntheticFixture({...context, rule:'private IPv4 address', value:historicalPrivateAddress, blob:historicalBlobs.c648.slice(0,-1)+'0'}), false);
  assert.equal(isHistoricalSyntheticFixture({path:'test/other.test.js', rule:'private IPv4 address', value:historicalPrivateAddress, blob:historicalBlobs.c648}), false);
  assert.equal(isHistoricalSyntheticFixture({...context, rule:'private IPv4 address', value:['192','168','50','10'].join('.'), blob:historicalBlobs.c648}), false);
  assert.equal(isHistoricalSyntheticFixture({...context, rule:'personal email address', value:'person' + '@' + 'private.invalid', blob:historicalBlobs.c648}), false);
  assert.equal(isHistoricalSyntheticFixture({...context, rule:'32-character hexadecimal token', value:'0123456789abcdef' + '0123456789abcdef', blob:historicalBlobs.c648}), false);
  assert.equal(isHistoricalSyntheticFixture({...context, rule:'private IPv4 address', value:historicalPrivateAddress}), false);
});

test('public-data scan retains failures from reachable non-HEAD refs', () => {
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
