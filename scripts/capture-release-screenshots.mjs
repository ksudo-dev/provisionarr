import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(scriptDir);
const outputDir = path.join(projectDir, 'docs', 'images');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'provisionarr-screenshots-'));

function passwordRecord(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {salt, hash:crypto.scryptSync(password, salt, 64).toString('hex')};
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).on('error', reject));
  const {port} = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function poster(title, first, second) {
  const safeTitle = title.replace(/[&<>"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750" viewBox="0 0 500 750"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${first}"/><stop offset="1" stop-color="${second}"/></linearGradient></defs><rect width="500" height="750" rx="24" fill="url(#g)"/><circle cx="375" cy="170" r="110" fill="#fff" opacity=".08"/><path d="M80 540h340M80 580h250" stroke="#fff" stroke-width="8" opacity=".35"/><text x="70" y="500" fill="#fff" font-family="system-ui,sans-serif" font-size="46" font-weight="700">${safeTitle}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const titles = [
  ['Signal Fire', 2025, '#f05f57', '#172c49'],
  ['The Last Orbit', 2024, '#2f6f8f', '#111827'],
  ['Open Water', 2023, '#2c8c86', '#10233b'],
  ['Midnight Train', 2025, '#7356a8', '#151c2e'],
  ['Northbound', 2024, '#b36a3c', '#182336'],
  ['Paper Planets', 2022, '#386cb0', '#27234d'],
  ['Quiet City', 2025, '#59788c', '#16222e'],
  ['Second Sunrise', 2024, '#d77d53', '#342a4e']
].map(([title, year, first, second], index) => ({
  kind:'media', mediaRef:`fixture-${index}`, title, year, mediaType:'movie', service:'radarr',
  poster:poster(title, first, second), overview:'A release-safe fixture title used to demonstrate the request experience.',
  availability:'can_request', actions:['view','propose_request']
}));

const southPark = {
  kind:'media', mediaRef:'fixture-south-park', title:'South Park', year:1997, mediaType:'series',
  service:'sonarr', poster:poster('South Park', '#e65f5c', '#204b74'),
  overview:'Four friends find trouble and absurdity in their small mountain town.',
  availability:'can_request', seasonNumber:1, seasonTitle:'Season 1', actions:['view','propose_request']
};

const users = [
  {id:'owner', username:'releaseowner', displayName:'System Administrator', role:'owner', ...passwordRecord('fixture-owner-password'), preferences:{}},
  {id:'user', username:'releaseuser', displayName:'Alex', role:'user', ...passwordRecord('fixture-user-password'), preferences:{notifications:true}}
];
fs.writeFileSync(path.join(fixtureRoot, 'users.json'), JSON.stringify(users));
fs.mkdirSync(outputDir, {recursive:true});

const port = await unusedPort();
const child = spawn(process.execPath, [path.join(projectDir, 'server.js')], {
  cwd:projectDir,
  stdio:'ignore',
  env:{
    ...process.env,
    PORT:String(port),
    PROVISIONARR_LISTEN_HOST:'127.0.0.1',
    PROVISIONARR_CONFIG_ROOT:fixtureRoot,
    PROVISIONARR_REQUEST_LOG:path.join(fixtureRoot, 'requests.json'),
    PROVISIONARR_USERS_FILE:path.join(fixtureRoot, 'users.json'),
    PROVISIONARR_SETTINGS_FILE:path.join(fixtureRoot, 'settings.json'),
    PROVISIONARR_ADMIN_FILE:path.join(fixtureRoot, 'admin.json'),
    PROVISIONARR_AUDIT_FILE:path.join(fixtureRoot, 'audit.jsonl'),
    PROVISIONARR_SESSION_FILE:path.join(fixtureRoot, 'sessions.json')
  }
});

const baseURL = `http://127.0.0.1:${port}`;
for (let attempt = 0; attempt < 100; attempt += 1) {
  try { if ((await fetch(baseURL)).ok) break; } catch {}
  if (attempt === 99) throw new Error('Screenshot fixture did not start');
  await new Promise(resolve => setTimeout(resolve, 50));
}

function bootstrap(role) {
  const owner = role === 'owner';
  return {
    appName:'Provisionarr', adminConfigured:true, authenticated:true, ownerAuthenticated:owner,
    csrf:'release-fixture-csrf',
    user:owner
      ? {id:'owner', username:'releaseowner', displayName:'System Administrator', role:'owner', preferences:{}}
      : {id:'user', username:'releaseuser', displayName:'Alex', role:'user', preferences:{notifications:true}}
  };
}

async function installFixtureRoutes(page, role) {
  await page.route('**/api/**', async route => {
    const requestURL = new URL(route.request().url());
    const pathname = requestURL.pathname;
    let body = {};
    if (pathname === '/api/bootstrap') body = bootstrap(role);
    else if (pathname === '/api/notifications') body = {supported:true, notifications:[], unread:0};
    else if (pathname === '/api/health') body = role === 'owner'
      ? {checkedAt:new Date().toISOString(), services:[], disk:{low:false}, alerts:[]}
      : {checkedAt:new Date().toISOString(), needsAttention:false, message:'Everything is working normally.'};
    else if (pathname === '/api/discover') body = {
      personalized:true,
      inspired:titles.slice(0,6),
      trending:titles.slice(2,8),
      popular:[...titles].reverse().slice(0,6),
      newReleases:titles.filter(item => item.year >= 2024)
    };
    else if (pathname === '/api/search') body = {results:[southPark]};
    else if (pathname === '/api/admin/overview') body = {
      status:'healthy', plainStatus:'Everything is working normally.', alerts:[],
      requestCounts:{pending_approval:2},
      library:{connected:true,total:428,server:'Emby'},
      storage:{total:4000000000000,used:2480000000000,free:1520000000000,usedPercent:62,freeGb:1415.6,freePercent:38,low:false},
      services:[
        {id:'sonarr',label:'TV',ok:true,version:'4.0'},
        {id:'radarr',label:'Movies',ok:true,version:'6.1'},
        {id:'prowlarr',label:'Prowlarr',ok:true,version:'2.3'}
      ],
      downloads:{connected:true,total:2,active:2,failed:0,rows:[
        {id:'one',title:'Signal Fire',service:'Movies',progress:68,state:'downloading',importing:false},
        {id:'two',title:'Northbound',service:'TV',progress:24,state:'downloading',importing:false}
      ]}
    };
    else body = {ok:true};
    await route.fulfill({status:200, contentType:'application/json', body:JSON.stringify(body)});
  });
}

const browser = await chromium.launch({headless:true});
const browserErrors = [];
try {
  const userContext = await browser.newContext({viewport:{width:1440,height:1000}, deviceScaleFactor:1});
  const userPage = await userContext.newPage();
  userPage.on('pageerror', error => browserErrors.push(error.message));
  await installFixtureRoutes(userPage, 'user');
  await userPage.goto(`${baseURL}/#/home`, {waitUntil:'networkidle'});
  await userPage.locator('#inspired .poster').first().waitFor();
  assert.equal(await userPage.getByRole('link', {name:'Admin'}).isHidden(), true);
  assert.equal(await userPage.locator('#inspired .poster').count(), 6);
  await userPage.screenshot({path:path.join(outputDir, 'home-user.png'), fullPage:false});
  await userPage.goto(`${baseURL}/#/search?query=Southpark%20season%201`, {waitUntil:'networkidle'});
  await userPage.getByText('South Park', {exact:true}).first().waitFor();
  assert.equal(await userPage.locator('#result-grid .poster').count(), 1);
  await userPage.screenshot({path:path.join(outputDir, 'search-season.png'), fullPage:false});
  await userContext.close();

  const ownerContext = await browser.newContext({viewport:{width:1440,height:1000}, deviceScaleFactor:1});
  const ownerPage = await ownerContext.newPage();
  ownerPage.on('pageerror', error => browserErrors.push(error.message));
  await installFixtureRoutes(ownerPage, 'owner');
  await ownerPage.goto(`${baseURL}/#/admin`, {waitUntil:'networkidle'});
  await ownerPage.getByRole('heading', {name:'Your media stack, at a glance.'}).waitFor();
  await ownerPage.locator('.admin-panel').first().waitFor();
  assert.equal(await ownerPage.locator('.admin-metrics article').count(), 4);
  await ownerPage.screenshot({path:path.join(outputDir, 'admin-overview.png'), fullPage:false});
  await ownerContext.close();

  const mobileContext = await browser.newContext({viewport:{width:390,height:844}, deviceScaleFactor:1});
  const mobilePage = await mobileContext.newPage();
  mobilePage.on('pageerror', error => browserErrors.push(error.message));
  await installFixtureRoutes(mobilePage, 'user');
  await mobilePage.goto(`${baseURL}/#/home`, {waitUntil:'networkidle'});
  await mobilePage.locator('#inspired .poster').first().waitFor();
  assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  await mobilePage.screenshot({path:path.join(outputDir, 'home-mobile.png'), fullPage:false});
  await mobileContext.close();
  assert.deepEqual(browserErrors, []);
} finally {
  await browser.close();
  child.kill();
  fs.rmSync(fixtureRoot, {recursive:true, force:true});
}

console.log('Sanitized release screenshots captured from deterministic fixture data.');
