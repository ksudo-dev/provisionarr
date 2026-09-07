import assert from 'node:assert/strict';

const base = process.env.DISPOSABLE_APP_URL;
const mode = process.env.DISPOSABLE_EXPECTED_MODE;
const username = mode === 'existing' ? 'existing-owner' : 'disposable-owner';
const password = mode === 'existing' ? 'existing-owner-password' : 'disposable-owner-password';
assert.ok(base && ['existing', 'managed'].includes(mode), 'Persistence check needs an app URL and expected mode.');

async function main() {
  const login = await fetch(`${base}/api/auth/login`, {
    method:'POST',
    headers:{'content-type':'application/json', accept:'application/json'},
    body:JSON.stringify({username, password})
  });
  assert.equal(login.status, 200, `Login after ${mode} instance recreation returned HTTP ${login.status}.`);
  const payload = await login.json();
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie && payload.csrf, 'Recreated instance did not establish an owner session.');

  const bootstrapResponse = await fetch(`${base}/api/bootstrap`, {headers:{cookie, accept:'application/json'}});
  assert.equal(bootstrapResponse.status, 200);
  const bootstrap = await bootstrapResponse.json();
  assert.equal(bootstrap.authenticated, true);
  assert.equal(bootstrap.ownerAuthenticated, true);
  assert.equal(bootstrap.setupMode, mode);

  const inventoryResponse = await fetch(`${base}/api/admin/orchestration/inventory`, {headers:{cookie, accept:'application/json'}});
  assert.equal(inventoryResponse.status, 200, `Inventory after ${mode} instance recreation returned HTTP ${inventoryResponse.status}.`);
  const inventory = await inventoryResponse.json();
  assert.equal(inventory.connections.every(connection => connection.source === 'saved'), true, 'Saved service connections did not survive recreation.');

  const backupsResponse = await fetch(`${base}/api/admin/orchestration/backups`, {headers:{cookie, accept:'application/json'}});
  assert.equal(backupsResponse.status, 200);
  const backups = (await backupsResponse.json()).backups;
  if (mode === 'existing') assert.equal(backups.length, 0, 'Existing-stack setup unexpectedly created orchestration backups.');
  else assert.ok(backups.some(backup => backup.status === 'rolled_back'), 'Managed rollback records did not survive recreation.');

  console.log(`Disposable ${mode}-stack persistence passed after container recreation.`);
}

main().catch(error => {
  console.error(`Disposable persistence check failed: ${error.message}`);
  process.exitCode = 1;
});
