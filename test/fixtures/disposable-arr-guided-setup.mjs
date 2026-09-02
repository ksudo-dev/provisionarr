import assert from 'node:assert/strict';

const env = process.env;
const base = env.DISPOSABLE_APP_URL;
const required = [
  'DISPOSABLE_APP_URL',
  'DISPOSABLE_SETUP_TOKEN',
  'DISPOSABLE_SONARR_KEY',
  'DISPOSABLE_RADARR_KEY',
  'DISPOSABLE_PROWLARR_KEY',
  'DISPOSABLE_QBIT_PASSWORD',
  'DISPOSABLE_SONARR_NATIVE_URL',
  'DISPOSABLE_RADARR_NATIVE_URL',
  'DISPOSABLE_PROWLARR_NATIVE_URL'
];
assert.ok(required.every(name => env[name]), 'Disposable guided setup credentials or service URLs are incomplete.');

const secrets = required
  .filter(name => /KEY|PASSWORD|TOKEN/.test(name))
  .map(name => env[name])
  .filter(Boolean);
const sensitiveName = /api.?key|password|passwd|token|secret|authorization|cookie|credential/i;

function scrub(value, key = '') {
  if (sensitiveName.test(key)) return '[redacted]';
  if (typeof value === 'string') return secrets.reduce((result, secret) => result.split(secret).join('[redacted]'), value);
  if (Array.isArray(value)) return value.map(item => scrub(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, scrub(item, name)]));
  return value;
}

function safeDetails(value) {
  try { return JSON.stringify(scrub(value)); } catch { return '[unserializable response]'; }
}

function assertNoSecrets(label, payload) {
  const serialized = JSON.stringify(payload);
  for (const secret of secrets) assert.equal(serialized.includes(secret), false, `${label} contained a credential.`);
}

function assertStatus(result, expected, label) {
  assert.equal(result.response.status, expected, `${label} returned HTTP ${result.response.status}: ${safeDetails(result.payload)}`);
  assertNoSecrets(label, result.payload);
}

async function request(path, options = {}) {
  const headers = {accept: 'application/json', ...(options.body === undefined ? {} : {'content-type': 'application/json'})};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.csrf) headers['x-csrf-token'] = options.csrf;
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch (error) {
    throw new Error(`${path} could not be reached: ${error.message}`);
  }
  let payload = {};
  try { payload = await response.json(); } catch {}
  return {response, payload};
}

async function nativeRequest(serviceUrl, apiKey, path, options = {}) {
  const headers = {'x-api-key': apiKey, accept: 'application/json', ...(options.body === undefined ? {} : {'content-type': 'application/json'})};
  let response;
  try {
    response = await fetch(`${serviceUrl}${path}`, {
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch (error) {
    throw new Error(`${path} on the disposable native service could not be reached: ${error.message}`);
  }
  let payload = {};
  try { payload = await response.json(); } catch {}
  return {response, payload};
}

function session(response, payload) {
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie && payload.csrf, 'Provisionarr did not establish an owner session.');
  return {cookie, csrf: payload.csrf};
}

let owner;
async function admin(path, options = {}) {
  return request(path, {...options, cookie: owner.cookie, csrf: owner.csrf});
}

async function save(path, body, attempts = 120) {
  let lastStatus = 0;
  let lastError = 'unknown response';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await admin(path, {method: 'PUT', body});
    if (result.response.status === 200) {
      assertNoSecrets(path, result.payload);
      return result.payload;
    }
    lastStatus = result.response.status;
    lastError = safeDetails(String(result.payload?.error || result.payload?.code || 'unknown response'));
    if (![409, 422, 502, 503].includes(result.response.status)) {
      assert.equal(result.response.status, 200, `${path} returned HTTP ${result.response.status}: ${safeDetails(result.payload)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`${path} did not become ready after ${attempts} attempts (HTTP ${lastStatus}: ${lastError}).`);
}

function nativeRows(result, label) {
  assert.ok(result.response.status >= 200 && result.response.status < 300, `${label} returned HTTP ${result.response.status}: ${safeDetails(result.payload)}`);
  assert.ok(Array.isArray(result.payload), `${label} did not return an array.`);
  return result.payload;
}

function clientField(client, name) {
  return client.fields?.find(field => field.name === name)?.value ?? client[name];
}

function qbitClient(clients) {
  return clients.find(client => /qbittorrent/i.test(`${client.name || ''} ${client.implementation || ''}`));
}

function testBody(client, category) {
  const body = structuredClone(client);
  body.fields = (body.fields || []).map(field => {
    const next = {...field};
    if (field.name === 'host') next.value = 'qbittorrent';
    if (field.name === 'port') next.value = 8080;
    if (field.name === 'username') next.value = 'admin';
    if (field.name === 'password') next.value = env.DISPOSABLE_QBIT_PASSWORD;
    if (field.name === 'tvCategory') next.value = category === 'tv-sonarr' ? category : field.value;
    if (field.name === 'movieCategory') next.value = category === 'radarr' ? category : field.value;
    return next;
  });
  return body;
}

async function testDownloadClient(serviceUrl, apiKey, client, category, label) {
  const tested = await nativeRequest(serviceUrl, apiKey, '/api/v3/downloadclient/test', {method: 'POST', body: testBody(client, category)});
  assert.ok(tested.response.status >= 200 && tested.response.status < 300, `${label} rejected the qBittorrent test request with HTTP ${tested.response.status}: ${safeDetails(tested.payload)}`);
  if (tested.payload && typeof tested.payload === 'object' && Object.hasOwn(tested.payload, 'isValid')) {
    assert.equal(tested.payload.isValid, true, `${label} reported an invalid qBittorrent client: ${safeDetails(tested.payload)}`);
  }
}

async function main() {
  const setup = await request('/api/admin/setup', {
    method: 'POST',
    body: {
      setupToken: env.DISPOSABLE_SETUP_TOKEN,
      username: 'disposable-owner',
      displayName: 'Disposable Owner',
      password: 'disposable-owner-password'
    }
  });
  assertStatus(setup, 201, 'Provisionarr owner setup');
  owner = session(setup.response, setup.payload);

  await save('/api/admin/orchestration/connections/sonarr', {url: 'http://sonarr:8989', apiKey: env.DISPOSABLE_SONARR_KEY});
  await save('/api/admin/orchestration/connections/radarr', {url: 'http://radarr:7878', apiKey: env.DISPOSABLE_RADARR_KEY});
  await save('/api/admin/orchestration/connections/prowlarr', {url: 'http://prowlarr:9696', apiKey: env.DISPOSABLE_PROWLARR_KEY});
  await save('/api/admin/orchestration/connections/qbittorrent', {url: 'http://qbittorrent:8080', username: 'admin', password: env.DISPOSABLE_QBIT_PASSWORD}, 30);

  const initialSonarrRoots = nativeRows(await nativeRequest(env.DISPOSABLE_SONARR_NATIVE_URL, env.DISPOSABLE_SONARR_KEY, '/api/v3/rootfolder'), 'Fresh Sonarr root folders');
  const initialRadarrRoots = nativeRows(await nativeRequest(env.DISPOSABLE_RADARR_NATIVE_URL, env.DISPOSABLE_RADARR_KEY, '/api/v3/rootfolder'), 'Fresh Radarr root folders');
  const initialSonarrClients = nativeRows(await nativeRequest(env.DISPOSABLE_SONARR_NATIVE_URL, env.DISPOSABLE_SONARR_KEY, '/api/v3/downloadclient'), 'Fresh Sonarr download clients');
  const initialRadarrClients = nativeRows(await nativeRequest(env.DISPOSABLE_RADARR_NATIVE_URL, env.DISPOSABLE_RADARR_KEY, '/api/v3/downloadclient'), 'Fresh Radarr download clients');
  assert.equal(initialSonarrRoots.length, 0, 'Fresh Sonarr already had a root folder.');
  assert.equal(initialRadarrRoots.length, 0, 'Fresh Radarr already had a root folder.');
  assert.equal(initialSonarrClients.length, 0, 'Fresh Sonarr already had a download client.');
  assert.equal(initialRadarrClients.length, 0, 'Fresh Radarr already had a download client.');

  const inventory = await admin('/api/admin/orchestration/inventory');
  assertStatus(inventory, 200, 'Initial Provisionarr service inventory');
  assert.equal(inventory.payload.services.every(service => service.connected), true, 'Sonarr and Radarr were not connected.');
  assert.equal(inventory.payload.supportServices.every(service => service.connected), true, 'Prowlarr and qBittorrent were not connected.');
  assert.equal(inventory.payload.supportServices.find(service => service.id === 'qbittorrent')?.compatibility.state, 'ready');
  assert.equal(inventory.payload.supportServices.find(service => service.id === 'prowlarr')?.compatibility.counts.applicationLinks, 0);

  const bootstrapBody = {
    sonarrRoot: '/tv',
    radarrRoot: '/movies',
    qbittorrentUrl: 'http://qbittorrent:8080',
    qbittorrentUsername: 'admin',
    qbittorrentPassword: env.DISPOSABLE_QBIT_PASSWORD,
    sonarrCategory: 'tv-sonarr',
    radarrCategory: 'radarr'
  };
  const bootstrapPlan = await admin('/api/admin/orchestration/bootstrap/plan', {method: 'POST', body: bootstrapBody});
  assertStatus(bootstrapPlan, 200, 'Fresh-stack bootstrap preview');
  assert.equal(bootstrapPlan.payload.plan?.mode, 'preview', 'Fresh-stack bootstrap did not return a preview plan.');
  assert.ok(bootstrapPlan.payload.planId, 'Fresh-stack bootstrap preview did not return a plan identifier.');
  const publicPlan = JSON.stringify(bootstrapPlan.payload.plan).toLowerCase();
  for (const expected of ['/tv', '/movies', 'qbittorrent', 'tv-sonarr', 'radarr']) {
    assert.equal(publicPlan.includes(expected.toLowerCase()), true, `Fresh-stack preview omitted ${expected}.`);
  }

  const bootstrapApplied = await admin(`/api/admin/orchestration/bootstrap/plans/${bootstrapPlan.payload.planId}/apply`, {method: 'POST', body: {}});
  assertStatus(bootstrapApplied, 200, 'Fresh-stack bootstrap apply');
  assert.equal(bootstrapApplied.payload.backup?.status, 'applied', 'Fresh-stack bootstrap did not finish in the applied state.');
  assert.ok(bootstrapApplied.payload.backup?.id, 'Fresh-stack bootstrap did not return a rollback backup identifier.');

  const sonarrRoots = nativeRows(await nativeRequest(env.DISPOSABLE_SONARR_NATIVE_URL, env.DISPOSABLE_SONARR_KEY, '/api/v3/rootfolder'), 'Configured Sonarr root folders');
  const radarrRoots = nativeRows(await nativeRequest(env.DISPOSABLE_RADARR_NATIVE_URL, env.DISPOSABLE_RADARR_KEY, '/api/v3/rootfolder'), 'Configured Radarr root folders');
  const sonarrClients = nativeRows(await nativeRequest(env.DISPOSABLE_SONARR_NATIVE_URL, env.DISPOSABLE_SONARR_KEY, '/api/v3/downloadclient'), 'Configured Sonarr download clients');
  const radarrClients = nativeRows(await nativeRequest(env.DISPOSABLE_RADARR_NATIVE_URL, env.DISPOSABLE_RADARR_KEY, '/api/v3/downloadclient'), 'Configured Radarr download clients');
  assert.ok(sonarrRoots.some(root => root.path === '/tv'), 'Sonarr did not retain /tv.');
  assert.ok(radarrRoots.some(root => root.path === '/movies'), 'Radarr did not retain /movies.');
  const sonarrQbit = qbitClient(sonarrClients);
  const radarrQbit = qbitClient(radarrClients);
  assert.ok(sonarrQbit, 'Sonarr has no managed qBittorrent download client.');
  assert.ok(radarrQbit, 'Radarr has no managed qBittorrent download client.');
  assert.equal(sonarrQbit.enable !== false, true, 'Sonarr qBittorrent client is disabled.');
  assert.equal(radarrQbit.enable !== false, true, 'Radarr qBittorrent client is disabled.');
  assert.equal(clientField(sonarrQbit, 'tvCategory'), 'tv-sonarr', 'Sonarr qBittorrent category is incorrect.');
  assert.equal(clientField(radarrQbit, 'movieCategory'), 'radarr', 'Radarr qBittorrent category is incorrect.');
  await testDownloadClient(env.DISPOSABLE_SONARR_NATIVE_URL, env.DISPOSABLE_SONARR_KEY, sonarrQbit, 'tv-sonarr', 'Sonarr');
  await testDownloadClient(env.DISPOSABLE_RADARR_NATIVE_URL, env.DISPOSABLE_RADARR_KEY, radarrQbit, 'radarr', 'Radarr');

  const prowlarrPlan = await admin('/api/admin/orchestration/prowlarr/plan', {
    method: 'POST',
    body: {
      prowlarrUrl: 'http://prowlarr:9696',
      sonarrUrl: 'http://sonarr:8989',
      radarrUrl: 'http://radarr:7878',
      syncLevel: 'fullSync'
    }
  });
  assertStatus(prowlarrPlan, 200, 'Prowlarr application-link preview');
  assert.equal(prowlarrPlan.payload.plan.mode, 'preview');
  assert.deepEqual(prowlarrPlan.payload.plan.changes.map(change => change.service).sort(), ['radarr', 'sonarr']);

  const prowlarrApplied = await admin(`/api/admin/orchestration/prowlarr/plans/${prowlarrPlan.payload.planId}/apply`, {method: 'POST', body: {}});
  assertStatus(prowlarrApplied, 200, 'Prowlarr application-link apply');
  assert.equal(prowlarrApplied.payload.backup.status, 'applied');
  assert.ok(prowlarrApplied.payload.backup.id, 'Prowlarr apply did not return a rollback backup identifier.');

  const nativeApplications = nativeRows(await nativeRequest(env.DISPOSABLE_PROWLARR_NATIVE_URL, env.DISPOSABLE_PROWLARR_KEY, '/api/v1/applications'), 'Configured Prowlarr applications');
  assert.equal(nativeApplications.length, 2, 'Prowlarr did not create both application links.');
  assert.equal(nativeApplications.some(application => /sonarr/i.test(application.name || application.implementation || '')), true, 'Prowlarr Sonarr link is missing.');
  assert.equal(nativeApplications.some(application => /radarr/i.test(application.name || application.implementation || '')), true, 'Prowlarr Radarr link is missing.');

  const finalInventory = await admin('/api/admin/orchestration/inventory');
  assertStatus(finalInventory, 200, 'Final Provisionarr compatibility inventory');
  const finalSonarr = finalInventory.payload.services.find(service => service.id === 'sonarr');
  const finalRadarr = finalInventory.payload.services.find(service => service.id === 'radarr');
  const finalProwlarr = finalInventory.payload.supportServices.find(service => service.id === 'prowlarr');
  const finalQbit = finalInventory.payload.supportServices.find(service => service.id === 'qbittorrent');
  assert.equal(finalSonarr?.compatibility.state, 'ready', 'Final Sonarr compatibility is not ready.');
  assert.equal(finalRadarr?.compatibility.state, 'ready', 'Final Radarr compatibility is not ready.');
  assert.equal(finalQbit?.compatibility.state, 'ready', 'Final qBittorrent compatibility is not ready.');
  assert.ok(finalProwlarr, 'Final Prowlarr compatibility is missing.');
  if (finalProwlarr.compatibility.state === 'ready') {
    assert.equal(finalProwlarr.compatibility.checks.find(check => check.id === 'enabled_indexer')?.state, 'pass');
  } else {
    assert.equal(finalProwlarr.compatibility.state, 'needs_configuration', 'Prowlarr reported an unexpected compatibility state.');
    const remaining = finalProwlarr.compatibility.checks.filter(check => check.state === 'fail');
    const nativeHealth = nativeRows(
      await nativeRequest(env.DISPOSABLE_PROWLARR_NATIVE_URL, env.DISPOSABLE_PROWLARR_KEY, '/api/v1/health'),
      'Prowlarr native health'
    );
    const nativeFailures = nativeHealth.filter(item => ['error', 'fatal'].includes(String(item.type || item.level || '').toLowerCase()));
    assert.equal(
      nativeFailures.length > 0 && nativeFailures.every(item => /indexer/i.test(JSON.stringify(item))),
      true,
      `Fresh Prowlarr reported a failing health condition unrelated to its expected missing indexer provider: ${JSON.stringify(nativeFailures)}`
    );
    assert.deepEqual(
      remaining.map(check => check.id),
      ['health', 'enabled_indexer'],
      `Prowlarr has an unexpected failure beyond its provider-specific indexer prerequisite: ${JSON.stringify(remaining)}`
    );
    assert.match(remaining.find(check => check.id === 'enabled_indexer').summary, /no enabled indexer/i);
  }
  assert.equal(finalProwlarr.compatibility.checks.find(check => check.id === 'sonarr_link')?.state, 'pass');
  assert.equal(finalProwlarr.compatibility.checks.find(check => check.id === 'radarr_link')?.state, 'pass');

  const backups = await admin('/api/admin/orchestration/backups');
  assertStatus(backups, 200, 'Provisionarr orchestration backups');
  const prowlarrBackup = backups.payload.backups.find(item => item.id === prowlarrApplied.payload.backup.id);
  const bootstrapBackup = backups.payload.backups.find(item => item.id === bootstrapApplied.payload.backup.id);
  assert.ok(prowlarrBackup, 'Applied Prowlarr backup was not listed.');
  assert.ok(bootstrapBackup, 'Applied fresh-stack backup was not listed.');

  const prowlarrRollback = await admin(`/api/admin/orchestration/backups/${prowlarrBackup.id}/rollback`, {method: 'POST', body: {}});
  assertStatus(prowlarrRollback, 200, 'Prowlarr rollback');
  assert.equal(prowlarrRollback.payload.backup.status, 'rolled_back');
  const rolledBackApplications = nativeRows(await nativeRequest(env.DISPOSABLE_PROWLARR_NATIVE_URL, env.DISPOSABLE_PROWLARR_KEY, '/api/v1/applications'), 'Rolled-back Prowlarr applications');
  assert.equal(rolledBackApplications.length, 0, 'Prowlarr application links remained after rollback.');

  const bootstrapRollback = await admin(`/api/admin/orchestration/backups/${bootstrapBackup.id}/rollback`, {method: 'POST', body: {}});
  assertStatus(bootstrapRollback, 200, 'Fresh-stack bootstrap rollback');
  assert.equal(bootstrapRollback.payload.backup.status, 'rolled_back');
  const rolledBackSonarrRoots = nativeRows(await nativeRequest(env.DISPOSABLE_SONARR_NATIVE_URL, env.DISPOSABLE_SONARR_KEY, '/api/v3/rootfolder'), 'Rolled-back Sonarr root folders');
  const rolledBackRadarrRoots = nativeRows(await nativeRequest(env.DISPOSABLE_RADARR_NATIVE_URL, env.DISPOSABLE_RADARR_KEY, '/api/v3/rootfolder'), 'Rolled-back Radarr root folders');
  const rolledBackSonarrClients = nativeRows(await nativeRequest(env.DISPOSABLE_SONARR_NATIVE_URL, env.DISPOSABLE_SONARR_KEY, '/api/v3/downloadclient'), 'Rolled-back Sonarr download clients');
  const rolledBackRadarrClients = nativeRows(await nativeRequest(env.DISPOSABLE_RADARR_NATIVE_URL, env.DISPOSABLE_RADARR_KEY, '/api/v3/downloadclient'), 'Rolled-back Radarr download clients');
  assert.equal(rolledBackSonarrRoots.length, 0, 'Sonarr root folders remained after rollback.');
  assert.equal(rolledBackRadarrRoots.length, 0, 'Radarr root folders remained after rollback.');
  assert.equal(rolledBackSonarrClients.length, 0, 'Sonarr download clients remained after rollback.');
  assert.equal(rolledBackRadarrClients.length, 0, 'Radarr download clients remained after rollback.');

  const rolledBackInventory = await admin('/api/admin/orchestration/inventory');
  assertStatus(rolledBackInventory, 200, 'Post-rollback Provisionarr inventory');
  assert.equal(rolledBackInventory.payload.supportServices.find(service => service.id === 'prowlarr')?.compatibility.counts.applicationLinks, 0);
  assert.equal(rolledBackInventory.payload.services.find(service => service.id === 'sonarr')?.rootFolders.length, 0);
  assert.equal(rolledBackInventory.payload.services.find(service => service.id === 'radarr')?.rootFolders.length, 0);
  assert.equal(rolledBackInventory.payload.services.find(service => service.id === 'sonarr')?.downloadClients.length, 0);
  assert.equal(rolledBackInventory.payload.services.find(service => service.id === 'radarr')?.downloadClients.length, 0);

  console.log('Disposable ARR guided setup passed: four isolated services, native fresh-state checks, Provisionarr connections, bootstrap preview/apply, roots, qBittorrent clients, test endpoints, Prowlarr links, compatibility, and rollback.');
}

main().catch(error => {
  console.error(`Disposable ARR guided setup failed: ${error.message}`);
  process.exitCode = 1;
});
