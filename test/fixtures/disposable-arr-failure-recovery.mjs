import assert from 'node:assert/strict';
import fs from 'node:fs';

const env = process.env;
const base = env.DISPOSABLE_APP_URL;
const phase = process.argv[2];
const stateFile = env.DISPOSABLE_FAILURE_STATE;
assert.ok(base && stateFile && ['prepare', 'apply', 'verify'].includes(phase), 'Failure recovery check needs an app URL, state file, and valid phase.');

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  let payload = {};
  try { payload = await response.json(); } catch {}
  return {response, payload};
}

async function login() {
  const result = await jsonRequest(`${base}/api/auth/login`, {
    method:'POST',
    headers:{'content-type':'application/json', accept:'application/json'},
    body:JSON.stringify({username:'disposable-owner', password:'disposable-owner-password'})
  });
  assert.equal(result.response.status, 200, `Failure recovery login returned HTTP ${result.response.status}.`);
  const cookie = result.response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie && result.payload.csrf, 'Failure recovery login did not establish an owner session.');
  return {cookie, csrf:result.payload.csrf};
}

async function admin(path, options = {}) {
  const owner = await login();
  return jsonRequest(`${base}${path}`, {
    ...options,
    headers:{
      accept:'application/json',
      cookie:owner.cookie,
      ...(options.body === undefined ? {} : {'content-type':'application/json'}),
      ...(options.method && options.method !== 'GET' ? {'x-csrf-token':owner.csrf} : {})
    },
    body:options.body === undefined ? undefined : JSON.stringify(options.body)
  });
}

async function nativeConfig(url, key) {
  const response = await fetch(`${url}/api/v3/config/mediamanagement`, {headers:{'x-api-key':key, accept:'application/json'}});
  assert.equal(response.status, 200, `Native media configuration returned HTTP ${response.status}.`);
  return response.json();
}

function publicState(state) {
  return {
    planId:state.planId,
    originalSonarr:state.originalSonarr,
    originalRadarr:state.originalRadarr
  };
}

async function prepare() {
  const sonarr = await nativeConfig(env.DISPOSABLE_SONARR_NATIVE_URL, env.DISPOSABLE_SONARR_KEY);
  const radarr = await nativeConfig(env.DISPOSABLE_RADARR_NATIVE_URL, env.DISPOSABLE_RADARR_KEY);
  const state = {
    originalSonarr:Boolean(sonarr.renameEpisodes),
    originalRadarr:Boolean(radarr.renameMovies)
  };
  const plan = await admin('/api/admin/orchestration/plan', {
    method:'POST',
    body:{desired:{
      sonarr:{mediaManagement:{renameFiles:!state.originalSonarr}},
      radarr:{mediaManagement:{renameFiles:!state.originalRadarr}}
    }}
  });
  assert.equal(plan.response.status, 200, `Failure preview returned HTTP ${plan.response.status}.`);
  assert.deepEqual(plan.payload.plan.changes.map(change => change.service), ['sonarr', 'radarr']);
  state.planId = plan.payload.planId;
  fs.writeFileSync(stateFile, JSON.stringify(publicState(state)), {mode:0o600});
  console.log('Disposable controlled-failure preview passed.');
}

async function apply() {
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const result = await admin(`/api/admin/orchestration/plans/${state.planId}/apply`, {method:'POST', body:{}});
  assert.ok(result.response.status >= 400, `Controlled failure unexpectedly returned HTTP ${result.response.status}.`);
  const backups = await admin('/api/admin/orchestration/backups');
  assert.equal(backups.response.status, 200);
  const backup = backups.payload.backups.find(item => item.planId === state.planId);
  assert.ok(backup, 'Controlled failure did not create a rollback record.');
  assert.equal(backup.status, 'automatically_rolled_back', `Controlled failure ended in ${backup.status}.`);
  state.backupId = backup.id;
  fs.writeFileSync(stateFile, JSON.stringify(publicState(state)), {mode:0o600});
  console.log('Disposable controlled failure triggered automatic rollback.');
}

async function verify() {
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const sonarr = await nativeConfig(env.DISPOSABLE_SONARR_NATIVE_URL, env.DISPOSABLE_SONARR_KEY);
  const radarr = await nativeConfig(env.DISPOSABLE_RADARR_NATIVE_URL, env.DISPOSABLE_RADARR_KEY);
  assert.equal(Boolean(sonarr.renameEpisodes), state.originalSonarr, 'Sonarr did not return to its pre-failure setting.');
  assert.equal(Boolean(radarr.renameMovies), state.originalRadarr, 'Radarr changed during the failed apply.');
  const inventory = await admin('/api/admin/orchestration/inventory');
  assert.equal(inventory.response.status, 200);
  assert.equal(inventory.payload.services.every(service => service.connected), true, 'ARR services did not recover after the controlled failure.');
  console.log('Disposable automatic recovery passed after the unavailable service returned.');
}

if (phase === 'prepare') await prepare();
if (phase === 'apply') await apply();
if (phase === 'verify') await verify();
