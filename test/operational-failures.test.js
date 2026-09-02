const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

function passwordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {salt, hash:crypto.scryptSync(password, salt, 64).toString('hex')};
}

async function unusedPort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => socket.listen(0, '127.0.0.1', resolve).on('error', reject));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function waitFor(url, predicate = response => response.ok) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(url);
      if (predicate(response)) return response;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Test server did not become ready: ${url}`);
}

async function startFixture(t, extraEnv = {}, initialSettings = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provisionarr-operational-'));
  const password = 'test-password-123';
  const users = [
    {id:'owner', username:'owner', displayName:'System Administrator', role:'owner', ...passwordRecord(password), preferences:{}},
    {id:'user', username:'testarr', displayName:'Test User', role:'user', ...passwordRecord(password), preferences:{}}
  ];
  fs.writeFileSync(path.join(root, 'users.json'), JSON.stringify(users));
  if (initialSettings) fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify(initialSettings));
  const port = await unusedPort();
  const env = {
    ...process.env,
    PORT:String(port),
    PROVISIONARR_LISTEN_HOST:'127.0.0.1',
    PROVISIONARR_CONFIG_ROOT:root,
    PROVISIONARR_REQUEST_LOG:path.join(root, 'requests.json'),
    PROVISIONARR_USERS_FILE:path.join(root, 'users.json'),
    PROVISIONARR_SETTINGS_FILE:path.join(root, 'settings.json'),
    PROVISIONARR_ADMIN_FILE:path.join(root, 'admin.json'),
    PROVISIONARR_AUDIT_FILE:path.join(root, 'audit.jsonl'),
    PROVISIONARR_SESSION_FILE:path.join(root, 'sessions.json'),
    ...extraEnv
  };
  const start = () => spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {env, stdio:'ignore'});
  let child = start();
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/bootstrap`);
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
    fs.rmSync(root, {recursive:true, force:true});
  });
  return {
    base,
    root,
    cookie: value => ({cookie:value}),
    restart: async () => {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
      child = start();
      await waitFor(`${base}/api/bootstrap`);
    }
  };
}

async function login(base, username, password = 'test-password-123') {
  const response = await fetch(`${base}/api/auth/login`, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({username, password})
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie, 'login should issue a session cookie');
  return {cookie:cookie.split(';')[0], csrf:(await response.json()).csrf};
}

async function stalledBodyResponse(base) {
  const {hostname, port} = new URL(base);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(Number(port), hostname);
    let response = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Stalled request did not time out'));
    }, 8000);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write('POST /api/auth/login HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{"username":"'));
    socket.on('data', chunk => { response += chunk; });
    socket.on('end', () => { clearTimeout(timer);resolve(response); });
    socket.on('error', error => {
      clearTimeout(timer);
      if (response) resolve(response);
      else reject(error);
    });
  });
}

test('unauthenticated bootstrap is safe and ordinary users cannot administer', async t => {
  const fixture = await startFixture(t);
  const bootstrap = await fetch(`${fixture.base}/api/bootstrap`);
  assert.equal(bootstrap.status, 200);
  assert.deepEqual((await bootstrap.json()), {
    appName:'Provisionarr',
    adminConfigured:true,
    authenticated:false,
    ownerAuthenticated:false,
    user:null,
    csrf:null
  });

  const session = await login(fixture.base, 'testarr');
  const userBootstrap = await (await fetch(`${fixture.base}/api/bootstrap`, {headers:{cookie:session.cookie}})).json();
  assert.equal(userBootstrap.authenticated, true);
  assert.equal(userBootstrap.ownerAuthenticated, false);
  assert.equal(userBootstrap.user.role, 'user');

  const admin = await fetch(`${fixture.base}/api/admin/overview`, {headers:{cookie:session.cookie}});
  assert.equal(admin.status, 403);
  assert.equal((await admin.json()).code, 'OWNER_REQUIRED');
});

test('malformed cookies, oversized bodies, and stalled bodies fail without destabilizing the server', async t => {
  const fixture = await startFixture(t, {PROVISIONARR_REQUEST_TIMEOUT_MS:'5000'});
  const malformed = await fetch(`${fixture.base}/api/bootstrap`, {headers:{cookie:'arr_session=%E0%A4%A'}});
  assert.equal(malformed.status, 200);
  assert.equal((await malformed.json()).authenticated, false);

  const oversized = await fetch(`${fixture.base}/api/auth/login`, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:'x'.repeat(70 * 1024)
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get('connection'), 'close');

  const stalled = await stalledBodyResponse(fixture.base);
  assert.match(stalled, /^HTTP\/1\.1 408 /);
  assert.match(stalled, /Connection: close/i);

  const healthy = await fetch(`${fixture.base}/api/bootstrap`);
  assert.equal(healthy.status, 200);
});

test('notifications are authenticated, user-scoped, and readable with CSRF', async t => {
  const fixture = await startFixture(t);
  const unauthenticated = await fetch(`${fixture.base}/api/notifications`);
  assert.equal(unauthenticated.status, 401);
  fs.writeFileSync(path.join(fixture.root, 'notification-state.json'), JSON.stringify({items:{},diskLow:false,notifications:[
    {id:'user-note',userId:'user',type:'available',title:'A User Title',message:'Ready.',href:'#/requests',createdAt:new Date().toISOString(),read:false},
    {id:'owner-note',userId:'owner',type:'failed',title:'An Owner Title',message:'Needs attention.',href:'#/status',createdAt:new Date().toISOString(),read:false}
  ]}));
  const session = await login(fixture.base, 'testarr');
  const inbox = await fetch(`${fixture.base}/api/notifications`, {headers:{cookie:session.cookie}});
  assert.equal(inbox.status, 200);
  assert.deepEqual((await inbox.json()).notifications.map(item => item.id), ['user-note']);
  const forbiddenRead = await fetch(`${fixture.base}/api/notifications/read`, {method:'POST',headers:{cookie:session.cookie,'content-type':'application/json'},body:JSON.stringify({all:true})});
  assert.equal(forbiddenRead.status, 403);
  const read = await fetch(`${fixture.base}/api/notifications/read`, {method:'POST',headers:{cookie:session.cookie,'content-type':'application/json','x-csrf-token':session.csrf},body:JSON.stringify({ids:['user-note']})});
  assert.equal(read.status, 200);
  assert.equal((await (await fetch(`${fixture.base}/api/notifications`, {headers:{cookie:session.cookie}})).json()).unread, 0);
});

test('audit records identify the actor and redact secret settings', async t => {
  const fixture = await startFixture(t);
  const owner = await login(fixture.base, 'owner');
  const update = await fetch(`${fixture.base}/api/admin/settings`, {
    method:'PUT',
    headers:{'content-type':'application/json', cookie:owner.cookie, 'x-csrf-token':owner.csrf},
    body:JSON.stringify({appName:'QA Provisionarr', smtpPass:'never-return-this'})
  });
  assert.equal(update.status, 200);
  const response = await fetch(`${fixture.base}/api/admin/logs`, {headers:{cookie:owner.cookie}});
  assert.equal(response.status, 200);
  const payload = await response.json();
  const settings = payload.entries.find(entry => entry.action === 'settings_updated');
  assert.equal(settings.actor, 'System Administrator');
  assert.equal(settings.fields.includes('appName'), true);
  assert.equal(settings.fields.includes('smtpPass'), false);
  assert.equal(JSON.stringify(payload).includes('never-return-this'), false);
});

test('session survives a process restart and remains bound to its user', async t => {
  const fixture = await startFixture(t);
  const session = await login(fixture.base, 'testarr');
  await fixture.restart();

  const bootstrap = await (await fetch(`${fixture.base}/api/bootstrap`, {headers:{cookie:session.cookie}})).json();
  assert.equal(bootstrap.authenticated, true);
  assert.equal(bootstrap.user.username, 'testarr');
  assert.equal(bootstrap.ownerAuthenticated, false);

  const sessionFile = fs.readFileSync(path.join(fixture.root, 'sessions.json'), 'utf8');
  assert.equal(sessionFile.includes(session.cookie.split('=')[1]), false);
});

test('rate limiting is isolated between authenticated sessions', async t => {
  const fixture = await startFixture(t);
  const first = await login(fixture.base, 'owner');
  const second = await login(fixture.base, 'testarr');
  const headers = {'content-type':'application/json', cookie:first.cookie, 'x-csrf-token':first.csrf};
  const responses = await Promise.all(Array.from({length:125}, () => fetch(`${fixture.base}/api/requests`, {
    method:'POST', headers, body:JSON.stringify({mediaRef:'expired-fixture-ref'})
  })));
  assert.equal(responses.some(response => response.status === 429), true);

  const otherSession = await fetch(`${fixture.base}/api/bootstrap`, {headers:{cookie:second.cookie}});
  assert.equal(otherSession.status, 200);
  assert.equal((await otherSession.json()).user.username, 'testarr');
});

test('owner maps an Emby profile and discovery uses that user watch history', async t => {
  const embyPort = await unusedPort();
  const radarrPort = await unusedPort();
  const seen = [];
  const embyHttp = require('node:http').createServer((request, response) => {
    seen.push(request.url);
    response.setHeader('content-type', 'application/json');
    if (request.url === '/Users') return response.end(JSON.stringify([{Id:'user-a',Name:'Shared'},{Id:'user-b',Name:'Test User'}]));
    if (request.url.startsWith('/Users/user-b/Items?')) return response.end(JSON.stringify({Items:[{Id:'played-seed',Type:'Movie',Name:'Played Seed',ProviderIds:{Tmdb:'10'}}]}));
    if (request.url.startsWith('/Items/played-seed/Similar?')) return response.end(JSON.stringify({Items:[{Id:'suggested',Type:'Movie',Name:'Personal Suggestion',ProductionYear:2025,ProviderIds:{Tmdb:'99'}}]}));
    if (request.url.startsWith('/Items?')) return response.end(JSON.stringify({Items:[{Id:'owned',Type:'Movie',Name:'Owned Movie',ProviderIds:{Tmdb:'1'}}],TotalRecordCount:1}));
    response.statusCode = 404;
    response.end('{}');
  });
  const radarrHttp = require('node:http').createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end('[]');
  });
  await new Promise(resolve => embyHttp.listen(embyPort, '127.0.0.1', resolve));
  await new Promise(resolve => radarrHttp.listen(radarrPort, '127.0.0.1', resolve));
  t.after(() => { embyHttp.close(); radarrHttp.close(); });

  const fixture = await startFixture(t, {
    PROVISIONARR_EMBY_URL:`http://127.0.0.1:${embyPort}`,
    PROVISIONARR_EMBY_API_KEY:'fixture-key',
    RADARR_URL:`http://127.0.0.1:${radarrPort}`
  });
  const owner = await login(fixture.base, 'owner');
  const mapping = await fetch(`${fixture.base}/api/admin/users/user`, {
    method:'PATCH',
    headers:{'content-type':'application/json', cookie:owner.cookie, 'x-csrf-token':owner.csrf},
    body:JSON.stringify({embyUserId:'user-b'})
  });
  assert.equal(mapping.status, 200);
  assert.equal((await mapping.json()).user.preferences.embyUserId, 'user-b');

  const user = await login(fixture.base, 'testarr');
  const discovery = await fetch(`${fixture.base}/api/discover`, {headers:{cookie:user.cookie}});
  assert.equal(discovery.status, 200);
  const payload = await discovery.json();
  assert.equal(payload.personalized, true);
  assert.equal(payload.inspired.some(item => item.title === 'Personal Suggestion'), true);
  assert.equal(seen.some(value => value.startsWith('/Users/user-b/Items?')), true);
});

test('ordinary account updates cannot change the owner-managed Emby profile mapping', async t => {
  const fixture = await startFixture(t);
  const usersFile = path.join(fixture.root, 'users.json');
  const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
  users.find(user => user.id === 'user').preferences = {notifications:true, embyUserId:'owner-selected'};
  fs.writeFileSync(usersFile, JSON.stringify(users));

  const session = await login(fixture.base, 'testarr');
  const response = await fetch(`${fixture.base}/api/account`, {
    method:'PUT',
    headers:{'content-type':'application/json', cookie:session.cookie, 'x-csrf-token':session.csrf},
    body:JSON.stringify({displayName:'Test User', preferences:{notifications:false, embyUserId:'attacker-selected'}})
  });
  assert.equal(response.status, 200);
  const updated = (await response.json()).user;
  assert.equal(updated.preferences.notifications, false);
  assert.equal(updated.preferences.embyUserId, 'owner-selected');
});

test('proposal confirmation enforces ordinary-user approval policy before ARR mutation', async t => {
  const sonarrPort = await unusedPort();
  let mutationCount = 0;
  const sonarrHttp = require('node:http').createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url.startsWith('/api/v3/series/lookup?')) return response.end(JSON.stringify([{
      title:'South Park',
      year:1997,
      tvdbId:75897,
      seasons:[{seasonNumber:1, monitored:false}]
    }]));
    if (request.url === '/api/v3/series' && request.method === 'GET') return response.end('[]');
    if (request.url === '/api/v3/rootfolder') return response.end('[{"path":"/tv"}]');
    if (request.url === '/api/v3/qualityprofile') return response.end('[{"id":1,"name":"Any"}]');
    if (request.url === '/api/v3/series' && request.method === 'POST') {
      mutationCount += 1;
      response.statusCode = 201;
      return response.end('{"id":42}');
    }
    if (request.url === '/api/v3/command' && request.method === 'POST') {
      mutationCount += 1;
      response.statusCode = 201;
      return response.end('{"id":7}');
    }
    response.end('[]');
  });
  await new Promise(resolve => sonarrHttp.listen(sonarrPort, '127.0.0.1', resolve));
  t.after(() => sonarrHttp.close());

  const fixture = await startFixture(t, {
    SONARR_URL:`http://127.0.0.1:${sonarrPort}`
  }, {
    pauseRequestsWhenStorageLow:false,
    userAutoApprove:false
  });
  const user = await login(fixture.base, 'testarr');
  const search = await (await fetch(`${fixture.base}/api/search?q=Southpark%20season%201`, {headers:{cookie:user.cookie}})).json();
  assert.equal(search.results[0].title, 'South Park');

  const proposalResponse = await fetch(`${fixture.base}/api/proposals`, {
    method:'POST',
    headers:{'content-type':'application/json', cookie:user.cookie, 'x-csrf-token':user.csrf},
    body:JSON.stringify({mediaRef:search.results[0].mediaRef})
  });
  assert.equal(proposalResponse.status, 201);
  const proposal = (await proposalResponse.json()).proposal;
  const confirmation = await fetch(`${fixture.base}/api/proposals/${proposal.id}/confirm`, {
    method:'POST',
    headers:{'content-type':'application/json', cookie:user.cookie, 'x-csrf-token':user.csrf},
    body:'{}'
  });
  assert.equal(confirmation.status, 201);
  const result = await confirmation.json();
  assert.equal(result.accepted, false);
  assert.equal(result.pendingApproval, true);
  assert.equal(mutationCount, 0);

  const requests = await (await fetch(`${fixture.base}/api/requests`, {headers:{cookie:user.cookie}})).json();
  assert.equal(requests.requests.length, 1);
  assert.equal(requests.requests[0].status, 'pending_approval');

  const owner = await login(fixture.base, 'owner');
  const approved = await fetch(`${fixture.base}/api/admin/requests/${result.requestId}/approve`, {
    method:'POST',
    headers:{'content-type':'application/json', cookie:owner.cookie, 'x-csrf-token':owner.csrf},
    body:'{}'
  });
  assert.equal(approved.status, 200);
  const approvalResult = await approved.json();
  assert.equal(approvalResult.accepted, true);
  assert.equal(approvalResult.alreadyRequested, undefined);
  assert.equal(mutationCount, 2);
});

test('concurrent requests cannot exceed an ordinary user active-request allotment', async t => {
  const radarrPort = await unusedPort();
  let mutationCount = 0;
  const radarrHttp = require('node:http').createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    const target = new URL(request.url, 'http://fixture');
    if (target.pathname === '/api/v3/movie/lookup') {
      const term = target.searchParams.get('term') || 'Movie';
      const id = term.includes('Second') ? 202 : 101;
      return response.end(JSON.stringify([{title:term,year:2026,tmdbId:id}]));
    }
    if (target.pathname === '/api/v3/movie' && request.method === 'GET') return response.end('[]');
    if (target.pathname === '/api/v3/queue') return response.end('{"records":[]}');
    if (target.pathname === '/api/v3/rootfolder') return response.end('[{"path":"/movies"}]');
    if (target.pathname === '/api/v3/qualityprofile') return response.end('[{"id":1,"name":"Any"}]');
    if (target.pathname === '/api/v3/movie' && request.method === 'POST') {
      mutationCount += 1;
      return setTimeout(() => { response.statusCode = 201; response.end(`{"id":${mutationCount}}`); }, 100);
    }
    response.end('[]');
  });
  await new Promise(resolve => radarrHttp.listen(radarrPort, '127.0.0.1', resolve));
  t.after(() => radarrHttp.close());

  const fixture = await startFixture(t, {RADARR_URL:`http://127.0.0.1:${radarrPort}`}, {
    pauseRequestsWhenStorageLow:false,
    userAutoApprove:true,
    userActiveRequestLimit:1
  });
  const user = await login(fixture.base, 'testarr');
  const headers = {cookie:user.cookie};
  const first = await (await fetch(`${fixture.base}/api/search?q=First%20Movie`, {headers})).json();
  const second = await (await fetch(`${fixture.base}/api/search?q=Second%20Movie`, {headers})).json();
  assert.equal(first.results.length, 1);
  assert.equal(second.results.length, 1);

  const submitHeaders = {'content-type':'application/json', cookie:user.cookie, 'x-csrf-token':user.csrf};
  const responses = await Promise.all([
    fetch(`${fixture.base}/api/requests`, {method:'POST',headers:submitHeaders,body:JSON.stringify({mediaRef:first.results[0].mediaRef})}),
    fetch(`${fixture.base}/api/requests`, {method:'POST',headers:submitHeaders,body:JSON.stringify({mediaRef:second.results[0].mediaRef})})
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 202]);
  assert.equal(mutationCount, 1);
  const results = await Promise.all(responses.map(response => response.json()));
  assert.equal(results.filter(result => result.accepted).length, 1);
  assert.equal(results.filter(result => result.pendingApproval).length, 1);
});
