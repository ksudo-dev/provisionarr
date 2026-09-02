const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
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

async function waitFor(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Test server did not become ready: ${url}`);
}

function arrFixture(kind) {
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (!server.acceptedKeys.has(String(request.headers['x-api-key'] || ''))) {
      response.statusCode = 401;
      response.end(JSON.stringify({error:'unauthorized'}));
      return;
    }
    const secret = {apiKey:'must-not-leak', password:'also-secret', token:'private-token'};
    if(request.url==='/api/v3/rootfolder'&&request.method==='GET')return response.end(JSON.stringify(server.rootFolders.map(item=>({...item,...secret}))));
    if(request.url==='/api/v3/rootfolder'&&request.method==='POST')return readJson(request,body=>{const created={id:server.nextRootId++,path:body.path,accessible:true,freeSpace:123456};server.rootFolders.push(created);server.bootstrapEvents.push({method:'POST',path:request.url});response.statusCode=201;response.end(JSON.stringify(created));});
    const rootMatch=request.url.match(/^\/api\/v3\/rootfolder\/(\d+)$/);
    if(rootMatch&&request.method==='DELETE'){server.rootFolders=server.rootFolders.filter(item=>item.id!==Number(rootMatch[1]));server.bootstrapEvents.push({method:'DELETE',path:request.url});response.end('{}');return;}
    if(request.url==='/api/v3/downloadclient/schema'&&request.method==='GET')return response.end(JSON.stringify([server.qbittorrentSchema]));
    if(request.url==='/api/v3/downloadclient/test'&&request.method==='POST')return readJson(request,body=>{server.downloadClientTests.push(body);const fields=Object.fromEntries((body.fields||[]).map(field=>[field.name,field.value]));if(fields.host&&fields.port&&fields.username&&fields.password){response.end(JSON.stringify({isValid:true}));return;}response.statusCode=400;response.end(JSON.stringify({isValid:false}));});
    if(request.url==='/api/v3/downloadclient'&&request.method==='GET')return response.end(JSON.stringify(server.downloadClients.map(item=>({...item,fields:(item.fields||[]).map(field=>field.name==='password'?{...field,value:'********'}:field)}))));
    if(request.url==='/api/v3/downloadclient'&&request.method==='POST')return readJson(request,body=>{const created={...body,id:server.nextClientId++};server.downloadClients.push(created);server.bootstrapEvents.push({method:'POST',path:request.url});response.statusCode=201;response.end(JSON.stringify({...created,fields:(created.fields||[]).map(field=>field.name==='password'?{...field,value:'********'}:field)}));});
    const clientMatch=request.url.match(/^\/api\/v3\/downloadclient\/(\d+)$/);
    if(clientMatch&&request.method==='PUT')return readJson(request,body=>{const id=Number(clientMatch[1]),index=server.downloadClients.findIndex(item=>item.id===id);if(index<0){response.statusCode=404;response.end('{}');return;}server.downloadClients[index]={...body,id};server.bootstrapEvents.push({method:'PUT',path:request.url});response.end(JSON.stringify(server.downloadClients[index]));});
    if(clientMatch&&request.method==='DELETE'){server.downloadClients=server.downloadClients.filter(item=>item.id!==Number(clientMatch[1]));server.bootstrapEvents.push({method:'DELETE',path:request.url});response.end('{}');return;}
    if (request.method === 'PUT' && ['/api/v3/config/mediamanagement','/api/v3/config/downloadclient'].includes(request.url)) {
      let body='';
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => { const parsed=JSON.parse(body);server.puts.push({kind,path:request.url,body:parsed});if(server.failNextPut){server.failNextPut=false;response.statusCode=500;response.end(JSON.stringify({error:'fixture failure'}));return;}if(server.ignoreNextPut){server.ignoreNextPut=false;response.end(JSON.stringify(parsed));return;}server.current[request.url]=parsed;response.end(JSON.stringify(parsed)); });
      return;
    }
    if (request.url === '/api/v3/system/status') return response.end(JSON.stringify({appName:kind === 'sonarr' ? 'Sonarr' : 'Radarr',version:'4.0.0', ...secret}));
    if (request.url === '/api/v3/qualityprofile') return response.end(JSON.stringify([{id:2,name:'Balanced',upgradeAllowed:true,cutoff:6,...secret}]));
    if (request.url === '/api/v3/config/mediamanagement') return response.end(JSON.stringify({...server.current[request.url],...secret}));
    if (request.url === '/api/v3/config/downloadclient') return response.end(JSON.stringify({...server.current[request.url],...secret}));
    response.statusCode = 404;
    response.end('{}');
  });
  server.puts=[];
  server.bootstrapEvents=[];
  server.downloadClientTests=[];
  server.failNextPut=false;
  server.ignoreNextPut=false;
  server.nextRootId=20;
  server.nextClientId=30;
  server.rootFolders=[{id:1,path:kind==='sonarr'?'/tv':'/movies',freeSpace:123456,accessible:true}];
  server.downloadClients=[{id:3,name:'qBittorrent',enable:true,implementation:'QBittorrent',implementationName:'qBittorrent',configContract:'QBittorrentSettings',protocol:'torrent',priority:1,removeCompletedDownloads:true,removeFailedDownloads:true,tags:[],fields:[{name:'host',value:'localhost'},{name:'port',value:8080},{name:'useSsl',value:false},{name:'urlBase',value:''},{name:'username',value:'fixture-qbit-user'},{name:'password',value:'fixture-qbit-password'},{name:kind==='sonarr'?'tvCategory':'movieCategory',value:kind==='sonarr'?'tv-sonarr':'radarr'}]}];
  server.qbittorrentSchema={name:'qBittorrent',implementationName:'qBittorrent',implementation:'QBittorrent',configContract:'QBittorrentSettings',protocol:'torrent',enable:true,priority:1,removeCompletedDownloads:true,removeFailedDownloads:true,tags:[],fields:[{name:'host',value:'localhost'},{name:'port',value:8080},{name:'useSsl',value:false},{name:'urlBase'},{name:'username'},{name:'password'},{name:kind==='sonarr'?'tvCategory':'movieCategory',value:kind==='sonarr'?'tv-sonarr':'radarr'},{name:'initialState',value:0}]};
  server.current={
    '/api/v3/config/mediamanagement':{renameEpisodes:true,renameMovies:false,replaceIllegalCharacters:true,importExtraFiles:false},
    '/api/v3/config/downloadclient':{enableCompletedDownloadHandling:true,removeCompletedDownloads:false}
  };
  server.acceptedKeys=new Set([`fixture-${kind}-key`,`saved-${kind}-key`]);
  return server;
}

function prowlarrFixture() {
  const server = http.createServer((request,response)=>{
    response.setHeader('content-type','application/json');
    if(!['fixture-prowlarr-key','saved-prowlarr-key'].includes(String(request.headers['x-api-key']||''))){response.statusCode=401;response.end('{}');return;}
    if(request.url==='/api/v1/system/status')return response.end(JSON.stringify({appName:'Prowlarr',version:'1.0.0'}));
    if(request.url==='/api/v1/health')return response.end('[]');
    if(request.url==='/api/v1/indexer')return response.end(JSON.stringify([{id:1,name:'Indexer',enable:true,fields:[{value:'private-indexer-value'}]}]));
    if(request.url==='/api/v1/applications'&&request.method==='GET')return response.end(JSON.stringify(server.applications));
    if(request.url==='/api/v1/applications/schema')return response.end(JSON.stringify(server.schemas));
    if(request.url==='/api/v1/applications/test'&&request.method==='POST')return readJson(request,body=>{server.tests.push(body);server.events.push('test');response.end(JSON.stringify({isValid:true}));});
    if(request.url==='/api/v1/applications'&&request.method==='POST')return readJson(request,body=>{const created={...body,id:server.nextId++};server.applications.push(created);server.writes.push({method:'POST',body:created});server.events.push('POST');response.end(JSON.stringify(created));});
    const match=request.url.match(/^\/api\/v1\/applications\/(\d+)$/);
    if(match&&request.method==='PUT')return readJson(request,body=>{const id=Number(match[1]),index=server.applications.findIndex(item=>item.id===id);if(index<0){response.statusCode=404;return response.end('{}');}const updated={...body,id};server.applications[index]=updated;server.writes.push({method:'PUT',id,body:updated});server.events.push('PUT');response.end(JSON.stringify(updated));});
    if(match&&request.method==='DELETE'){const id=Number(match[1]),index=server.applications.findIndex(item=>item.id===id);if(index<0){response.statusCode=404;return response.end('{}');}server.applications.splice(index,1);server.writes.push({method:'DELETE',id});server.events.push('DELETE');return response.end('{}');}
    response.statusCode=404;response.end('{}');
  });
  server.tests=[];
  server.writes=[];
  server.events=[];
  server.nextId=10;
  server.applications=[];
  server.schemas=[
    {name:'Sonarr',implementationName:'Sonarr',implementation:'Sonarr',configContract:'SonarrSettings',fields:[{name:'prowlarrUrl'},{name:'baseUrl'},{name:'apiKey'},{name:'syncCategories',value:[5000]}],tags:[]},
    {name:'Radarr',implementationName:'Radarr',implementation:'Radarr',configContract:'RadarrSettings',fields:[{name:'prowlarrUrl'},{name:'baseUrl'},{name:'apiKey'},{name:'syncCategories',value:[2000]}],tags:[]}
  ];
  return server;
}

function readJson(request, callback) {
  let body='';
  request.on('data',chunk=>{body+=chunk;});
  request.on('end',()=>callback(JSON.parse(body)));
}

function qbittorrentFixture() {
  return http.createServer((request,response)=>{
    if(request.url==='/api/v2/auth/login'&&request.method==='POST'){
      let body='';request.on('data',chunk=>{body+=chunk;});request.on('end',()=>{
        if(request.headers.referer!==`http://${request.headers.host}/`||!request.headers['content-length']){response.statusCode=400;response.end('Missing required request headers.');return;}
        if(body.includes('username=fixture-qbit-user')&&body.includes('password=fixture-qbit-password')){response.setHeader('set-cookie','SID=fixture-session; HttpOnly');response.end('Ok.');return;}
        if(body.includes('username=saved-qbit-user')&&body.includes('password=saved-qbit-password')){response.statusCode=204;response.setHeader('set-cookie','SID=saved-session; HttpOnly');response.end();return;}
        response.end('Fails.');
      });return;
    }
    if(!String(request.headers.cookie||'').includes('SID=')){response.statusCode=401;response.end('Unauthorized');return;}
    if(request.url==='/api/v2/app/version')return response.end('v5.0.0');
    response.setHeader('content-type','application/json');
    if(request.url==='/api/v2/app/preferences')return response.end(JSON.stringify({save_path:'/downloads',password:'private-password'}));
    if(request.url==='/api/v2/torrents/info?limit=200')return response.end(JSON.stringify([{name:'private torrent title',hash:'private-hash',state:'downloading'}]));
    response.statusCode=404;response.end('{}');
  });
}

async function login(base, username) {
  const response = await fetch(`${base}/api/auth/login`, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({username, password:'test-password-123'})
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  return {cookie:response.headers.get('set-cookie').split(';')[0], csrf:payload.csrf};
}

test('orchestration inventory is owner-only and never exposes upstream secrets', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provisionarr-orchestration-'));
  const users = [
    {id:'owner',username:'owner',displayName:'System Administrator',role:'owner',...passwordRecord('test-password-123'),preferences:{}},
    {id:'user',username:'testarr',displayName:'Test User',role:'user',...passwordRecord('test-password-123'),preferences:{}}
  ];
  fs.writeFileSync(path.join(root, 'users.json'), JSON.stringify(users));
  const [port, sonarrPort, radarrPort, prowlarrPort, qbitPort] = await Promise.all([unusedPort(), unusedPort(), unusedPort(), unusedPort(), unusedPort()]);
  const sonarr = arrFixture('sonarr'), radarr = arrFixture('radarr'), prowlarr=prowlarrFixture(), qbit=qbittorrentFixture();
  await Promise.all([
    new Promise(resolve => sonarr.listen(sonarrPort, '127.0.0.1', resolve)),
    new Promise(resolve => radarr.listen(radarrPort, '127.0.0.1', resolve)),
    new Promise(resolve => prowlarr.listen(prowlarrPort, '127.0.0.1', resolve)),
    new Promise(resolve => qbit.listen(qbitPort, '127.0.0.1', resolve))
  ]);
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
    PROVISIONARR_ORCHESTRATION_CONNECTIONS_FILE:path.join(root, 'orchestration-connections.json'),
    SONARR_URL:`http://127.0.0.1:${sonarrPort}`,
    RADARR_URL:`http://127.0.0.1:${radarrPort}`,
    SONARR_API_KEY:'fixture-sonarr-key',
    RADARR_API_KEY:'fixture-radarr-key',
    PROWLARR_URL:`http://127.0.0.1:${prowlarrPort}`,
    PROWLARR_API_KEY:'fixture-prowlarr-key',
    PROVISIONARR_QBIT_URL:`http://127.0.0.1:${qbitPort}`,
    PROVISIONARR_QBIT_USERNAME:'fixture-qbit-user',
    PROVISIONARR_QBIT_PASSWORD:'fixture-qbit-password',
    PROVISIONARR_ORCHESTRATION_WRITES_ENABLED:'true',
    PROVISIONARR_ORCHESTRATION_BACKUP_ROOT:path.join(root, 'orchestration-backups')
  };
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {env, stdio:'ignore'});
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    child.kill();
    sonarr.close();
    radarr.close();
    prowlarr.close();
    qbit.close();
    await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
    fs.rmSync(root, {recursive:true, force:true});
  });
  await waitFor(`${base}/api/bootstrap`);

  const unauthenticated = await fetch(`${base}/api/admin/orchestration/inventory`);
  assert.equal(unauthenticated.status, 401);
  const ordinary = await login(base, 'testarr');
  assert.equal((await fetch(`${base}/api/admin/orchestration/inventory`, {headers:{cookie:ordinary.cookie}})).status, 403);

  const owner = await login(base, 'owner');
  const ownerBootstrapBefore=await fetch(`${base}/api/bootstrap`,{headers:{cookie:owner.cookie}});
  assert.equal((await ownerBootstrapBefore.json()).setupMode,'');
  const ordinaryMode=await fetch(`${base}/api/admin/orchestration/mode`,{method:'PUT',headers:{'content-type':'application/json',cookie:ordinary.cookie,'x-csrf-token':ordinary.csrf},body:JSON.stringify({mode:'managed'})});
  assert.equal(ordinaryMode.status,403);
  const invalidMode=await fetch(`${base}/api/admin/orchestration/mode`,{method:'PUT',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:JSON.stringify({mode:'automatic'})});
  assert.equal(invalidMode.status,400);
  const selectedMode=await fetch(`${base}/api/admin/orchestration/mode`,{method:'PUT',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:JSON.stringify({mode:'managed'})});
  assert.equal(selectedMode.status,200);
  assert.equal((await selectedMode.json()).mode,'managed');
  const ownerBootstrapAfter=await fetch(`${base}/api/bootstrap`,{headers:{cookie:owner.cookie}});
  assert.equal((await ownerBootstrapAfter.json()).setupMode,'managed');
  const stackChoices={configRoot:'/srv/provisionarr/config',mediaRoot:'/srv/provisionarr/media',downloadRoot:'/srv/provisionarr/downloads',puid:1000,pgid:1000,timezone:'Etc/UTC'};
  const ordinaryBundle=await fetch(`${base}/api/admin/installer/compose`,{method:'POST',headers:{'content-type':'application/json',cookie:ordinary.cookie,'x-csrf-token':ordinary.csrf},body:JSON.stringify(stackChoices)});
  assert.equal(ordinaryBundle.status,403);
  const generatedBundle=await fetch(`${base}/api/admin/installer/compose`,{method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:JSON.stringify(stackChoices)});
  assert.equal(generatedBundle.status,200);
  const generatedPayload=await generatedBundle.json();
  assert.deepEqual(Object.keys(generatedPayload.bundle.files),['compose.yaml','.env','README.md']);
  assert.equal(generatedPayload.bundle.files['compose.yaml'].includes('/var/run/docker.sock'),false);
  assert.equal(generatedPayload.bundle.files['compose.yaml'].includes('privileged:'),false);
  assert.equal(generatedPayload.bundle.files['compose.yaml'].includes('no-new-privileges:true'),true);
  const rejectedBundle=await fetch(`${base}/api/admin/installer/compose`,{method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:JSON.stringify({...stackChoices,dockerSocket:'/var/run/docker.sock'})});
  assert.equal(rejectedBundle.status,400);
  const response = await fetch(`${base}/api/admin/orchestration/inventory`, {headers:{cookie:owner.cookie}});
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.services.map(service => service.label), ['Sonarr', 'Radarr']);
  assert.deepEqual(payload.services[0].rootFolders[0], {id:1,path:'/tv',freeSpace:123456,accessible:true});
  assert.deepEqual(payload.services[1].qualityProfiles[0], {id:2,name:'Balanced',upgradeAllowed:true,cutoff:6});
  assert.equal(payload.services[0].downloadClients[0].name, 'qBittorrent');
  assert.equal(payload.services.every(service=>service.compatibility.ready), true);
  assert.deepEqual(payload.connections.map(connection=>({id:connection.id,source:connection.source})), [
    {id:'sonarr',source:'server'},
    {id:'radarr',source:'server'},
    {id:'prowlarr',source:'server'},
    {id:'qbittorrent',source:'server'}
  ]);
  assert.equal(payload.supportServices.find(service=>service.id==='prowlarr').compatibility.state,'needs_configuration');
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes('must-not-leak'), false);
  assert.equal(serialized.includes('also-secret'), false);
  assert.equal(serialized.includes('private-token'), false);
  assert.equal(serialized.includes('fixture-sonarr-key'), false);

  const ordinarySave = await fetch(`${base}/api/admin/orchestration/connections/sonarr`, {
    method:'PUT',headers:{'content-type':'application/json',cookie:ordinary.cookie,'x-csrf-token':ordinary.csrf},body:JSON.stringify({url:`http://127.0.0.1:${sonarrPort}`,apiKey:'saved-sonarr-key'})
  });
  assert.equal(ordinarySave.status, 403);

  const ordinaryProwlarrPlan=await fetch(`${base}/api/admin/orchestration/prowlarr/plan`,{method:'POST',headers:{'content-type':'application/json',cookie:ordinary.cookie,'x-csrf-token':ordinary.csrf},body:JSON.stringify({prowlarrUrl:'http://prowlarr.local',sonarrUrl:'http://sonarr.local',radarrUrl:'http://radarr.local',syncLevel:'fullSync'})});
  assert.equal(ordinaryProwlarrPlan.status,403);

  const invalidConnection = await fetch(`${base}/api/admin/orchestration/connections/sonarr`, {
    method:'PUT',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:JSON.stringify({url:`http://127.0.0.1:${sonarrPort}?key=wrong`,apiKey:'saved-sonarr-key'})
  });
  assert.equal(invalidConnection.status, 400);

  const rejectedConnection = await fetch(`${base}/api/admin/orchestration/connections/sonarr`, {
    method:'PUT',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:JSON.stringify({url:`http://127.0.0.1:${sonarrPort}`,apiKey:'wrong-key-value'})
  });
  assert.equal(rejectedConnection.status, 422);
  assert.equal((await rejectedConnection.json()).code, 'CONNECTION_AUTH_FAILED');

  const savedConnection = await fetch(`${base}/api/admin/orchestration/connections/sonarr`, {
    method:'PUT',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:JSON.stringify({url:`http://127.0.0.1:${sonarrPort}`,apiKey:'saved-sonarr-key'})
  });
  assert.equal(savedConnection.status, 200);
  const savedPayload=await savedConnection.json();
  assert.equal(savedPayload.connection.apiKeySet, true);
  assert.equal(savedPayload.connection.source, 'saved');
  assert.equal(savedPayload.service.compatibility.ready, true);
  assert.equal(JSON.stringify(savedPayload).includes('saved-sonarr-key'), false);
  const connectionFile=path.join(root,'orchestration-connections.json');
  assert.equal(fs.statSync(connectionFile).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(connectionFile,'utf8')).services.sonarr.apiKey, 'saved-sonarr-key');

  const savedProwlarr=await fetch(`${base}/api/admin/orchestration/connections/prowlarr`,{method:'PUT',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:JSON.stringify({url:`http://127.0.0.1:${prowlarrPort}`,apiKey:'saved-prowlarr-key'})});
  assert.equal(savedProwlarr.status,200);
  assert.equal(JSON.stringify(await savedProwlarr.json()).includes('saved-prowlarr-key'),false);

  const savedQbit=await fetch(`${base}/api/admin/orchestration/connections/qbittorrent`,{method:'PUT',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:JSON.stringify({url:`http://127.0.0.1:${qbitPort}`,username:'saved-qbit-user',password:'saved-qbit-password'})});
  assert.equal(savedQbit.status,200);
  assert.equal(JSON.stringify(await savedQbit.json()).includes('saved-qbit-password'),false);
  const persistedConnections=JSON.parse(fs.readFileSync(connectionFile,'utf8')).services;
  assert.equal(persistedConnections.prowlarr.apiKey,'saved-prowlarr-key');
  assert.equal(persistedConnections.qbittorrent.password,'saved-qbit-password');

  sonarr.rootFolders=[];radarr.rootFolders=[];sonarr.downloadClients=[];radarr.downloadClients=[];
  const ordinaryBootstrap=await fetch(`${base}/api/admin/orchestration/bootstrap/plan`,{method:'POST',headers:{'content-type':'application/json',cookie:ordinary.cookie,'x-csrf-token':ordinary.csrf},body:JSON.stringify({sonarrRoot:'/tv',radarrRoot:'/movies',qbittorrentUrl:'http://downloads.private:8080',sonarrCategory:'tv-sonarr',radarrCategory:'radarr'})});
  assert.equal(ordinaryBootstrap.status,403);
  const bootstrapPlan=await fetch(`${base}/api/admin/orchestration/bootstrap/plan`,{method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:JSON.stringify({sonarrRoot:'/tv',radarrRoot:'/movies',qbittorrentUrl:'http://downloads.private:8080',sonarrCategory:'tv-sonarr',radarrCategory:'radarr'})});
  assert.equal(bootstrapPlan.status,200);
  const bootstrapPayload=await bootstrapPlan.json();
  assert.equal(bootstrapPayload.plan.changes.length,4);
  assert.equal(bootstrapPayload.canApply,true);
  const serializedBootstrap=JSON.stringify(bootstrapPayload);
  assert.equal(serializedBootstrap.includes('saved-qbit-user'),false);
  assert.equal(serializedBootstrap.includes('saved-qbit-password'),false);
  assert.equal(serializedBootstrap.includes('downloads.private'),false);
  const bootstrapApply=await fetch(`${base}/api/admin/orchestration/bootstrap/plans/${bootstrapPayload.planId}/apply`,{method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:'{}'});
  assert.equal(bootstrapApply.status,200,JSON.stringify(await bootstrapApply.clone().json()));
  const bootstrapApplied=await bootstrapApply.json();
  assert.equal(bootstrapApplied.changes,4);
  assert.deepEqual(sonarr.rootFolders.map(item=>item.path),['/tv']);
  assert.deepEqual(radarr.rootFolders.map(item=>item.path),['/movies']);
  assert.equal(sonarr.downloadClients[0].name,'Provisionarr qBittorrent');
  assert.equal(radarr.downloadClients[0].name,'Provisionarr qBittorrent');
  assert.equal(sonarr.downloadClientTests.length,1);
  assert.equal(radarr.downloadClientTests.length,1);
  const bootstrapBackups=await (await fetch(`${base}/api/admin/orchestration/backups`,{headers:{cookie:owner.cookie}})).json();
  const bootstrapBackup=bootstrapBackups.backups.find(item=>item.id===bootstrapApplied.backup.id);
  assert.equal(bootstrapBackup.kind,'fresh_stack');
  assert.equal(bootstrapBackup.resourceCount,4);
  assert.equal(JSON.stringify(bootstrapBackups).includes('saved-qbit-password'),false);
  const bootstrapRollback=await fetch(`${base}/api/admin/orchestration/backups/${bootstrapBackup.id}/rollback`,{method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:'{}'});
  assert.equal(bootstrapRollback.status,200);
  assert.equal(sonarr.rootFolders.length,0);
  assert.equal(radarr.rootFolders.length,0);
  assert.equal(sonarr.downloadClients.length,0);
  assert.equal(radarr.downloadClients.length,0);

  const prowlarrPlan=await fetch(`${base}/api/admin/orchestration/prowlarr/plan`,{method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:JSON.stringify({prowlarrUrl:'http://prowlarr.local',sonarrUrl:'http://sonarr.local',radarrUrl:'http://radarr.local',syncLevel:'fullSync'})});
  assert.equal(prowlarrPlan.status,200);
  const prowlarrPlanPayload=await prowlarrPlan.json();
  assert.equal(prowlarrPlanPayload.plan.changes.length,2);
  assert.deepEqual(prowlarrPlanPayload.plan.changes.map(change=>change.action),['create','create']);
  assert.equal(JSON.stringify(prowlarrPlanPayload).includes('fixture-sonarr-key'),false);
  assert.equal(JSON.stringify(prowlarrPlanPayload).includes('saved-sonarr-key'),false);
  assert.equal(JSON.stringify(prowlarrPlanPayload).includes('fixture-radarr-key'),false);
  const prowlarrApply=await fetch(`${base}/api/admin/orchestration/prowlarr/plans/${prowlarrPlanPayload.planId}/apply`,{method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:'{}'});
  assert.equal(prowlarrApply.status,200);
  const prowlarrApplied=await prowlarrApply.json();
  assert.equal(prowlarrApplied.changes,2);
  assert.equal(prowlarrApplied.backup.status,'applied');
  assert.deepEqual(prowlarr.events.slice(-4),['test','test','POST','POST']);
  assert.equal(serverApplications(prowlarr).length,2);

  const prowlarrUpdatePlan=await fetch(`${base}/api/admin/orchestration/prowlarr/plan`,{method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:JSON.stringify({prowlarrUrl:'http://prowlarr.local',sonarrUrl:'http://sonarr.local',radarrUrl:'http://radarr.local',syncLevel:'addOnly'})});
  const prowlarrUpdatePayload=await prowlarrUpdatePlan.json();
  assert.deepEqual(prowlarrUpdatePayload.plan.changes.map(change=>change.action),['update','update']);
  prowlarr.events=[];
  const prowlarrUpdateApply=await fetch(`${base}/api/admin/orchestration/prowlarr/plans/${prowlarrUpdatePayload.planId}/apply`,{method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:'{}'});
  assert.equal(prowlarrUpdateApply.status,200);
  assert.deepEqual(prowlarr.events.slice(0,4),['test','test','PUT','PUT']);
  const prowlarrBackups=await (await fetch(`${base}/api/admin/orchestration/backups`,{headers:{cookie:owner.cookie}})).json();
  const updateBackup=prowlarrBackups.backups.find(item=>item.kind==='prowlarr_applications'&&item.planId===prowlarrUpdatePayload.planId);
  const createBackup=prowlarrBackups.backups.find(item=>item.kind==='prowlarr_applications'&&item.planId===prowlarrPlanPayload.planId);
  assert.equal(updateBackup.resourceCount,2);
  assert.equal(createBackup.resourceCount,2);
  const prowlarrRollback=await fetch(`${base}/api/admin/orchestration/backups/${updateBackup.id}/rollback`,{method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:'{}'});
  assert.equal(prowlarrRollback.status,200);
  assert.equal((await prowlarrRollback.json()).backup.status,'rolled_back');
  assert.equal(serverApplications(prowlarr).every(application=>application.syncLevel==='fullSync'),true);
  const prowlarrCreateRollback=await fetch(`${base}/api/admin/orchestration/backups/${createBackup.id}/rollback`,{method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:'{}'});
  assert.equal(prowlarrCreateRollback.status,200);
  assert.equal(serverApplications(prowlarr).length,0);

  const plan = await fetch(`${base}/api/admin/orchestration/plan`, {
    method:'POST',
    headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},
    body:JSON.stringify({desired:{sonarr:{mediaManagement:{renameFiles:false}},radarr:{downloadHandling:{completedDownloadHandling:false}}}})
  });
  assert.equal(plan.status, 200);
  const planPayload = await plan.json();
  assert.equal(planPayload.plan.changes.length, 2);
  assert.equal(planPayload.canApply, true);
  assert.equal(JSON.stringify(planPayload).includes('must-not-leak'), false);

  const apply = await fetch(`${base}/api/admin/orchestration/plans/${planPayload.planId}/apply`, {
    method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:'{}'
  });
  assert.equal(apply.status, 200);
  const applied = await apply.json();
  assert.equal(applied.changes, 2);
  assert.ok(applied.backup);
  assert.equal(sonarr.puts.length + radarr.puts.length, 2);
  assert.equal(sonarr.puts[0].body.renameEpisodes, false);
  assert.equal(radarr.puts[0].body.enableCompletedDownloadHandling, false);

  const backupsResponse = await fetch(`${base}/api/admin/orchestration/backups`, {headers:{cookie:owner.cookie}});
  assert.equal(backupsResponse.status, 200);
  const backups = await backupsResponse.json();
  const arrBackup=backups.backups.find(item=>item.planId===planPayload.planId);
  assert.equal(arrBackup.resourceCount, 4);
  assert.ok(arrBackup.verifiedAt);
  assert.equal(JSON.stringify(backups).includes('must-not-leak'), false);
  const rollback = await fetch(`${base}/api/admin/orchestration/backups/${arrBackup.id}/rollback`, {
    method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:'{}'
  });
  assert.equal(rollback.status, 200);
  assert.equal((await rollback.json()).backup.status, 'rolled_back');
  assert.equal(sonarr.puts.length + radarr.puts.length, 6);

  const secondPlan=await fetch(`${base}/api/admin/orchestration/plan`,{method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:JSON.stringify({desired:{sonarr:{mediaManagement:{renameFiles:false}},radarr:{downloadHandling:{completedDownloadHandling:false}}}})});
  const secondPlanPayload=await secondPlan.json();
  const secondApply=await fetch(`${base}/api/admin/orchestration/plans/${secondPlanPayload.planId}/apply`,{method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:'{}'});
  assert.equal(secondApply.status,200);
  const secondBackup=(await secondApply.json()).backup;
  radarr.failNextPut=true;
  const failedRollback=await fetch(`${base}/api/admin/orchestration/backups/${secondBackup.id}/rollback`,{method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:'{}'});
  assert.equal(failedRollback.status,502);
  assert.equal((await failedRollback.json()).code,'ROLLBACK_FAILED');
  const backupsAfterFailure=await (await fetch(`${base}/api/admin/orchestration/backups`,{headers:{cookie:owner.cookie}})).json();
  assert.equal(backupsAfterFailure.backups.find(item=>item.id===secondBackup.id).status,'rollback_failed');

  const verificationPlan=await fetch(`${base}/api/admin/orchestration/plan`,{method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:JSON.stringify({desired:{sonarr:{mediaManagement:{renameFiles:true}},radarr:{downloadHandling:{completedDownloadHandling:true}}}})});
  const verificationPlanPayload=await verificationPlan.json();
  sonarr.ignoreNextPut=true;
  const verificationApply=await fetch(`${base}/api/admin/orchestration/plans/${verificationPlanPayload.planId}/apply`,{method:'POST',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:'{}'});
  assert.equal(verificationApply.status,400);
  const backupsAfterMismatch=await (await fetch(`${base}/api/admin/orchestration/backups`,{headers:{cookie:owner.cookie}})).json();
  assert.equal(backupsAfterMismatch.backups.find(item=>item.planId===verificationPlanPayload.planId).status,'automatically_rolled_back');

  const adminFile=path.join(root,'admin.json');
  fs.writeFileSync(adminFile,'{}',{mode:0o644});
  fs.chmodSync(adminFile,0o644);
  const passwordChange=await fetch(`${base}/api/account/password`,{method:'PUT',headers:{'content-type':'application/json',cookie:owner.cookie,'x-csrf-token':owner.csrf},body:JSON.stringify({currentPassword:'test-password-123',newPassword:'next-test-password-123'})});
  assert.equal(passwordChange.status,200);
  assert.equal(fs.statSync(adminFile).mode&0o777,0o600);
});

function serverApplications(prowlarr) {
  return prowlarr.applications;
}
