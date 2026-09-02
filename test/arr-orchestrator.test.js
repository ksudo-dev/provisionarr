'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const orchestrator = require('../lib/arr-orchestrator');

test('preview normalizes simplified settings into fixed native requests', () => {
  const plan = orchestrator.preview({
    sonarr: {
      mediaManagement: { renameFiles: true, replaceIllegalCharacters: false },
      downloadHandling: { completedDownloadHandling: true }
    },
    radarr: { mediaManagement: { renameFiles: true } }
  });

  assert.equal(plan.mode, 'preview');
  assert.equal(plan.changes.length, 4);
  assert.deepEqual(orchestrator.applicationRequests(plan), [
    {
      service: 'sonarr', method: 'PUT', path: '/api/v3/config/mediamanagement',
      body: { renameEpisodes: true, replaceIllegalCharacters: false }
    },
    {
      service: 'sonarr', method: 'PUT', path: '/api/v3/config/downloadclient',
      body: { enableCompletedDownloadHandling: true }
    },
    {
      service: 'radarr', method: 'PUT', path: '/api/v3/config/mediamanagement',
      body: { renameMovies: true }
    }
  ]);
});

test('diff is deterministic and omits unchanged settings', () => {
  const desired = { sonarr: { mediaManagement: { renameFiles: true, importExtraFiles: false } } };
  const current = { sonarr: { mediaManagement: { renameFiles: true, importExtraFiles: true } } };
  const first = orchestrator.diff(desired, current);
  const second = orchestrator.diff(desired, current);
  assert.deepEqual(first, second);
  assert.equal(first.mode, 'diff');
  assert.deepEqual(first.changes[0], {
    service: 'sonarr', group: 'mediaManagement', setting: 'importExtraFiles',
    nativeField: 'importExtraFiles', before: true, after: false
  });
});

test('repeating a plan is a no-op', () => {
  const desired = { radarr: { downloadHandling: { completedDownloadHandling: true } } };
  const current = { radarr: { downloadHandling: { completedDownloadHandling: true } } };
  const plan = orchestrator.preview(desired, current);
  assert.equal(plan.isEmpty, true);
  assert.deepEqual(orchestrator.applicationRequests(plan), []);
});

test('rejects unknown services, groups, and settings', () => {
  assert.throws(() => orchestrator.preview({ lidarr: {} }), /service is not supported/);
  assert.throws(() => orchestrator.preview({ sonarr: { paths: {} } }), /setting group is not supported/);
  assert.throws(() => orchestrator.preview({ sonarr: { mediaManagement: { qualityProfile: true } } }), /setting is not supported/);
});

test('rejects malformed values and sensitive fields instead of carrying them forward', () => {
  assert.throws(() => orchestrator.preview({ sonarr: { mediaManagement: { renameFiles: 'yes' } } }), /expected a boolean/);
  assert.throws(() => orchestrator.preview({ sonarr: { mediaManagement: { apiKey: true } } }), /sensitive field/);
  assert.throws(() => orchestrator.preview({}, { sonarr: { mediaManagement: { apiKey: false } } }), /sensitive fields cannot be supplied or echoed/);
});

test('application helper rejects forged or altered plans', () => {
  const plan = orchestrator.preview({ sonarr: { mediaManagement: { renameFiles: true } } });
  assert.equal(orchestrator.isSafePlan(plan), true);
  const forged = { ...plan, requests: [{ method: 'POST', service: 'sonarr', path: 'http://untrusted.invalid', body: { apiKey: 'x' } }] };
  assert.equal(orchestrator.isSafePlan(forged), false);
  assert.throws(() => orchestrator.applicationRequests(forged), /unsafe request/);
  const forgedField = { ...plan, requests: [{ ...plan.requests[0], body: { renameEpisodes: true, rootFolderPath: '/unsafe' } }] };
  assert.equal(orchestrator.isSafePlan(forgedField), false);
});

test('returned plans and request bodies cannot mutate future results', () => {
  const plan = orchestrator.preview({ sonarr: { mediaManagement: { renameFiles: true } } });
  assert.equal(Object.isFrozen(plan), true);
  assert.equal(Object.isFrozen(plan.requests), true);
  const requests = orchestrator.applicationRequests(plan);
  requests[0].body.renameEpisodes = false;
  assert.equal(orchestrator.applicationRequests(plan)[0].body.renameEpisodes, true);
});
