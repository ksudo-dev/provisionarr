'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeOrchestrationUrl,
  normalizeOrchestrationKey,
  normalizeQbittorrentUsername,
  normalizeQbittorrentPassword,
  orchestrationTarget,
  assertSafeConnectionHost
} = require('../lib/arr-connections');

test('connection URLs preserve a service base path without accepting embedded credentials', () => {
  assert.equal(normalizeOrchestrationUrl('https://media.example.test/sonarr/'), 'https://media.example.test/sonarr');
  assert.equal(orchestrationTarget('https://media.example.test/sonarr', '/api/v3/system/status?x=1').href, 'https://media.example.test/sonarr/api/v3/system/status?x=1');
  assert.throws(() => normalizeOrchestrationUrl(['https://owner:secret','media.example.test/sonarr'].join('@')), /cannot contain credentials/);
  assert.throws(() => normalizeOrchestrationUrl('file:///etc/passwd'), /must use HTTP or HTTPS/);
  assert.throws(() => normalizeOrchestrationUrl('https://media.example.test/sonarr?token=secret'), /cannot contain credentials/);
});

test('connection hosts allow local media services but reject reserved metadata targets', () => {
  assert.equal(assertSafeConnectionHost('sonarr.internal'), 'sonarr.internal');
  assert.equal(normalizeOrchestrationUrl('http://sonarr.internal:8989'), 'http://sonarr.internal:8989');
  assert.throws(() => normalizeOrchestrationUrl('http://169.254.169.254/latest/meta-data'), /reserved/);
  assert.throws(() => normalizeOrchestrationUrl('https://metadata.google.internal'), /reserved/);
  assert.throws(() => normalizeOrchestrationUrl('http://[fe80::1]:8989'), /reserved/);
});

test('connection API keys reject empty, control-character, and oversized values', () => {
  assert.equal(normalizeOrchestrationKey(' 12345678 '), '12345678');
  assert.throws(() => normalizeOrchestrationKey('short'), /Enter the API key/);
  assert.throws(() => normalizeOrchestrationKey('1234567\n8'), /Enter the API key/);
  assert.throws(() => normalizeOrchestrationKey('x'.repeat(257)), /Enter the API key/);
});

test('qBittorrent credentials preserve passwords without accepting blank or control data', () => {
  assert.equal(normalizeQbittorrentUsername(' media-user '), 'media-user');
  assert.equal(normalizeQbittorrentPassword(' space is valid '), ' space is valid ');
  assert.throws(() => normalizeQbittorrentUsername(''), /qBittorrent username/);
  assert.throws(() => normalizeQbittorrentPassword('   '), /qBittorrent password/);
  assert.throws(() => normalizeQbittorrentPassword('bad\nvalue'), /qBittorrent password/);
});
