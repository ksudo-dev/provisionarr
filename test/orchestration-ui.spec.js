const {test,expect} = require('@playwright/test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');

const password='browser-test-password';
let root;
let application;
let sonarr;
let radarr;
let prowlarr;
let qbittorrent;
let baseURL;
let sonarrURL;

function passwordRecord(value) {
  const salt=crypto.randomBytes(16).toString('hex');
  return {salt,hash:crypto.scryptSync(value,salt,64).toString('hex')};
}

async function unusedPort() {
  const socket=net.createServer();
  await new Promise((resolve,reject)=>socket.listen(0,'127.0.0.1',resolve).on('error',reject));
  const port=socket.address().port;
  await new Promise(resolve=>socket.close(resolve));
  return port;
}

async function waitFor(target) {
  for(let attempt=0;attempt<100;attempt+=1){
    try{if((await fetch(target)).ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw new Error(`Test server did not become ready: ${target}`);
}

function arrFixture(kind) {
  return http.createServer((request,response)=>{
    response.setHeader('content-type','application/json');
    if(![`fixture-${kind}-key`,`saved-${kind}-key`].includes(String(request.headers['x-api-key']||''))){
      response.statusCode=401;
      response.end(JSON.stringify({error:'unauthorized'}));
      return;
    }
    if(request.url==='/api/v3/system/status')return response.end(JSON.stringify({appName:kind==='sonarr'?'Sonarr':'Radarr',version:'4.0.0'}));
    if(request.url==='/api/v3/rootfolder')return response.end(JSON.stringify([{id:1,path:kind==='sonarr'?'/tv':'/movies',freeSpace:123456,accessible:true}]));
    if(request.url==='/api/v3/qualityprofile')return response.end(JSON.stringify([{id:2,name:'Balanced',upgradeAllowed:true,cutoff:6}]));
    if(request.url==='/api/v3/downloadclient')return response.end(JSON.stringify([{id:3,name:'qBittorrent',enable:true,implementation:'QBittorrent',protocol:'torrent',priority:1,removeCompletedDownloads:true,removeFailedDownloads:true}]));
    if(request.url==='/api/v3/config/mediamanagement')return response.end(JSON.stringify({renameEpisodes:true,renameMovies:true,replaceIllegalCharacters:true,importExtraFiles:false}));
    if(request.url==='/api/v3/config/downloadclient')return response.end(JSON.stringify({enableCompletedDownloadHandling:true,removeCompletedDownloads:false}));
    response.statusCode=404;
    response.end('{}');
  });
}

function prowlarrFixture() {
  return http.createServer((request,response)=>{
    response.setHeader('content-type','application/json');
    if(!['fixture-prowlarr-key','saved-prowlarr-key'].includes(String(request.headers['x-api-key']||''))){response.statusCode=401;response.end('{}');return;}
    if(request.url==='/api/v1/system/status')return response.end(JSON.stringify({appName:'Prowlarr',version:'1.0.0'}));
    if(request.url==='/api/v1/health')return response.end('[]');
    if(request.url==='/api/v1/indexer')return response.end(JSON.stringify([{name:'Indexer',enable:true}]));
    if(request.url==='/api/v1/applications')return response.end(JSON.stringify([
      {id:1,name:'Sonarr',implementation:'Sonarr',configContract:'SonarrSettings',syncLevel:'fullSync',fields:[{name:'prowlarrUrl',value:'http://prowlarr:9696'},{name:'baseUrl',value:'http://sonarr:8989'},{name:'apiKey',value:'fixture-sonarr-key'}]},
      {id:2,name:'Radarr',implementation:'Radarr',configContract:'RadarrSettings',syncLevel:'fullSync',fields:[{name:'prowlarrUrl',value:'http://prowlarr:9696'},{name:'baseUrl',value:'http://radarr:7878'},{name:'apiKey',value:'fixture-radarr-key'}]}
    ]));
    if(request.url==='/api/v1/applications/schema')return response.end(JSON.stringify([{name:'Sonarr',implementationName:'Sonarr',implementation:'Sonarr',configContract:'SonarrSettings',fields:[{name:'prowlarrUrl'},{name:'baseUrl'},{name:'apiKey'}],tags:[]},{name:'Radarr',implementationName:'Radarr',implementation:'Radarr',configContract:'RadarrSettings',fields:[{name:'prowlarrUrl'},{name:'baseUrl'},{name:'apiKey'}],tags:[]}]));
    response.statusCode=404;response.end('{}');
  });
}

function qbittorrentFixture() {
  return http.createServer((request,response)=>{
    if(request.url==='/api/v2/auth/login'&&request.method==='POST'){
      let body='';request.on('data',chunk=>{body+=chunk;});request.on('end',()=>{
        const valid=(body.includes('username=fixture-qbit-user')&&body.includes('password=fixture-qbit-password'))||(body.includes('username=saved-qbit-user')&&body.includes('password=saved-qbit-password'));
        if(valid){response.setHeader('set-cookie','SID=browser-session; HttpOnly');response.end('Ok.');return;}
        response.end('Fails.');
      });return;
    }
    if(!String(request.headers.cookie||'').includes('SID=')){response.statusCode=403;response.end('Forbidden');return;}
    if(request.url==='/api/v2/app/version')return response.end('v5.0.0');
    response.setHeader('content-type','application/json');
    if(request.url==='/api/v2/app/preferences')return response.end(JSON.stringify({save_path:'/downloads'}));
    if(request.url==='/api/v2/torrents/info?limit=200')return response.end('[]');
    response.statusCode=404;response.end('{}');
  });
}

test.beforeAll(async () => {
  root=fs.mkdtempSync(path.join(os.tmpdir(),'provisionarr-browser-'));
  const owner={id:'owner',username:'owner',displayName:'System Administrator',role:'owner',...passwordRecord(password),preferences:{}};
  fs.writeFileSync(path.join(root,'users.json'),JSON.stringify([owner]));
  const [port,sonarrPort,radarrPort,prowlarrPort,qbitPort]=await Promise.all([unusedPort(),unusedPort(),unusedPort(),unusedPort(),unusedPort()]);
  sonarr=arrFixture('sonarr');
  radarr=arrFixture('radarr');
  prowlarr=prowlarrFixture();
  qbittorrent=qbittorrentFixture();
  await Promise.all([
    new Promise(resolve=>sonarr.listen(sonarrPort,'127.0.0.1',resolve)),
    new Promise(resolve=>radarr.listen(radarrPort,'127.0.0.1',resolve)),
    new Promise(resolve=>prowlarr.listen(prowlarrPort,'127.0.0.1',resolve)),
    new Promise(resolve=>qbittorrent.listen(qbitPort,'127.0.0.1',resolve))
  ]);
  baseURL=`http://127.0.0.1:${port}`;
  sonarrURL=`http://127.0.0.1:${sonarrPort}`;
  application=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{
    env:{...process.env,PORT:String(port),PROVISIONARR_LISTEN_HOST:'127.0.0.1',PROVISIONARR_CONFIG_ROOT:root,PROVISIONARR_REQUEST_LOG:path.join(root,'requests.json'),PROVISIONARR_USERS_FILE:path.join(root,'users.json'),PROVISIONARR_SETTINGS_FILE:path.join(root,'settings.json'),PROVISIONARR_ADMIN_FILE:path.join(root,'admin.json'),PROVISIONARR_AUDIT_FILE:path.join(root,'audit.jsonl'),PROVISIONARR_SESSION_FILE:path.join(root,'sessions.json'),PROVISIONARR_ORCHESTRATION_CONNECTIONS_FILE:path.join(root,'orchestration-connections.json'),SONARR_URL:sonarrURL,RADARR_URL:`http://127.0.0.1:${radarrPort}`,SONARR_API_KEY:'fixture-sonarr-key',RADARR_API_KEY:'fixture-radarr-key',PROWLARR_URL:`http://127.0.0.1:${prowlarrPort}`,PROWLARR_API_KEY:'fixture-prowlarr-key',PROVISIONARR_QBIT_URL:`http://127.0.0.1:${qbitPort}`,PROVISIONARR_QBIT_USERNAME:'fixture-qbit-user',PROVISIONARR_QBIT_PASSWORD:'fixture-qbit-password',PROVISIONARR_ORCHESTRATION_WRITES_ENABLED:'false'},
    stdio:'ignore'
  });
  await waitFor(`${baseURL}/api/bootstrap`);
});

test.afterAll(async () => {
  application?.kill();
  sonarr?.close();
  radarr?.close();
  prowlarr?.close();
  qbittorrent?.close();
  if(application&&application.exitCode===null)await new Promise(resolve=>application.once('exit',resolve));
  if(root)fs.rmSync(root,{recursive:true,force:true});
});

test('owner connects and reviews compatible ARR services without exposing keys', async ({page},testInfo) => {
  await page.goto(`${baseURL}/#/account`);
  await page.getByLabel('Username').fill('owner');
  await page.getByLabel('Password').fill(password);
  await page.locator('#login-form').getByRole('button',{name:'Sign in'}).click();
  await expect(page).toHaveURL(/#\/guided-setup$/);
  await expect(page.getByRole('heading',{name:'How do you want to set up Provisionarr?'})).toBeVisible();
  await page.getByRole('button',{name:/Connect an existing stack/}).click();

  await expect(page.getByRole('heading',{name:'Set up the media stack.'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Connect the services you already run'})).toBeVisible();
  await expect(page.locator('.orchestration-connection')).toHaveCount(4);
  await expect(page.getByText('Credentials are stored on the server and never returned to this page.')).toHaveCount(4);
  await expect(page.locator('body')).not.toContainText('fixture-sonarr-key');

  const sonarrForm=page.locator('[data-connection-service="sonarr"]');
  await sonarrForm.getByLabel('Service URL').fill(sonarrURL);
  await sonarrForm.getByLabel('API key').fill('saved-sonarr-key');
  await sonarrForm.getByRole('button',{name:'Test and save'}).click();
  await expect(page.getByText('Sonarr connected and saved.')).toBeVisible();
  await expect(sonarrForm.getByText('Connected',{exact:true})).toBeVisible();
  await expect(sonarrForm.getByLabel('API key')).toHaveValue('');
  await expect(page.locator('body')).not.toContainText('saved-sonarr-key');

  const qbitForm=page.locator('[data-connection-service="qbittorrent"]');
  await qbitForm.getByLabel('Username').fill('saved-qbit-user');
  await qbitForm.getByLabel('Password').fill('saved-qbit-password');
  await qbitForm.getByRole('button',{name:'Test and save'}).click();
  await expect(page.getByText('qBittorrent connected and saved.')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('saved-qbit-password');

  await page.getByRole('button',{name:'Continue to library paths'}).click();
  await expect(page.getByRole('heading',{name:'Set library paths'})).toBeVisible();
  await expect(page.getByLabel('Sonarr library path')).toHaveValue('/tv');
  await expect(page.getByLabel('Radarr library path')).toHaveValue('/movies');
  await page.getByRole('button',{name:'Continue to qBittorrent'}).click();
  await expect(page.getByRole('heading',{name:'Link qBittorrent'})).toBeVisible();
  await expect(page.getByLabel('qBittorrent address')).toHaveValue(/127\.0\.0\.1/);

  await page.locator('[data-setup-step="4"]').click();
  await expect(page.getByRole('heading',{name:'Connect Prowlarr to Sonarr and Radarr'})).toBeVisible();
  await page.getByLabel('Prowlarr callback URL').fill('http://prowlarr.private:9696');
  await page.getByLabel('Sonarr URL').fill('http://sonarr.private:8989');
  await page.getByLabel('Radarr URL').fill('http://radarr.private:7878');
  await page.getByLabel('Add-only').check();
  await page.getByRole('button',{name:'Review Prowlarr links'}).click();
  await expect(page.getByText('REDACTED PREVIEW')).toBeVisible();
  await expect(page.locator('#prowlarr-links-plan')).toContainText('••••:8989');
  await expect(page.locator('#prowlarr-links-plan')).toContainText('••••:7878');
  await expect(page.locator('#prowlarr-links-plan')).not.toContainText('fixture-sonarr-key');
  await expect(page.getByRole('button',{name:'Apply locked'})).toBeVisible();

  await page.locator('.onboarding-secondary > summary').click();
  await expect(page.getByRole('button',{name:'Review settings'})).toBeEnabled();
  const firstSetting=page.locator('[data-setting]').first();
  await firstSetting.setChecked(!(await firstSetting.isChecked()));
  await page.getByRole('button',{name:'Review settings'}).click();
  await expect(page.locator('#orchestration-plan').getByText('SAFE PREVIEW')).toBeVisible();
  await expect(page.locator('#orchestration-plan').getByText('Nothing has been changed.')).toBeVisible();
  await expect(page.locator('#orchestration-plan').getByRole('button',{name:'Apply locked'})).toBeDisabled();
  await expect(page.getByRole('heading',{name:'Generate reviewable Compose files'})).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('/var/run/docker.sock');
  await expect(page.locator('body')).not.toContainText('privileged:');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);

  await page.locator('[data-setup-step="5"]').click();
  await expect(page.getByRole('heading',{name:'Verify the stack'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Finish setup'})).toBeVisible();
  const screenshotPath=testInfo.outputPath('guided-setup.png');
  await page.screenshot({path:screenshotPath,fullPage:true});
  await testInfo.attach('guided-setup',{path:screenshotPath,contentType:'image/png'});
  await page.getByRole('button',{name:'Finish setup'}).click();
  await expect(page).toHaveURL(/#\/home$/);
  expect(await page.evaluate(()=>localStorage.getItem('provisionarr-guided-setup-complete'))).toBe('true');

  const saved=JSON.parse(fs.readFileSync(path.join(root,'orchestration-connections.json'),'utf8'));
  expect(saved.services.sonarr.apiKey).toBe('saved-sonarr-key');
  expect(fs.statSync(path.join(root,'orchestration-connections.json')).mode&0o777).toBe(0o600);

  await page.setViewportSize({width:390,height:844});
  await page.goto(`${baseURL}/#/guided-setup`);
  await page.locator('[data-setup-step="5"]').click();
  await expect(page.getByRole('heading',{name:'Verify the stack'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  const mobileScreenshot=testInfo.outputPath('guided-setup-mobile.png');
  await page.screenshot({path:mobileScreenshot,fullPage:true});
  await testInfo.attach('guided-setup-mobile',{path:mobileScreenshot,contentType:'image/png'});
});

test('discovery and search keep movies separate from TV shows', async ({page}) => {
  await page.route('**/api/discover',route=>route.fulfill({
    contentType:'application/json',
    body:JSON.stringify({
      inspired:[
        {title:'Movie Alpha',year:2025,mediaType:'movie',serviceId:'radarr'},
        {title:'Show Alpha',year:2025,mediaType:'series',serviceId:'sonarr'}
      ],
      trending:[
        {title:'Movie Beta',year:2024,mediaType:'movie',serviceId:'radarr'},
        {title:'Show Beta',year:2024,mediaType:'series',serviceId:'sonarr'}
      ],
      popular:[{title:'Movie Gamma',year:2023,mediaType:'movie',serviceId:'radarr'}],
      newReleases:[{title:'Show Gamma',year:2026,mediaType:'series',serviceId:'sonarr'}]
    })
  }));
  await page.goto(`${baseURL}/#/account`);
  await page.getByLabel('Username').fill('owner');
  await page.getByLabel('Password').fill(password);
  await page.locator('#login-form').getByRole('button',{name:'Sign in'}).click();
  await expect(page).toHaveURL(/#\/guided-setup$/);
  await page.goto(`${baseURL}/#/home`);
  const movieDiscovery=page.locator('.media-category').filter({has:page.getByRole('heading',{name:'Movies',exact:true})});
  const showDiscovery=page.locator('.media-category').filter({has:page.getByRole('heading',{name:'TV shows',exact:true})});
  await expect(movieDiscovery.getByRole('button',{name:'View Movie Alpha'})).toBeVisible();
  await expect(movieDiscovery.getByRole('button',{name:'View Movie Beta'})).toBeVisible();
  await expect(movieDiscovery.getByRole('button',{name:'View Movie Gamma'})).toBeVisible();
  await expect(movieDiscovery).not.toContainText('Show Alpha');
  await expect(showDiscovery.getByRole('button',{name:'View Show Alpha'})).toBeVisible();
  await expect(showDiscovery.getByRole('button',{name:'View Show Beta'})).toBeVisible();
  await expect(showDiscovery.getByRole('button',{name:'View Show Gamma'})).toBeVisible();
  await expect(showDiscovery).not.toContainText('Movie Alpha');

  await page.route('**/api/search?*',route=>route.fulfill({
    contentType:'application/json',
    body:JSON.stringify({results:[
      {title:'Shared Movie',year:2025,mediaType:'movie',serviceId:'radarr',mediaRef:'movie-ref'},
      {title:'Shared Show',year:2025,mediaType:'series',serviceId:'sonarr',mediaRef:'show-ref'}
    ]})
  }));
  await page.goto(`${baseURL}/#/search?query=Shared`);
  const movieResults=page.locator('.search-category').filter({has:page.getByRole('heading',{name:'Movies',exact:true})});
  const showResults=page.locator('.search-category').filter({has:page.getByRole('heading',{name:'TV shows',exact:true})});
  await expect(movieResults.getByRole('button',{name:'View Shared Movie'})).toBeVisible();
  await expect(movieResults).not.toContainText('Shared Show');
  await expect(showResults.getByRole('button',{name:'View Shared Show'})).toBeVisible();
  await expect(showResults).not.toContainText('Shared Movie');
});
