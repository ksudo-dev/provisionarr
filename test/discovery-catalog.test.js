const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
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

async function listen(server) {
  const port = await unusedPort();
  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', resolve).on('error', reject));
  return port;
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Test server did not become ready: ${url}`);
}

async function startProvisionarr(t, extraEnv = {}, users = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provisionarr-discovery-'));
  const password = 'fixture-password-123';
  fs.writeFileSync(path.join(root, 'users.json'), JSON.stringify(users || [
    {id:'user', username:'user', displayName:'Fixture User', role:'user', ...passwordRecord(password), preferences:{}}
  ]));
  const port = await unusedPort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {stdio:'ignore', env:{
    ...process.env, PORT:String(port), PROVISIONARR_LISTEN_HOST:'127.0.0.1',
    PROVISIONARR_CONFIG_ROOT:root, PROVISIONARR_USERS_FILE:path.join(root, 'users.json'),
    PROVISIONARR_SETTINGS_FILE:path.join(root, 'settings.json'), PROVISIONARR_REQUEST_LOG:path.join(root, 'requests.json'),
    PROVISIONARR_ADMIN_FILE:path.join(root, 'admin.json'), PROVISIONARR_AUDIT_FILE:path.join(root, 'audit.jsonl'),
    PROVISIONARR_SESSION_FILE:path.join(root, 'sessions.json'), PROVISIONARR_EMBY_URL:'', PROVISIONARR_EMBY_API_KEY:'', ...extraEnv
  }});
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/bootstrap`);
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    await new Promise(resolve => child.exitCode === null ? child.once('exit', resolve) : resolve());
    fs.rmSync(root, {recursive:true, force:true});
  });
  const loginDetails = async username => {
    const login = await fetch(`${base}/api/auth/login`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({username, password})});
    assert.equal(login.status, 200);
    return {cookie:login.headers.get('set-cookie').split(';')[0],csrf:(await login.json()).csrf};
  };
  const initial=await loginDetails('user');
  return {base, root, cookie:initial.cookie, csrf:initial.csrf, loginAs:async username=>(await loginDetails(username)).cookie, loginDetails};
}

function radarrCatalogServer(mode = 'ready') {
  const calls=[];
  const server=http.createServer((request, response) => {
    calls.push(request.url);
    response.setHeader('content-type', 'application/json');
    if (mode === 'down') { response.statusCode = 503; return response.end(JSON.stringify({error:'fixture unavailable'})); }
    if (mode === 'empty' && request.url === '/api/v3/importlist/movie?includeRecommendations=true&includeTrending=true&includePopular=true') return response.end('[]');
    if (request.url === '/api/v3/importlist/movie?includeRecommendations=true&includeTrending=true&includePopular=true') return response.end(JSON.stringify([
      {title:'Owned Movie', tmdbId:10, isTrending:true, year:2024},
      {title:'Movie Candidate', tmdbId:20, isTrending:true, isPopular:true, year:2025},
      {title:'Future Movie', tmdbId:30, isTrending:true, digitalRelease:'2099-01-01T00:00:00.000Z'}
    ]));
    if (request.url.startsWith('/api/v3/movie/lookup?')) return response.end(JSON.stringify([{title:'Owned Movie', tmdbId:10},{title:'Movie Candidate', tmdbId:20}]));
    if (request.url === '/api/v3/movie') return response.end(JSON.stringify([{id:1,title:'Owned Movie',tmdbId:10,genres:['Drama']}]));
    response.statusCode = 404;
    response.end('{}');
  });
  server.calls=calls;
  return server;
}

function tvmazeFixtureServer(mode='ready', entries=null) {
  const calls=[];
  const server=http.createServer((request,response)=>{
    calls.push(request.url);response.setHeader('content-type','application/json');
    if(mode==='rate'){response.statusCode=429;response.setHeader('retry-after','60');return response.end('[]');}
    if(mode==='error'){response.statusCode=503;return response.end('{}');}
    if(request.url!=='/shows?page=0'){response.statusCode=404;return response.end('{}');}
    if(mode==='empty')return response.end('[]');
    return response.end(JSON.stringify(entries||[
      {id:901,name:'Owned by typed ID',premiered:'2024-01-01',externals:{thetvdb:100}},
      {id:902,name:'Validated Generic Show',premiered:'2025-01-02',rating:{average:8.1},externals:{thetvdb:200},image:{medium:'https://static.tvmaze.com/uploads/images/medium_portrait/1/2.jpg'}},
      {id:903,name:'Future Generic Show',premiered:'2099-01-02',externals:{thetvdb:300}},
      {id:904,name:'No TVDB ID',premiered:'2025-01-02',externals:{}},
      {id:905,name:'Same title only',premiered:'2025-01-02',externals:{thetvdb:400}}
    ]));
  });
  return {server,calls};
}

function sonarrValidationServer() {
  const calls=[];
  const server=http.createServer((request,response)=>{
    calls.push(request.url);response.setHeader('content-type','application/json');
    if(request.url==='/api/v3/series')return response.end(JSON.stringify([{id:1,title:'Library title does not match',tvdbId:100}]));
    if(['/api/v3/series/lookup?term=tvdb%3A200','/api/v3/series/lookup?term=tvdb:200'].includes(request.url))return response.end(JSON.stringify([{title:'Validated Generic Show',tvdbId:200}]));
    if(['/api/v3/series/lookup?term=tvdb%3A400','/api/v3/series/lookup?term=tvdb:400'].includes(request.url))return response.end(JSON.stringify([]));
    response.statusCode=404;response.end('{}');
  });
  return {server,calls};
}

function embyRecommendationServer() {
  const calls=[];
  const byUser={
    'emby-a':{
      library:[{Id:'a-library',Type:'Movie',Name:'A Library Seed',ProviderIds:{Tmdb:'101'}}],
      history:[{Id:'a-watched',Type:'Movie',Name:'A Watched Seed',ProviderIds:{Tmdb:'102'}}],
      similar:{
        'a-library':[
          {Id:'a-owned',Type:'Movie',Name:'A Owned Candidate',ProviderIds:{Tmdb:'101'}},
          {Id:'a-rec',Type:'Movie',Name:'A Personal Recommendation',ProviderIds:{Tmdb:'201'}},
          {Id:'a-tv',Type:'Series',Name:'A Personal Show',ProviderIds:{Tvdb:'301'}}
        ],
        'a-watched':[
          {Id:'a-duplicate',Type:'Movie',Name:'A Personal Recommendation',ProviderIds:{Tmdb:'201'}},
          {Id:'a-tv-duplicate',Type:'Series',Name:'A Personal Show',ProviderIds:{Tvdb:'301'}}
        ]
      }
    },
    'emby-b':{
      library:[{Id:'b-library',Type:'Movie',Name:'B Library Seed',ProviderIds:{Tmdb:'401'}}],
      history:[{Id:'b-watched',Type:'Movie',Name:'B Watched Seed',ProviderIds:{Tmdb:'402'}}],
      similar:{'b-watched':[{Id:'b-rec',Type:'Movie',Name:'B Personal Recommendation',ProviderIds:{Tmdb:'501'}}], 'b-library':[]}
    }
  };
  const server=http.createServer((request,response)=>{
    calls.push(request.url);
    response.setHeader('content-type','application/json');
    const match=request.url.match(/^\/Users\/([^/]+)\/Items/);
    if(match){const user=byUser[match[1]];if(!user){response.statusCode=404;return response.end('{}');}return response.end(JSON.stringify(request.url.includes('Filters=IsPlayed')?{Items:user.history}:{Items:user.library}));}
    const similar=request.url.match(/^\/Items\/([^/]+)\/Similar/);
    if(similar){for(const user of Object.values(byUser))if(user.similar[similar[1]])return response.end(JSON.stringify({Items:user.similar[similar[1]]}));response.statusCode=404;return response.end('{}');}
    response.statusCode=404;response.end('{}');
  });
  return {server,calls};
}

function adminCatalogServer(type) {
  const calls=[];
  const isTv=type==='series',item=isTv
    ? {id:1,title:'Fixture Show',tvdbId:11,monitored:true,qualityProfileId:2,rootFolderPath:'/tv',tags:[7],seasons:[{seasonNumber:1,monitored:false},{seasonNumber:2,monitored:true}]}
    : {id:1,title:'Fixture Movie',tmdbId:22,monitored:true,qualityProfileId:2,rootFolderPath:'/movies',tags:[7],minimumAvailability:'released'};
  const server=http.createServer((request,response)=>{
    calls.push({method:request.method,path:request.url});response.setHeader('content-type','application/json');
    if(request.url.startsWith('/api/v3/importlist/'))return response.end('[]');
    if(request.url===`/api/v3/${isTv?'series':'movie'}`)return response.end('[]');
    if(request.url===`/api/v3/${isTv?'series':'movie'}/1`)return response.end(JSON.stringify(item));
    if(request.url==='/api/v3/qualityprofile')return response.end(JSON.stringify([{id:2,name:'Balanced'},{id:3,name:'High'}]));
    if(request.url==='/api/v3/rootfolder')return response.end(JSON.stringify([{id:4,path:isTv?'/tv':'/movies',accessible:true},{id:5,path:isTv?'/alternate-tv':'/alternate-movies',accessible:true}]));
    if(request.url==='/api/v3/tag')return response.end(JSON.stringify([{id:7,label:'existing'},{id:8,label:'reviewed'}]));
    if(request.url.startsWith('/api/v3/wanted/missing'))return response.end(JSON.stringify({records:[{id:1,title:item.title,monitored:true}]}));
    if(request.url.startsWith('/api/v3/wanted/cutoff'))return response.end(JSON.stringify({records:[{id:1,title:item.title,monitored:true}]}));
    if(request.url.startsWith('/api/v3/calendar'))return response.end(JSON.stringify([{id:1,title:item.title,monitored:true,airDateUtc:'2026-10-12T00:00:00Z'}]));
    response.statusCode=404;response.end('{}');
  });
  return {server,calls};
}

function monitorExecutionServer() {
  const calls=[];
  const item={id:1,title:'Fixture Movie',tmdbId:22,monitored:true,qualityProfileId:2,rootFolderPath:'/movies',tags:[7],minimumAvailability:'released',revision:1};
  let mode='success';
  const respond=(response,status,payload)=>{response.statusCode=status;response.setHeader('content-type','application/json');response.end(JSON.stringify(payload));};
  const server=http.createServer((request,response)=>{
    const pathName=request.url;
    if(pathName==='/api/v3/movie/1'&&request.method==='GET'){calls.push({method:'GET',path:pathName});return respond(response,200,item);}
    if(pathName==='/api/v3/movie/1'&&request.method==='PUT'){
      let text='';request.on('data',chunk=>{text+=chunk;});return request.on('end',()=>{
        const body=JSON.parse(text||'{}');calls.push({method:'PUT',path:pathName,body});
        if(mode==='put-fail')return respond(response,503,{error:'fixture PUT failure'});
        Object.assign(item,body,{revision:item.revision+1});
        if(mode==='readback-mismatch')item.monitored=!body.monitored;
        return respond(response,200,item);
      });
    }
    calls.push({method:request.method,path:pathName});return respond(response,404,{});
  });
  return {server,calls,setMode:value=>{mode=value;},mutate:()=>{item.title='Changed fixture title';item.revision+=1;},item};
}

function fixtureMonitorEnv(mode='success') {
  return {
    PROVISIONARR_FIXTURE_ADMIN_CONTROLS:'true',
    PROVISIONARR_TEST_FIXTURE_MONITOR_TRANSPORT:'true',
    PROVISIONARR_TEST_FIXTURE_MONITOR_MODE:mode,
    PROVISIONARR_TEST_FIXTURE_MONITOR_SEED:JSON.stringify({movie:[{id:1,title:'Fixture Movie',tmdbId:22,monitored:true,qualityProfileId:2,rootFolderPath:'/movies',tags:[7],minimumAvailability:'released',revision:1}]})
  };
}

test('movie discovery uses only the documented Radarr candidate flags and TV is explicitly unavailable', async t => {
  const radarr = radarrCatalogServer();
  const radarrPort = await listen(radarr);
  t.after(() => radarr.close());
  const fixture = await startProvisionarr(t, {RADARR_URL:`http://127.0.0.1:${radarrPort}`});
  const response = await fetch(`${fixture.base}/api/discover`, {headers:{cookie:fixture.cookie}});
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.movies.status, 'ready');
  assert.equal(payload.tv.status, 'unavailable');
  assert.match(payload.tv.message,/no supported TV discovery provider is configured/i);
  const movieTitles = Object.values(payload.movies.rails).flat().map(item => item.title);
  assert.equal(movieTitles.includes('Movie Candidate'), true);
  assert.equal(movieTitles.includes('Owned Movie'), false);
  assert.equal(new Set(movieTitles).size, movieTitles.length);
  assert.equal(movieTitles.includes('Future Movie'), false);
  assert.equal(radarr.calls.includes('/api/v3/importlist/movie?includeRecommendations=true&includeTrending=true&includePopular=true'),true);
  assert.equal(radarr.calls.some(path=>path.includes('/api/v3/importlist/series')),false);

  const upcoming = await (await fetch(`${fixture.base}/api/discover?upcoming=1`, {headers:{cookie:fixture.cookie}})).json();
  assert.equal(Object.values(upcoming.movies.rails).flat().some(item => item.title === 'Future Movie'), true, JSON.stringify(upcoming.movies));
  assert.equal(upcoming.tv.status,'unavailable');

  const search = await (await fetch(`${fixture.base}/api/search?q=Candidate&type=movie`, {headers:{cookie:fixture.cookie}})).json();
  assert.deepEqual(search.results.map(item => item.title), ['Movie Candidate']);
});

test('movie discovery distinguishes provider failure from an empty supported result', async t => {
  const unavailable=radarrCatalogServer('down'),empty=radarrCatalogServer('empty');
  const [unavailablePort,emptyPort]=await Promise.all([listen(unavailable),listen(empty)]);
  t.after(()=>{unavailable.close();empty.close();});
  const failed=await startProvisionarr(t,{RADARR_URL:`http://127.0.0.1:${unavailablePort}`});
  const fixture = await startProvisionarr(t, {RADARR_URL:`http://127.0.0.1:${emptyPort}`});
  const failedPayload=await (await fetch(`${failed.base}/api/discover`,{headers:{cookie:failed.cookie}})).json();
  assert.equal(failedPayload.movies.status,'unavailable');
  assert.match(failedPayload.movies.message,/connected service could not be reached/i);
  const response = await fetch(`${fixture.base}/api/discover`, {headers:{cookie:fixture.cookie}});
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.movies.status, 'empty');
  assert.equal(payload.tv.status, 'unavailable');
  assert.match(payload.tv.message,/no supported TV discovery provider is configured/i);
});

test('disabled TVmaze never requests a provider, and enabled generic TV catalog is typed, validated, attributed, and private', async t => {
  const radarr=radarrCatalogServer(),tvmaze=tvmazeFixtureServer(),sonarr=sonarrValidationServer();
  const [radarrPort,tvmazePort,sonarrPort]=await Promise.all([listen(radarr),listen(tvmaze.server),listen(sonarr.server)]);
  t.after(()=>{radarr.close();tvmaze.server.close();sonarr.server.close();});
  const disabled=await startProvisionarr(t,{RADARR_URL:`http://127.0.0.1:${radarrPort}`,SONARR_URL:`http://127.0.0.1:${sonarrPort}`,PROVISIONARR_TVMAZE_FIXTURE_MODE:'true',PROVISIONARR_TVMAZE_FIXTURE_URL:`http://127.0.0.1:${tvmazePort}/shows`});
  const disabledPayload=await (await fetch(`${disabled.base}/api/discover`,{headers:{cookie:disabled.cookie}})).json();
  assert.equal(disabledPayload.tv.status,'unavailable');assert.equal(tvmaze.calls.length,0);
  const fixture=await startProvisionarr(t,{RADARR_URL:`http://127.0.0.1:${radarrPort}`,SONARR_URL:`http://127.0.0.1:${sonarrPort}`,PROVISIONARR_TVMAZE_ENABLED:'true',PROVISIONARR_TVMAZE_FIXTURE_MODE:'true',PROVISIONARR_TVMAZE_FIXTURE_URL:`http://127.0.0.1:${tvmazePort}/shows`});
  const payload=await (await fetch(`${fixture.base}/api/discover`,{headers:{cookie:fixture.cookie}})).json();
  assert.equal(payload.tv.status,'ready');assert.equal(payload.tv.generic,true);assert.equal(payload.tv.attribution,'Generic TV catalog data from TVmaze, licensed CC BY-SA.');
  const titles=Object.values(payload.tv.rails).flat().map(item=>item.title);assert.deepEqual(titles,['Validated Generic Show']);
  const card=payload.tv.rails.catalog[0];assert.equal(card.identity,'series:tvmaze:902');assert.equal(card.tvdbId,200);assert.equal(card.reason,'Generic TV catalog');
  assert.equal(card.poster,'https://static.tvmaze.com/uploads/images/medium_portrait/1/2.jpg');
  assert.deepEqual(tvmaze.calls,['/shows?page=0']);assert.equal(tvmaze.calls.some(call=>/user|library|history|title/i.test(call)),false);
  assert.equal(sonarr.calls.some(call=>/\/api\/v3\/series\/lookup\?term=tvdb(?::|%3A)200$/.test(call)),true);assert.equal(sonarr.calls.some(call=>/tvdb(?::|%3A)100/.test(call)),false);assert.equal(sonarr.calls.some(call=>/tvdb(?::|%3A)400/.test(call)),true);
});

test('TVmaze posters allow only the static HTTPS image host and expected image path', async t => {
  const unsafe=['http://static.tvmaze.com/uploads/images/medium_portrait/1/2.jpg','data:image/svg+xml,unsafe','javascript:alert(1)','https://static.tvmaze.com.evil.example/uploads/images/medium_portrait/1/2.jpg','https://evil-static.tvmaze.com/uploads/images/medium_portrait/1/2.jpg','https://user@static.tvmaze.com/uploads/images/medium_portrait/1/2.jpg','https://static.tvmaze.com:444/uploads/images/medium_portrait/1/2.jpg','https://static.tvmaze.com/uploads/images/medium_portrait/1/2.jpg?tracking=1','https://static.tvmaze.com/uploads/images/medium_portrait/1/2.jpg#fragment','https://static.tvmaze.com/not-uploads/images/medium_portrait/1/2.jpg'];
  for(const poster of unsafe){
    const radarr=radarrCatalogServer(),tvmaze=tvmazeFixtureServer('ready',[{id:902,name:'Validated Generic Show',premiered:'2025-01-02',externals:{thetvdb:200},image:{medium:poster}}]),sonarr=sonarrValidationServer();
    const [radarrPort,tvmazePort,sonarrPort]=await Promise.all([listen(radarr),listen(tvmaze.server),listen(sonarr.server)]);
    t.after(()=>{radarr.close();tvmaze.server.close();sonarr.server.close();});
    const fixture=await startProvisionarr(t,{RADARR_URL:`http://127.0.0.1:${radarrPort}`,SONARR_URL:`http://127.0.0.1:${sonarrPort}`,PROVISIONARR_TVMAZE_ENABLED:'true',PROVISIONARR_TVMAZE_FIXTURE_MODE:'true',PROVISIONARR_TVMAZE_FIXTURE_URL:`http://127.0.0.1:${tvmazePort}/shows`});
    const payload=await (await fetch(`${fixture.base}/api/discover`,{headers:{cookie:fixture.cookie}})).json();
    assert.equal(payload.tv.rails.catalog[0].poster,null,poster);
  }
});

test('TVmaze provider reports empty, outage, and rate-limit backoff without falling back to personal or trending labels', async t => {
  for(const mode of ['empty','error','rate']){
    const radarr=radarrCatalogServer(),tvmaze=tvmazeFixtureServer(mode),sonarr=sonarrValidationServer();
    const [radarrPort,tvmazePort,sonarrPort]=await Promise.all([listen(radarr),listen(tvmaze.server),listen(sonarr.server)]);
    const fixture=await startProvisionarr(t,{RADARR_URL:`http://127.0.0.1:${radarrPort}`,SONARR_URL:`http://127.0.0.1:${sonarrPort}`,PROVISIONARR_TVMAZE_ENABLED:'true',PROVISIONARR_TVMAZE_FIXTURE_MODE:'true',PROVISIONARR_TVMAZE_FIXTURE_URL:`http://127.0.0.1:${tvmazePort}/shows`});
    const payload=await (await fetch(`${fixture.base}/api/discover`,{headers:{cookie:fixture.cookie}})).json();
    assert.equal(payload.tv.status,mode==='empty'?'empty':'unavailable');assert.equal(payload.tv.rails.trending?.length||0,0);assert.equal(payload.tv.rails.inspired?.length||0,0);
    if(mode==='rate')assert.match(payload.tv.message,/connected service could not be reached/i);
    await new Promise(resolve=>radarr.close(resolve));await new Promise(resolve=>tvmaze.server.close(resolve));await new Promise(resolve=>sonarr.server.close(resolve));
  }
});

test('linked Emby recommendations remain private, typed, deduplicated, unowned, and separate from unavailable TV discovery', async t => {
  const radarr=radarrCatalogServer(),emby=embyRecommendationServer();
  const [radarrPort,embyPort]=await Promise.all([listen(radarr),listen(emby.server)]);
  t.after(()=>{radarr.close();emby.server.close();});
  const password='fixture-password-123';
  const users=[
    {id:'user-a',username:'user',displayName:'A',role:'user',...passwordRecord(password),preferences:{embyUserId:'emby-a'}},
    {id:'user-b',username:'userb',displayName:'B',role:'user',...passwordRecord(password),preferences:{embyUserId:'emby-b'}},
    {id:'user-unlinked',username:'unlinked',displayName:'Unlinked',role:'user',...passwordRecord(password),preferences:{}}
  ];
  const fixture=await startProvisionarr(t,{RADARR_URL:`http://127.0.0.1:${radarrPort}`,PROVISIONARR_EMBY_URL:`http://127.0.0.1:${embyPort}`,PROVISIONARR_EMBY_API_KEY:'fixture-key'},users);
  const discover=async cookie=>(await fetch(`${fixture.base}/api/discover`,{headers:{cookie}})).json();
  const a=await discover(fixture.cookie),aInspired=[...a.movies.rails.inspired,...a.tv.rails.inspired],aPersonal=aInspired.filter(item=>item.title.startsWith('A Personal'));
  assert.deepEqual(aPersonal.map(item=>item.title).sort(),['A Personal Recommendation']);
  assert.equal(aInspired.some(item=>item.title==='A Owned Candidate'),false);
  assert.equal(new Set(aInspired.map(item=>item.identity)).size,aInspired.length);
  assert.equal(aPersonal.find(item=>item.title==='A Personal Recommendation').reason,'Because you watched A Watched Seed');
  assert.equal(a.tv.status,'unavailable');
  const b=await discover(await fixture.loginAs('userb'));
  assert.equal([...b.movies.rails.inspired,...b.tv.rails.inspired].some(item=>item.title==='A Personal Recommendation'),false);
  assert.equal(b.movies.rails.inspired.some(item=>item.title==='B Personal Recommendation'),true);
  const unlinked=await discover(await fixture.loginAs('unlinked'));
  assert.equal([...unlinked.movies.rails.inspired,...unlinked.tv.rails.inspired].filter(item=>item.reason.startsWith('Because you ')).length,0);
  assert.equal(unlinked.personalized,false);
  assert.equal(emby.calls.some(path=>path.includes('/Users/emby-b/Items'))&&emby.calls.some(path=>path.includes('/Users/emby-a/Items')),true);
  assert.equal(emby.calls.some(path=>path.includes('/Users/undefined/')),false);
});

test('fixture-only owner catalog views and previews are typed, allowlisted, read-back, and write-locked', async t => {
  const sonarr=adminCatalogServer('series'),radarr=adminCatalogServer('movie');
  const [sonarrPort,radarrPort]=await Promise.all([listen(sonarr.server),listen(radarr.server)]);
  t.after(()=>{sonarr.server.close();radarr.server.close();});
  const password='fixture-password-123',users=[
    {id:'owner',username:'user',displayName:'Owner',role:'owner',...passwordRecord(password),preferences:{}},
    {id:'ordinary',username:'ordinary',displayName:'Ordinary',role:'user',...passwordRecord(password),preferences:{}}
  ];
  const fixture=await startProvisionarr(t,{SONARR_URL:`http://127.0.0.1:${sonarrPort}`,RADARR_URL:`http://127.0.0.1:${radarrPort}`,PROVISIONARR_FIXTURE_ADMIN_CONTROLS:'true'},users);
  const owner=fixture.cookie,ordinary=await fixture.loginDetails('ordinary');
  const get=async (type,view,cookie=owner)=>fetch(`${fixture.base}/api/admin/catalog?type=${type}&view=${view}`,{headers:{cookie}});
  const movies=await get('movie','missing');assert.equal(movies.status,200);const moviePayload=await movies.json();assert.equal(moviePayload.type,'movie');assert.equal(moviePayload.items[0].title,'Fixture Movie');assert.deepEqual(moviePayload.choices.tags,[{id:7,label:'existing'},{id:8,label:'reviewed'}]);
  const tv=await get('series','calendar');assert.equal(tv.status,200);assert.equal((await tv.json()).items[0].type,'series');
  assert.equal((await get('movie','cutoff',ordinary.cookie)).status,403);
  const preview=async body=>fetch(`${fixture.base}/api/admin/catalog/preview`,{method:'POST',headers:{cookie:owner,'content-type':'application/json','x-csrf-token':fixture.csrf},body:JSON.stringify(body)});
  const monitor=await preview({type:'movie',action:'monitor',itemId:1,monitored:false});assert.equal(monitor.status,400);assert.equal((await monitor.json()).code,'CATALOG_MONITOR_ROUTE_REQUIRED');
  const ordinaryPreview=await fetch(`${fixture.base}/api/admin/catalog/preview`,{method:'POST',headers:{cookie:ordinary.cookie,'content-type':'application/json','x-csrf-token':ordinary.csrf},body:JSON.stringify({type:'movie',action:'monitor',itemId:1,monitored:false})});assert.equal(ordinaryPreview.status,403);
  const season=await preview({type:'series',action:'season',itemId:1,seasonNumber:1,monitored:true});assert.equal(season.status,200);const seasonPlan=(await season.json()).plan;assert.equal(seasonPlan.after.seasons.find(row=>row.seasonNumber===1).monitored,true);
  for(const body of [
    {type:'movie',action:'qualityProfile',itemId:1,qualityProfileId:3},
    {type:'movie',action:'rootFolder',itemId:1,rootFolderPath:'/alternate-movies'},
    {type:'movie',action:'tags',itemId:1,tagIds:[8]},
    {type:'movie',action:'minimumAvailability',itemId:1,minimumAvailability:'inCinemas'}
  ])assert.equal((await preview(body)).status,200);
  assert.equal((await preview({type:'movie',action:'monitor',itemId:1,monitored:true,unexpected:true})).status,400);
  const confirm=await fetch(`${fixture.base}/api/admin/catalog/confirm`,{method:'POST',headers:{cookie:owner,'content-type':'application/json','x-csrf-token':fixture.csrf},body:JSON.stringify({planId:seasonPlan.id})});assert.equal(confirm.status,409);assert.equal((await confirm.json()).code,'CATALOG_WRITES_LOCKED');
  const ordinaryConfirm=await fetch(`${fixture.base}/api/admin/catalog/confirm`,{method:'POST',headers:{cookie:ordinary.cookie,'content-type':'application/json','x-csrf-token':ordinary.csrf},body:JSON.stringify({planId:seasonPlan.id})});assert.equal(ordinaryConfirm.status,403);
  assert.equal([...sonarr.calls,...radarr.calls].every(call=>call.method==='GET'),true);
  const beforeNonLoopback=radarr.calls.length;
  const nonLoopback=await startProvisionarr(t,{SONARR_URL:'http://192.168.50.9:8989',RADARR_URL:`http://127.0.0.1:${radarrPort}`,PROVISIONARR_FIXTURE_ADMIN_CONTROLS:'true'},users);
  const nonLoopbackView=await fetch(`${nonLoopback.base}/api/admin/catalog?type=movie&view=missing`,{headers:{cookie:nonLoopback.cookie}});assert.equal(nonLoopbackView.status,409);assert.equal((await nonLoopbackView.json()).code,'FIXTURE_ADMIN_LOOPBACK_ONLY');assert.equal(radarr.calls.length,beforeNonLoopback);
});

test('fixture monitor execution is owner-bound, CSRF-protected, stale-safe, one-time, and read-back verified', async t => {
  const monitor=monitorExecutionServer(),sonarr=adminCatalogServer('series');
  const [monitorPort,sonarrPort]=await Promise.all([listen(monitor.server),listen(sonarr.server)]);
  t.after(()=>{monitor.server.close();sonarr.server.close();});
  const password='fixture-password-123',users=[
    {id:'owner',username:'user',displayName:'Owner',role:'owner',...passwordRecord(password),preferences:{}},
    {id:'ordinary',username:'ordinary',displayName:'Ordinary',role:'user',...passwordRecord(password),preferences:{}}
  ];
  const fixture=await startProvisionarr(t,{SONARR_URL:`http://127.0.0.1:${sonarrPort}`,RADARR_URL:`http://127.0.0.1:${monitorPort}`,...fixtureMonitorEnv()},users);
  const owner={cookie:fixture.cookie,csrf:fixture.csrf},ordinary=await fixture.loginDetails('ordinary');
  const headers=session=>({cookie:session.cookie,'content-type':'application/json','x-csrf-token':session.csrf});
  const preview=(body={type:'movie',itemId:1,monitored:false},session=owner,includeCsrf=true)=>fetch(`${fixture.base}/api/admin/catalog/monitor/preview`,{method:'POST',headers:includeCsrf?headers(session):{cookie:session.cookie,'content-type':'application/json'},body:JSON.stringify(body)});
  const confirm=(planId,session=owner,includeCsrf=true)=>fetch(`${fixture.base}/api/admin/catalog/monitor/confirm`,{method:'POST',headers:includeCsrf?headers(session):{cookie:session.cookie,'content-type':'application/json'},body:JSON.stringify({planId})});

  assert.equal((await fetch(`${fixture.base}/api/admin/catalog/monitor/preview`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'movie',itemId:1,monitored:false})})).status,401);
  assert.equal((await preview(undefined,ordinary)).status,403);
  assert.equal((await preview(undefined,owner,false)).status,403);
  assert.equal((await preview({type:'movie',itemId:1,monitored:false,action:'season'})).status,400);
  assert.equal((await preview({type:'movie',itemId:2,monitored:false})).status,404);

  const first=await preview();assert.equal(first.status,200);const firstPlan=(await first.json()).plan;
  assert.deepEqual(Object.keys(firstPlan).sort(),['action','after','before','createdAt','expiresAt','fixtureOnly','id','itemId','revision','type','writesEnabled']);
  assert.equal(firstPlan.before.monitored,true);assert.equal(firstPlan.after.monitored,false);assert.equal(firstPlan.writesEnabled,true);assert.equal(firstPlan.fixtureOnly,true);
  assert.equal((await confirm(firstPlan.id,ordinary)).status,403);
  assert.equal((await confirm(firstPlan.id,owner,false)).status,403);
  const executed=await confirm(firstPlan.id);assert.equal(executed.status,200);const executedPayload=await executed.json();assert.equal(executedPayload.outcome,'FIXTURE_EXECUTED');assert.equal(executedPayload.item.monitored,false);
  assert.equal(monitor.calls.filter(call=>call.method==='PUT').length,0,'configured loopback service must never receive an executable monitor PUT');assert.equal((await confirm(firstPlan.id)).status,409);

  const staleFixture=await startProvisionarr(t,{SONARR_URL:`http://127.0.0.1:${sonarrPort}`,RADARR_URL:`http://127.0.0.1:${monitorPort}`,...fixtureMonitorEnv('stale-on-confirm')},users);const staleOwner={cookie:staleFixture.cookie,csrf:staleFixture.csrf};const stalePreview=await fetch(`${staleFixture.base}/api/admin/catalog/monitor/preview`,{method:'POST',headers:headers(staleOwner),body:JSON.stringify({type:'movie',itemId:1,monitored:false})});const stale=(await stalePreview.json()).plan;const staleResponse=await fetch(`${staleFixture.base}/api/admin/catalog/monitor/confirm`,{method:'POST',headers:headers(staleOwner),body:JSON.stringify({planId:stale.id})});assert.equal(staleResponse.status,409);assert.equal((await staleResponse.json()).code,'CATALOG_PLAN_STALE');
  const failedFixture=await startProvisionarr(t,{SONARR_URL:`http://127.0.0.1:${sonarrPort}`,RADARR_URL:`http://127.0.0.1:${monitorPort}`,...fixtureMonitorEnv('put-fail')},users);const failedOwner={cookie:failedFixture.cookie,csrf:failedFixture.csrf};const putPlan=(await (await fetch(`${failedFixture.base}/api/admin/catalog/monitor/preview`,{method:'POST',headers:headers(failedOwner),body:JSON.stringify({type:'movie',itemId:1,monitored:false})})).json()).plan;const putResponse=await fetch(`${failedFixture.base}/api/admin/catalog/monitor/confirm`,{method:'POST',headers:headers(failedOwner),body:JSON.stringify({planId:putPlan.id})});assert.equal(putResponse.status,502);assert.equal((await putResponse.json()).code,'CATALOG_MONITOR_PUT_FAILED');
  const mismatchFixture=await startProvisionarr(t,{SONARR_URL:`http://127.0.0.1:${sonarrPort}`,RADARR_URL:`http://127.0.0.1:${monitorPort}`,...fixtureMonitorEnv('readback-mismatch')},users);const mismatchOwner={cookie:mismatchFixture.cookie,csrf:mismatchFixture.csrf};const mismatchPlan=(await (await fetch(`${mismatchFixture.base}/api/admin/catalog/monitor/preview`,{method:'POST',headers:headers(mismatchOwner),body:JSON.stringify({type:'movie',itemId:1,monitored:false})})).json()).plan;const mismatchResponse=await fetch(`${mismatchFixture.base}/api/admin/catalog/monitor/confirm`,{method:'POST',headers:headers(mismatchOwner),body:JSON.stringify({planId:mismatchPlan.id})});assert.equal(mismatchResponse.status,502);assert.equal((await mismatchResponse.json()).code,'CATALOG_MONITOR_READBACK_MISMATCH');
  assert.equal(monitor.calls.filter(call=>call.method==='PUT').length,0);
  const audit=fs.readFileSync(path.join(fixture.root,'audit.jsonl'),'utf8'),staleAudit=fs.readFileSync(path.join(staleFixture.root,'audit.jsonl'),'utf8'),failedAudit=fs.readFileSync(path.join(failedFixture.root,'audit.jsonl'),'utf8'),mismatchAudit=fs.readFileSync(path.join(mismatchFixture.root,'audit.jsonl'),'utf8');assert.match(audit,/FIXTURE_EXECUTED/);assert.match(staleAudit,/FIXTURE_STALE/);assert.match(failedAudit,/FIXTURE_PUT_FAILED/);assert.match(mismatchAudit,/FIXTURE_READBACK_MISMATCH/);

  const disabled=await startProvisionarr(t,{SONARR_URL:`http://127.0.0.1:${sonarrPort}`,RADARR_URL:`http://127.0.0.1:${monitorPort}`,PROVISIONARR_TEST_FIXTURE_MONITOR_TRANSPORT:'true',PROVISIONARR_TEST_FIXTURE_MONITOR_SEED:fixtureMonitorEnv().PROVISIONARR_TEST_FIXTURE_MONITOR_SEED},users);
  const disabledResponse=await fetch(`${disabled.base}/api/admin/catalog/monitor/preview`,{method:'POST',headers:{cookie:disabled.cookie,'content-type':'application/json','x-csrf-token':disabled.csrf},body:JSON.stringify({type:'movie',itemId:1,monitored:false})});assert.equal(disabledResponse.status,409);assert.equal((await disabledResponse.json()).code,'FIXTURE_ADMIN_ONLY');
  assert.equal(monitor.calls.filter(call=>call.method==='PUT').length,0);
});
