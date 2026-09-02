const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'provisionarr-query-'));
process.env.PROVISIONARR_CONFIG_ROOT = testRoot;
process.env.PROVISIONARR_REQUEST_LOG = path.join(testRoot, 'requests.json');
process.env.PROVISIONARR_SETUP_TOKEN_FILE = path.join(testRoot, 'setup-token.txt');
process.env.PROVISIONARR_ADMIN_FILE = path.join(testRoot, 'admin.json');
process.env.PROVISIONARR_USERS_FILE = path.join(testRoot, 'users.json');
process.env.PROVISIONARR_SETTINGS_FILE = path.join(testRoot, 'settings.json');
process.env.PROVISIONARR_AUDIT_FILE = path.join(testRoot, 'audit.jsonl');

const {parseMediaQuery, canonicalTitle, rankMediaResults, seasonList, sanitizeAvatar, resolvePublicFile, upstreamTransport} = require('../server');

test.after(() => fs.rmSync(testRoot, {recursive: true, force: true}));

test('accepts real profile images and rejects disguised content', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  assert.equal(sanitizeAvatar(png), png);
  assert.throws(() => sanitizeAvatar('data:image/png;base64,SGVsbG8='), /not a valid supported image/);
  assert.equal(sanitizeAvatar('', png), '');
});

test('normalizes Southpark and extracts numeric and ordinal seasons', () => {
  const numeric = parseMediaQuery('Southpark season 1');
  assert.equal(numeric.title, 'southpark');
  assert.equal(numeric.canonicalTitle, 'south park');
  assert.equal(numeric.mediaType, 'series');
  assert.equal(numeric.seasonNumber, 1);

  const ordinal = parseMediaQuery('Can you tell me if the first season of southpark could be downloaded?');
  assert.equal(ordinal.canonicalTitle, 'south park');
  assert.equal(ordinal.seasonNumber, 1);
  const titleWithArticle = parseMediaQuery('first season of The Office');
  assert.equal(titleWithArticle.canonicalTitle, 'the office');
  assert.equal(titleWithArticle.seasonNumber, 1);
  assert.equal(canonicalTitle('Southpark'), 'south park');
});

test('ranks an exact canonical Sonarr result above unrelated lookup results', () => {
  const parsed = parseMediaQuery('Southpark season 1');
  const ranked = rankMediaResults([
    {title: 'The Four Seasons', serviceId: 'sonarr', arrId: 1},
    {title: 'South Park', serviceId: 'sonarr', arrId: 2},
    {title: 'Seasoning the Seasons', serviceId: 'sonarr', arrId: 3}
  ], parsed);
  assert.deepEqual(ranked.map(x => x.title), ['South Park']);
});

test('season monitoring preserves other existing seasons and enables the requested one', () => {
  const result = seasonList([
    {seasonNumber: 1, monitored: false},
    {seasonNumber: 2, monitored: true}
  ], 1, true);
  assert.equal(result.find(x => x.seasonNumber === 1).monitored, true);
  assert.equal(result.find(x => x.seasonNumber === 2).monitored, true);
});

test('static paths remain inside the public directory', () => {
  assert.equal(resolvePublicFile('/index.html').endsWith('/public/index.html'), true);
  assert.equal(resolvePublicFile('/../publicity/secret.txt'), null);
  assert.equal(resolvePublicFile('/../../package.json'), null);
});

test('upstream transport accepts private HTTP services and rejects public plaintext targets', () => {
  const privateUrl=(octets,port)=>new URL(`http://${octets.join('.')}:${port}`);
  assert.equal(typeof upstreamTransport(new URL('https://media.example.com'), 'Media').request, 'function');
  assert.equal(typeof upstreamTransport(new URL('http://127.0.0.1:8989'), 'Sonarr').request, 'function');
  assert.equal(typeof upstreamTransport(privateUrl([10,20,30,40],8096), 'Emby').request, 'function');
  assert.equal(typeof upstreamTransport(privateUrl([172,20,0,2],8989), 'Sonarr').request, 'function');
  assert.equal(typeof upstreamTransport(privateUrl([192,168,50,2],7878), 'Radarr').request, 'function');
  assert.equal(typeof upstreamTransport(privateUrl([100,64,1,2],9696), 'Prowlarr').request, 'function');
  assert.equal(typeof upstreamTransport(new URL('http://nucbox:8096'), 'Emby').request, 'function');
  assert.throws(() => upstreamTransport(new URL('http://127.0.0.1.attacker.example:8989'), 'Sonarr'), /plaintext HTTP/);
  assert.throws(() => upstreamTransport(new URL('http://sonarr.example.invalid:8989'), 'Sonarr'), /plaintext HTTP/);
  assert.throws(() => upstreamTransport(new URL('http://169.254.169.254/latest/meta-data'), 'Media'), /plaintext HTTP/);
  assert.throws(() => upstreamTransport(new URL('http://8.8.8.8'), 'Media'), /plaintext HTTP/);
  assert.throws(() => upstreamTransport(new URL('file:///tmp/socket'), 'Sonarr'), /HTTP or HTTPS/);
});
