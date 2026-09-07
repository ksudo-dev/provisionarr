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
assert.ok(required.every(name => env[name]), 'Disposable existing-stack credentials or service URLs are incomplete.');

const secrets = required
  .filter(name => /KEY|PASSWORD|TOKEN/.test(name))
  .map(name => env[name])
  .filter(Boolean);

function assertNoSecrets(label, payload) {
  const serialized = JSON.stringify(payload);
  for (const secret of secrets) assert.equal(serialized.includes(secret), false, `${label} contained a credential.`);
}

async function request(path, options = {}) {
  const headers = {accept: 'application/json', ...(options.body === undefined ? {} : {'content-type': 'application/json'})};
  if (options.cookie) headers.cookie = options.cookie;
  if (options.csrf) headers['x-csrf-token'] = options.csrf;
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  let payload = {};
  try { payload = await response.json(); } catch {}
  assertNoSecrets(path, payload);
  return {response, payload};
}

function assertStatus(result, expected, label) {
  assert.equal(result.response.status, expected, `${label} returned HTTP ${result.response.status}.`);
}

async function nativeRows(url, key, path, label) {
  const response = await fetch(`${url}${path}`, {headers:{'x-api-key':key, accept:'application/json'}});
  assert.ok(response.ok, `${label} returned HTTP ${response.status}.`);
  const payload = await response.json();
  assert.ok(Array.isArray(payload), `${label} did not return an array.`);
  return payload;
}

async function main() {
  const before = {
    sonarrRoots: await nativeRows(env.DISPOSABLE_SONARR_NATIVE_URL, env.DISPOSABLE_SONARR_KEY, '/api/v3/rootfolder', 'Initial Sonarr roots'),
    radarrRoots: await nativeRows(env.DISPOSABLE_RADARR_NATIVE_URL, env.DISPOSABLE_RADARR_KEY, '/api/v3/rootfolder', 'Initial Radarr roots'),
    sonarrClients: await nativeRows(env.DISPOSABLE_SONARR_NATIVE_URL, env.DISPOSABLE_SONARR_KEY, '/api/v3/downloadclient', 'Initial Sonarr clients'),
    radarrClients: await nativeRows(env.DISPOSABLE_RADARR_NATIVE_URL, env.DISPOSABLE_RADARR_KEY, '/api/v3/downloadclient', 'Initial Radarr clients'),
    prowlarrApplications: await nativeRows(env.DISPOSABLE_PROWLARR_NATIVE_URL, env.DISPOSABLE_PROWLARR_KEY, '/api/v1/applications', 'Initial Prowlarr applications')
  };

  const setup = await request('/api/admin/setup', {
    method: 'POST',
    body: {
      setupToken: env.DISPOSABLE_SETUP_TOKEN,
      username: 'existing-owner',
      displayName: 'Existing Stack Owner',
      password: 'existing-owner-password'
    }
  });
  assertStatus(setup, 201, 'Existing-stack owner setup');
  const cookie = setup.response.headers.get('set-cookie')?.split(';')[0];
  const csrf = setup.payload.csrf;
  assert.ok(cookie && csrf, 'Existing-stack setup did not establish an owner session.');

  async function admin(path, options = {}) {
    return request(path, {...options, cookie, csrf});
  }

  const mode = await admin('/api/admin/orchestration/mode', {method:'PUT', body:{mode:'existing'}});
  assertStatus(mode, 200, 'Existing-stack mode selection');
  assert.equal(mode.payload.mode, 'existing');

  const connections = [
    ['/api/admin/orchestration/connections/sonarr', {url:'http://sonarr:8989', apiKey:env.DISPOSABLE_SONARR_KEY}],
    ['/api/admin/orchestration/connections/radarr', {url:'http://radarr:7878', apiKey:env.DISPOSABLE_RADARR_KEY}],
    ['/api/admin/orchestration/connections/prowlarr', {url:'http://prowlarr:9696', apiKey:env.DISPOSABLE_PROWLARR_KEY}],
    ['/api/admin/orchestration/connections/qbittorrent', {url:'http://qbittorrent:8080', username:'admin', password:env.DISPOSABLE_QBIT_PASSWORD}]
  ];
  for (const [path, body] of connections) {
    const saved = await admin(path, {method:'PUT', body});
    assertStatus(saved, 200, `${path} connection`);
  }

  const bootstrap = await admin('/api/bootstrap');
  assertStatus(bootstrap, 200, 'Existing-stack bootstrap');
  assert.equal(bootstrap.payload.setupMode, 'existing');
  const inventory = await admin('/api/admin/orchestration/inventory');
  assertStatus(inventory, 200, 'Existing-stack inventory');
  assert.equal(inventory.payload.services.every(service => service.connected), true);
  assert.equal(inventory.payload.supportServices.every(service => service.connected), true);
  assert.equal(inventory.payload.connections.every(connection => connection.source === 'saved'), true);

  const after = {
    sonarrRoots: await nativeRows(env.DISPOSABLE_SONARR_NATIVE_URL, env.DISPOSABLE_SONARR_KEY, '/api/v3/rootfolder', 'Final Sonarr roots'),
    radarrRoots: await nativeRows(env.DISPOSABLE_RADARR_NATIVE_URL, env.DISPOSABLE_RADARR_KEY, '/api/v3/rootfolder', 'Final Radarr roots'),
    sonarrClients: await nativeRows(env.DISPOSABLE_SONARR_NATIVE_URL, env.DISPOSABLE_SONARR_KEY, '/api/v3/downloadclient', 'Final Sonarr clients'),
    radarrClients: await nativeRows(env.DISPOSABLE_RADARR_NATIVE_URL, env.DISPOSABLE_RADARR_KEY, '/api/v3/downloadclient', 'Final Radarr clients'),
    prowlarrApplications: await nativeRows(env.DISPOSABLE_PROWLARR_NATIVE_URL, env.DISPOSABLE_PROWLARR_KEY, '/api/v1/applications', 'Final Prowlarr applications')
  };
  assert.deepEqual(after, before, 'Existing-stack setup changed an upstream service.');
  console.log('Disposable existing-stack setup passed: clean owner setup, explicit mode, four saved connections, inventory, and zero upstream writes.');
}

main().catch(error => {
  console.error(`Disposable existing-stack setup failed: ${error.message}`);
  process.exitCode = 1;
});
