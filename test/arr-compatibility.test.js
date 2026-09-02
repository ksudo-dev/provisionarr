'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {prowlarrCompatibility, qBittorrentCompatibility} = require('../lib/arr-compatibility');

test('Prowlarr compatibility returns redacted checks for a usable stack', () => {
  const result = prowlarrCompatibility({
    status: {authenticated: true, version: '1.0.0', apiKey: 'secret'},
    health: [{level: 'notice', message: 'ok', token: 'secret'}],
    indexers: [{name: 'Indexer One', enable: true, fields: [{value: 'secret'}]}],
    applications: [{name: 'Sonarr', enable: true, fields: [{value: 'secret'}]}, {implementation: 'Radarr', enable: true}]
  });
  assert.equal(result.service, 'prowlarr');
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.checks.map(item => [item.id, item.state]), [
    ['authenticated', 'pass'],
    ['health', 'pass'],
    ['enabled_indexer', 'pass'],
    ['sonarr_link', 'pass'],
    ['radarr_link', 'pass']
  ]);
  assert.deepEqual(result.counts, {indexers: 1, enabledIndexers: 1, applicationLinks: 2});
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(JSON.stringify(result).includes('message'), false);
});

test('Prowlarr compatibility identifies missing links and unhealthy status', () => {
  const result = prowlarrCompatibility({
    status: {authenticated: false},
    health: [{level: 'error', message: 'indexer failed'}],
    indexers: [{name: 'Disabled', enable: false}],
    applications: [{name: 'Other', enable: true}]
  });
  assert.equal(result.state, 'needs_configuration');
  assert.deepEqual(result.checks.map(item => item.state), ['fail', 'fail', 'fail', 'fail', 'fail']);
});

test('Prowlarr treats an available empty health response as healthy', () => {
  const result=prowlarrCompatibility({status:{authenticated:true},health:[],indexers:[{enable:true}],applications:[{name:'Sonarr'},{name:'Radarr'}]});
  assert.equal(result.checks.find(item=>item.id==='health').state,'pass');
});

test('qBittorrent compatibility exposes only queue counts and check summaries', () => {
  const result = qBittorrentCompatibility({
    authenticated: true,
    version: 'v5.0.0',
    preferences: {save_path: '/downloads', username: 'secret'},
    queue: [{name: 'private torrent name', state: 'downloading', hash: 'secret'}, {state: 'paused'}]
  });
  assert.equal(result.service, 'qbittorrent');
  assert.equal(result.state, 'ready');
  assert.deepEqual(result.counts, {queueItems: 2, queueStates: {downloading: 1, paused: 1}});
  assert.equal(JSON.stringify(result).includes('private torrent name'), false);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('qBittorrent compatibility rejects missing authentication, path, and queue access', () => {
  const result = qBittorrentCompatibility({version: 'v5.0.0', preferences: {save_path: 'downloads'}});
  assert.equal(result.state, 'needs_configuration');
  assert.deepEqual(result.checks.map(item => [item.id, item.state]), [
    ['authenticated_version', 'fail'],
    ['default_save_path', 'fail'],
    ['queue_visibility', 'fail']
  ]);
});

test('qBittorrent groups unknown queue states without returning upstream text', () => {
  const result=qBittorrentCompatibility({authenticated:true,version:'v5',preferences:{save_path:'/downloads'},queue:[{state:'private-state-name'}]});
  assert.deepEqual(result.counts.queueStates,{other:1});
  assert.equal(JSON.stringify(result).includes('private-state-name'),false);
});
