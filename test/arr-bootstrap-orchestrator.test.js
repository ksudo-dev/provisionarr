'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const orchestrator = require('../lib/arr-bootstrap-orchestrator');

const choices = Object.freeze({
  sonarrRoot: '/media/tv/',
  radarrRoot: '/media/movies',
  qbittorrentUrl: 'https://qbittorrent.local:8443/qbt/',
  qbittorrentUsername: 'arr-user',
  qbittorrentPassword: 'correct horse battery staple',
  sonarrCategory: 'tv',
  radarrCategory: 'movies'
});

function qbitSchema(service) {
  return {
    implementation: 'QBittorrent',
    implementationName: 'qBittorrent',
    configContract: 'QBittorrentSettings',
    infoLink: 'https://wiki.servarr.com/sonarr/settings#download-clients',
    tags: [],
    presets: [],
    fields: [
      { name: 'host', value: 'old-host', type: 'textbox', advanced: false, helpText: '', isFloat: false, label: 'Host', order: 1, privacy: 'normal', selectOptions: [] },
      { name: 'port', value: 8080, type: 'number' },
      { name: 'useSsl', value: false, type: 'checkbox' },
      { name: 'urlBase', value: '', type: 'textbox' },
      { name: 'username', value: 'old-user', type: 'textbox' },
      { name: 'password', value: '', type: 'password' },
      { name: service === 'sonarr' ? 'tvCategory' : 'movieCategory', value: 'old-category', type: 'textbox' },
      { name: 'recentMoviePriority', value: 0, type: 'number' }
    ]
  };
}

function emptyService(service) {
  return {
    rootFolders: [],
    downloadClients: [],
    downloadClientSchemas: [qbitSchema(service)]
  };
}

function emptySnapshot() {
  return { sonarr: emptyService('sonarr'), radarr: emptyService('radarr') };
}

function requestFor(plan, service, resource) {
  return plan.requests.find((request) => request.service === service && request.resource === resource);
}

function field(resource, name) {
  return resource.fields.find((item) => item.name === name);
}

function snapshotFromPlan(plan, password = choices.qbittorrentPassword) {
  const result = emptySnapshot();
  for (const service of orchestrator.SERVICES) {
    const root = requestFor(plan, service, 'rootFolder');
    const client = requestFor(plan, service, 'downloadClient');
    result[service].rootFolders = root ? [{ id: service === 'sonarr' ? 1 : 2, path: root.body.path }] : [];
    if (client) {
      const body = JSON.parse(JSON.stringify(client.body));
      body.id = service === 'sonarr' ? 11 : 12;
      field(body, 'password').value = password;
      result[service].downloadClients = [body];
    }
  }
  return result;
}

test('plans fresh Sonarr and Radarr roots and managed qBittorrent clients', () => {
  const plan = orchestrator.preview(choices, emptySnapshot());
  assert.equal(plan.version, 1);
  assert.equal(plan.isEmpty, false);
  assert.equal(plan.changes.length, 4);
  assert.equal(plan.requests.length, 4);
  assert.deepEqual(plan.changes.find((change) => change.kind === 'rootFolder'), {
    service: 'sonarr', kind: 'rootFolder', action: 'create', label: 'Media root folder',
    before: 'Not configured', after: '/media/tv'
  });
  assert.deepEqual(plan.changes.find((change) => change.kind === 'downloadClient'), {
    service: 'sonarr', kind: 'downloadClient', action: 'create', label: 'Provisionarr qBittorrent',
    before: 'Not configured', after: 'Configured qBittorrent download client using tv'
  });

  for (const service of orchestrator.SERVICES) {
    const root = requestFor(plan, service, 'rootFolder');
    const client = requestFor(plan, service, 'downloadClient');
    assert.deepEqual(root.body, { path: service === 'sonarr' ? '/media/tv' : '/media/movies' });
    assert.equal(client.method, 'POST');
    assert.equal(client.path, '/api/v3/downloadclient');
    assert.equal(client.body.name, 'Provisionarr qBittorrent');
    assert.equal(client.body.enable, true);
    assert.equal(client.body.priority, 1);
    assert.equal(client.body.implementation, 'QBittorrent');
    assert.equal(client.body.configContract, 'QBittorrentSettings');
    assert.equal(client.body.protocol, 'torrent');
    assert.equal(client.body.removeCompletedDownloads, true);
    assert.equal(client.body.removeFailedDownloads, true);
    assert.deepEqual(client.body.tags, []);
    assert.equal(field(client.body, 'host').value, 'qbittorrent.local');
    assert.equal(field(client.body, 'port').value, 8443);
    assert.equal(field(client.body, 'useSsl').value, true);
    assert.equal(field(client.body, 'urlBase').value, '/qbt');
    assert.equal(field(client.body, 'username').value, 'arr-user');
    assert.equal(field(client.body, 'password').value, choices.qbittorrentPassword);
    assert.equal(field(client.body, service === 'sonarr' ? 'tvCategory' : 'movieCategory').value, service === 'sonarr' ? 'tv' : 'movies');
    assert.equal(field(client.body, 'recentMoviePriority').value, 0);
  }
});

test('is idempotent after the managed resources exist, including masked ARR passwords', () => {
  const first = orchestrator.preview(choices, emptySnapshot());
  const snapshot = snapshotFromPlan(first, '********');
  const second = orchestrator.preview(choices, snapshot);
  assert.equal(second.isEmpty, true);
  assert.deepEqual(orchestrator.applicationRequests(second), []);
  assert.equal(orchestrator.matches(first, snapshot), true);
  assert.deepEqual(orchestrator.mismatchFields(first, snapshot), []);
});

test('updates only the Provisionarr-managed client and retains rollback data', () => {
  const first = orchestrator.preview(choices, emptySnapshot());
  const snapshot = snapshotFromPlan(first);
  const unrelated = {
    id: 99,
    name: 'Manual qBittorrent',
    enable: false,
    implementation: 'QBittorrent',
    protocol: 'torrent',
    fields: [{ name: 'host', value: 'manual-host' }]
  };
  snapshot.sonarr.downloadClients.push(unrelated);
  field(snapshot.sonarr.downloadClients[0], 'host').value = 'old-host';
  const plan = orchestrator.preview(choices, snapshot);
  const update = requestFor(plan, 'sonarr', 'downloadClient');
  assert.equal(update.method, 'PUT');
  assert.equal(update.path, '/api/v3/downloadclient/11');
  assert.equal(update.body.id, 11);
  assert.equal(update.original.id, 11);
  assert.equal(update.original.name, 'Provisionarr qBittorrent');
  assert.equal(plan.requests.some((request) => request.service === 'radarr'), false);
  assert.equal(snapshot.sonarr.downloadClients.find((client) => client.id === 99).name, 'Manual qBittorrent');
});

test('normalizes trailing and repeated root slashes for exact root matching', () => {
  const snapshot = emptySnapshot();
  snapshot.sonarr.rootFolders = [{ id: 1, path: '/media//tv/' }];
  snapshot.radarr.rootFolders = [{ id: 2, path: '/media/movies' }];
  const plan = orchestrator.preview(choices, snapshot);
  assert.equal(plan.requests.some((request) => request.resource === 'rootFolder'), false);
  assert.equal(plan.requests.length, 2);
});

test('rejects altered private requests and altered public changes', () => {
  const plan = orchestrator.preview(choices, emptySnapshot());
  const changedRequest = { ...plan, requests: plan.requests.map((request) => ({ ...request })) };
  changedRequest.requests[0].body = { path: '/etc' };
  assert.throws(() => orchestrator.applicationRequests(changedRequest), /tampered request/);

  const changedChange = { ...plan, changes: plan.changes.map((change) => ({ ...change, detail: 'changed' })) };
  assert.throws(() => orchestrator.publicPlan(changedChange), /tampered request/);
});

test('rejects unsafe roots, URL credentials, query strings, fragments, and unsupported input', () => {
  for (const root of ['/', '/etc', '/var/lib', '../media/tv', '/media/../etc', '/media\\tv']) {
    assert.throws(() => orchestrator.preview({ ...choices, sonarrRoot: root }, emptySnapshot()), /safe absolute Linux path|system root/);
  }
  for (const url of [
    'ftp://qbittorrent.local:8080',
    ['http://user:pass','qbittorrent.local:8080'].join('@'),
    'http://qbittorrent.local:8080/qbt?x=1',
    'http://qbittorrent.local:8080/qbt#fragment',
    'http://qbittorrent.local:8080/../admin'
  ]) {
    assert.throws(() => orchestrator.preview({ ...choices, qbittorrentUrl: url }, emptySnapshot()), /HTTP or HTTPS|traversal/);
  }
  assert.throws(() => orchestrator.preview({ ...choices, lidarrRoot: '/media/music' }, emptySnapshot()), /unsupported or missing/);
  assert.throws(() => orchestrator.preview({ ...choices, qbittorrentUsername: '' }, emptySnapshot()), /invalid|cannot be empty/);
});

test('public plans exclude credentials, private host values, and private rollback data', () => {
  const plan = orchestrator.preview(choices, emptySnapshot());
  const publicView = orchestrator.publicPlan(plan);
  const serialized = JSON.stringify(publicView);
  assert.equal(serialized.includes(choices.qbittorrentUsername), false);
  assert.equal(serialized.includes(choices.qbittorrentPassword), false);
  assert.equal(serialized.includes('qbittorrent.local'), false);
  assert.equal(serialized.includes('/media/tv'), true);
  assert.equal(serialized.includes('/media/movies'), true);
  assert.equal(Object.hasOwn(publicView, 'requests'), false);
  assert.equal(Object.hasOwn(publicView, 'integrity'), false);
});

test('reports managed root and client mismatches while accepting an ARR masked password', () => {
  const plan = orchestrator.preview(choices, emptySnapshot());
  const snapshot = snapshotFromPlan(plan, '**********');
  field(snapshot.radarr.downloadClients[0], 'movieCategory').value = 'wrong';
  assert.deepEqual(orchestrator.mismatchFields(plan, snapshot), ['radarr.downloadClient.movieCategory']);
  assert.equal(orchestrator.matches(plan, snapshot), false);
  field(snapshot.radarr.downloadClients[0], 'movieCategory').value = 'movies';
  assert.equal(orchestrator.matches(plan, snapshot), true);
});
