const assert = require('node:assert/strict');
const test = require('node:test');
const {isExpectedFreshProwlarrHealthFailure} = require('./fixtures/fresh-prowlarr-health.cjs');

test('accepts only the exact fresh Prowlarr indexer and update conditions', () => {
  assert.equal(isExpectedFreshProwlarrHealthFailure({
    source: 'IndexerCheck',
    type: 'error',
    message: 'No indexers enabled, Prowlarr will not return search results'
  }), true);
  assert.equal(isExpectedFreshProwlarrHealthFailure({
    source: 'UpdateCheck',
    type: 'error',
    message: 'New update is available: v2.6.5.5623'
  }), true);
});

test('rejects unrelated, update-like, and fatal Prowlarr health conditions', () => {
  for (const health of [
    {source: 'DatabaseCheck', type: 'error', message: 'Database is corrupted'},
    {source: 'IndexerCheck', type: 'error', message: 'An update-indexer failure occurred'},
    {source: 'UpdateCheck', type: 'error', message: 'Update endpoint is unavailable'},
    {source: 'UpdateCheck', type: 'fatal', message: 'New update is available: v2.6.5.5623'}
  ]) {
    assert.equal(isExpectedFreshProwlarrHealthFailure(health), false);
  }
});
