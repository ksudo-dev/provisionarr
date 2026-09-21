import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const mode = process.argv[2];
const base = process.env.UPGRADE_APP_URL;
const root = process.env.UPGRADE_DATA_ROOT;
assert.ok(['seed', 'verify'].includes(mode) && base && root, 'Upgrade fixture needs a mode, URL, and data root.');

const ownerName = 'upgrade-owner';
const ownerPassword = 'upgrade-owner-password';
const requestId = 'upgrade-fixture-request';
const backupId = '11111111-1111-4111-8111-111111111111';

async function call(route, options = {}) {
  const headers = {accept:'application/json', ...(options.cookie ? {cookie:options.cookie} : {}),
    ...(options.csrf ? {'x-csrf-token':options.csrf} : {}),
    ...(options.body === undefined ? {} : {'content-type':'application/json'})};
  const response = await fetch(base + route, {
    method:options.method || 'GET',
    headers,
    body:options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  let body = {};
  try { body = await response.json(); } catch {}
  return {response, body};
}

async function expectStatus(route, status, options = {}) {
  const result = await call(route, options);
  assert.equal(result.response.status, status, route + ' returned HTTP ' + result.response.status);
  return result;
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(root, name), JSON.stringify(value) + '\n', {mode:0o600});
}

async function login() {
  const result = await expectStatus('/api/auth/login', 200, {
    method:'POST', body:{username:ownerName, password:ownerPassword}
  });
  const cookie = result.response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie && result.body.csrf, 'Owner login did not establish a session.');
  return {cookie, csrf:result.body.csrf};
}

async function seed() {
  const setupToken = fs.readFileSync(path.join(root, 'setup-token.txt'), 'utf8').trim();
  const created = await expectStatus('/api/admin/setup', 201, {
    method:'POST', body:{setupToken, username:ownerName, displayName:'Upgrade Fixture Owner', password:ownerPassword}
  });
  const cookie = created.response.headers.get('set-cookie')?.split(';')[0];
  const csrf = created.body.csrf;
  assert.ok(cookie && csrf && created.body.user?.id, 'Owner setup did not establish a session.');
  const admin = {cookie, csrf};

  await expectStatus('/api/admin/settings', 200, {
    ...admin, method:'PUT', body:{appName:'Upgrade Fixture', discoveryLimit:8, userAutoApprove:false}
  });
  await expectStatus('/api/admin/orchestration/mode', 200, {
    ...admin, method:'PUT', body:{mode:'existing'}
  });

  writeJson('requests.json', [{
    id:requestId, title:'Upgrade Fixture Film', service:'Movies',
    createdAt:'2026-01-01T00:00:00.000Z', status:'pending_approval',
    requestedBy:created.body.user.id, requestedByName:'Upgrade Fixture Owner'
  }]);
  const key = 'disposable-upgrade-key';
  writeJson('orchestration-connections.json', {version:1, services:{
    sonarr:{url:'http://localhost:9', apiKey:key},
    radarr:{url:'http://localhost:9', apiKey:key},
    prowlarr:{url:'http://localhost:9', apiKey:key},
    qbittorrent:{url:'http://localhost:9', username:'fixture', password:'disposable-upgrade-password'}
  }});
  const backupRoot = path.join(root, 'orchestration-backups');
  fs.mkdirSync(backupRoot, {recursive:true, mode:0o700});
  fs.writeFileSync(path.join(backupRoot, backupId + '.json'), JSON.stringify({
    id:backupId, createdAt:'2026-01-01T00:00:00.000Z', createdBy:created.body.user.id,
    status:'rolled_back', resources:[{
      service:'sonarr', path:'/api/v3/config/mediamanagement',
      method:'PUT', body:{renameEpisodes:true}
    }]
  }) + '\n', {mode:0o600});
  console.log('Disposable owner, settings, request, connections, audit, and recovery record seeded.');
}

async function verify() {
  const admin = await login();
  const bootstrap = (await expectStatus('/api/bootstrap', 200, admin)).body;
  assert.equal(bootstrap.authenticated, true);
  assert.equal(bootstrap.ownerAuthenticated, true);
  assert.equal(bootstrap.appName, 'Upgrade Fixture');
  assert.equal(bootstrap.setupMode, 'existing');

  const requests = (await expectStatus('/api/requests', 200, admin)).body.requests;
  assert.ok(requests.some(item => item.id === requestId && item.title === 'Upgrade Fixture Film'),
    'Stored request did not survive the version change.');

  const inventory = (await expectStatus('/api/admin/orchestration/inventory', 200, admin)).body;
  assert.equal(inventory.connections.length, 4);
  assert.ok(inventory.connections.every(item => item.source === 'saved'),
    'A saved connection did not survive the version change.');

  const backups = (await expectStatus('/api/admin/orchestration/backups', 200, admin)).body.backups;
  assert.ok(backups.some(item => item.id === backupId && item.status === 'rolled_back' && item.resourceCount === 1),
    'Recovery record did not survive the version change.');

  const users = JSON.parse(fs.readFileSync(path.join(root, 'users.json'), 'utf8'));
  assert.ok(users.some(item => item.username === ownerName && item.role === 'owner'));
  const settings = JSON.parse(fs.readFileSync(path.join(root, 'settings.json'), 'utf8'));
  assert.equal(settings.appName, 'Upgrade Fixture');
  assert.equal(settings.userAutoApprove, false);
  const actions = fs.readFileSync(path.join(root, 'audit.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line).action);
  for (const action of ['owner_setup', 'settings_updated', 'orchestration_mode_selected']) {
    assert.ok(actions.includes(action), 'Audit record ' + action + ' did not survive.');
  }
  console.log('Disposable account, settings, request, connections, audit, and recovery record verified.');
}

try {
  if (mode === 'seed') await seed();
  else await verify();
} catch (error) {
  console.error('Disposable upgrade persistence failed: ' + error.message);
  process.exitCode = 1;
}
