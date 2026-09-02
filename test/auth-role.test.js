const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

function passwordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {salt, hash:crypto.scryptSync(password, salt, 64).toString('hex')};
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Test server did not start');
}

test('ordinary users never receive owner access', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provisionarr-auth-'));
  const password = 'test-password-123';
  const users = [
    {id:'owner', username:'owner', displayName:'Owner', role:'owner', ...passwordRecord(password), preferences:{}},
    {id:'user', username:'testarr', displayName:'Test Usarr', role:'user', ...passwordRecord(password), preferences:{}}
  ];
  fs.writeFileSync(path.join(root, 'users.json'), JSON.stringify(users));
  const port = 32100 + Math.floor(Math.random() * 1000);
  const env={...process.env, PORT:String(port), PROVISIONARR_LISTEN_HOST:'127.0.0.1', PROVISIONARR_CONFIG_ROOT:root, PROVISIONARR_REQUEST_LOG:path.join(root,'requests.json'), PROVISIONARR_USERS_FILE:path.join(root,'users.json'), PROVISIONARR_SETTINGS_FILE:path.join(root,'settings.json'), PROVISIONARR_ADMIN_FILE:path.join(root,'admin.json'), PROVISIONARR_AUDIT_FILE:path.join(root,'audit.jsonl')};
  const startServer=()=>spawn(process.execPath,[path.join(__dirname,'..','server.js')],{env,stdio:'ignore'});
  let child=startServer();
  t.after(() => { child.kill(); fs.rmSync(root, {recursive:true, force:true}); });
  const base = `http://127.0.0.1:${port}`;
  await waitForServer(`${base}/api/bootstrap`);
  const login = await fetch(`${base}/api/auth/login`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({username:'testarr',password})});
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const bootstrap = await (await fetch(`${base}/api/bootstrap`, {headers:{cookie}})).json();
  assert.equal(bootstrap.authenticated, true);
  assert.equal(bootstrap.ownerAuthenticated, false);
  assert.equal(bootstrap.user.role, 'user');
  const admin = await fetch(`${base}/api/admin/overview`, {headers:{cookie}});
  assert.equal(admin.status, 403);
  const browsing = await Promise.all(Array.from({length:240},()=>fetch(`${base}/api/bootstrap`,{headers:{cookie}})));
  assert.equal(browsing.every(response=>response.status===200),true);
  const rawToken=cookie.split('=')[1];
  const sessionFile=fs.readFileSync(path.join(root,'sessions.json'),'utf8');
  assert.equal(sessionFile.includes(rawToken),false);
  child.kill();
  await new Promise(resolve=>child.once('exit',resolve));
  child=startServer();
  await waitForServer(`${base}/api/bootstrap`);
  const afterRestart=await (await fetch(`${base}/api/bootstrap`,{headers:{cookie}})).json();
  assert.equal(afterRestart.authenticated,true);
});
