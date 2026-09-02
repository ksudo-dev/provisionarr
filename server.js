const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const net = require('net');
const arrOrchestrator = require('./lib/arr-orchestrator');
const arrBootstrapOrchestrator = require('./lib/arr-bootstrap-orchestrator');
const prowlarrOrchestrator = require('./lib/prowlarr-orchestrator');
const {prowlarrCompatibility,qBittorrentCompatibility} = require('./lib/arr-compatibility');
const {normalizeOrchestrationUrl,normalizeOrchestrationKey,normalizeQbittorrentUsername,normalizeQbittorrentPassword,orchestrationTarget} = require('./lib/arr-connections');
const {stackBundle} = require('./lib/stack-bundle');

const ROOT = __dirname;
const PUBLIC_ROOT = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const env = (name, legacy, fallback='') => process.env[name] ?? process.env[legacy] ?? fallback;
function isLoopbackHost(host='') { const value=String(host).trim().toLowerCase().replace(/^\[|\]$/g,'');return value==='localhost'||value==='::1'||(net.isIP(value)===4&&value.split('.')[0]==='127'); }
function isTrustedPrivateHost(host='') { const value=String(host).trim().toLowerCase().replace(/^\[|\]$/g,'');if(isLoopbackHost(value))return true;const family=net.isIP(value);if(family===4){const parts=value.split('.').map(Number),[first,second]=parts;return first===10||(first===172&&second>=16&&second<=31)||(first===192&&second===168)||(first===100&&second>=64&&second<=127);}if(family===6)return value.startsWith('fc')||value.startsWith('fd');return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(value)||value.endsWith('.local')||value.endsWith('.home.arpa'); }
const LISTEN_HOST = env('PROVISIONARR_LISTEN_HOST', 'ARR_HOME_LISTEN_HOST', '127.0.0.1');
const HOST = env('PROVISIONARR_HOST', 'ARR_HOME_HOST', '127.0.0.1');
const CONFIG_ROOT = env('PROVISIONARR_CONFIG_ROOT', 'ARR_HOME_CONFIG_ROOT', '/data');
const MEDIA_ROOT = env('PROVISIONARR_MEDIA_ROOT', 'ARR_HOME_MEDIA_ROOT', '/media');
const MIN_FREE_GB = Number(env('PROVISIONARR_MIN_FREE_GB', 'ARR_HOME_MIN_FREE_GB', '50'));
const MIN_FREE_PERCENT = Number(env('PROVISIONARR_MIN_FREE_PERCENT', 'ARR_HOME_MIN_FREE_PERCENT', '15'));
const ACCESS_CODE = env('PROVISIONARR_ACCESS_CODE', 'ARR_HOME_ACCESS_CODE');
const requestLog = env('PROVISIONARR_REQUEST_LOG', 'ARR_HOME_REQUEST_LOG', path.join(CONFIG_ROOT, 'arr-home', 'requests.json'));
const QBIT_URL = env('PROVISIONARR_QBIT_URL', 'ARR_HOME_QBIT_URL', 'http://127.0.0.1:8080');
const QBIT_USERNAME = env('PROVISIONARR_QBIT_USERNAME', 'ARR_HOME_QBIT_USERNAME');
const QBIT_PASSWORD = env('PROVISIONARR_QBIT_PASSWORD', 'ARR_HOME_QBIT_PASSWORD');
const EMBY_URL = env('PROVISIONARR_EMBY_URL', 'ARR_HOME_EMBY_URL');
const EMBY_API_KEY = env('PROVISIONARR_EMBY_API_KEY', 'ARR_HOME_EMBY_API_KEY');
const TRUST_PROXY = env('PROVISIONARR_TRUST_PROXY', 'ARR_HOME_TRUST_PROXY') === 'true';
const secureCookieSetting = env('PROVISIONARR_SECURE_COOKIES', 'ARR_HOME_SECURE_COOKIES');
const SECURE_COOKIES = secureCookieSetting ? secureCookieSetting === 'true' : !isLoopbackHost(LISTEN_HOST);
const ALLOW_INSECURE_UPSTREAMS = env('PROVISIONARR_ALLOW_INSECURE_UPSTREAMS', 'ARR_HOME_ALLOW_INSECURE_UPSTREAMS') === 'true';
const REQUEST_TIMEOUT_MS = Math.max(5000, Math.min(120000, Number(env('PROVISIONARR_REQUEST_TIMEOUT_MS', 'ARR_HOME_REQUEST_TIMEOUT_MS', '15000')) || 15000));
const configuredUpstreamLimit = Number(env('PROVISIONARR_MAX_UPSTREAM_BYTES', 'ARR_HOME_MAX_UPSTREAM_BYTES', String(10 * 1024 * 1024)));
const MAX_UPSTREAM_BYTES = Number.isFinite(configuredUpstreamLimit) ? Math.max(1048576, configuredUpstreamLimit) : 10 * 1024 * 1024;
const DATA_ROOT = path.dirname(requestLog);
const ADMIN_FILE = env('PROVISIONARR_ADMIN_FILE', 'ARR_HOME_ADMIN_FILE', path.join(DATA_ROOT, 'admin.json'));
const USERS_FILE = env('PROVISIONARR_USERS_FILE', 'ARR_HOME_USERS_FILE', path.join(DATA_ROOT, 'users.json'));
const SETTINGS_FILE = env('PROVISIONARR_SETTINGS_FILE', 'ARR_HOME_SETTINGS_FILE', path.join(DATA_ROOT, 'settings.json'));
const SETUP_TOKEN_FILE = env('PROVISIONARR_SETUP_TOKEN_FILE', 'ARR_HOME_SETUP_TOKEN_FILE', path.join(DATA_ROOT, 'setup-token.txt'));
const AUDIT_FILE = env('PROVISIONARR_AUDIT_FILE', 'ARR_HOME_AUDIT_FILE', path.join(DATA_ROOT, 'audit.jsonl'));
const NOTIFICATION_STATE_FILE = env('PROVISIONARR_NOTIFICATION_STATE_FILE', 'ARR_HOME_NOTIFICATION_STATE_FILE', path.join(DATA_ROOT, 'notification-state.json'));
const SESSION_FILE = env('PROVISIONARR_SESSION_FILE', 'ARR_HOME_SESSION_FILE', path.join(DATA_ROOT, 'sessions.json'));
const ORCHESTRATION_WRITES_ENABLED = env('PROVISIONARR_ORCHESTRATION_WRITES_ENABLED', 'ARR_HOME_ORCHESTRATION_WRITES_ENABLED', 'false') === 'true';
const ORCHESTRATION_BACKUP_ROOT = env('PROVISIONARR_ORCHESTRATION_BACKUP_ROOT', 'ARR_HOME_ORCHESTRATION_BACKUP_ROOT', path.join(DATA_ROOT, 'orchestration-backups'));
const ORCHESTRATION_CONNECTIONS_FILE = env('PROVISIONARR_ORCHESTRATION_CONNECTIONS_FILE', 'ARR_HOME_ORCHESTRATION_CONNECTIONS_FILE', path.join(DATA_ROOT, 'orchestration-connections.json'));
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const APP_STARTED_AT = new Date().toISOString();
let qbitCookie = '';
let qbitLoginPromise = null;
const sessions = loadSessions();
const pendingActions = new Map();
const mediaRefs = new Map();
const rateLimits = new Map();
const responseCache = new Map();
const requestAdmissionLocks = new Map();
const orchestrationPlans = new Map();
const bootstrapPlans = new Map();
const prowlarrPlans = new Map();
let orchestrationApplyLocked = false;
const MAP_LIMITS = {sessions:5000, pendingActions:2000, mediaRefs:10000, rateLimits:10000, orchestrationPlans:200, bootstrapPlans:100, prowlarrPlans:100};

const defaultSettings = {
  appName: 'Provisionarr', minFreeGb: MIN_FREE_GB, minFreePercent: MIN_FREE_PERCENT,
  setupMode: '',
  movieQualityProfileId: null, tvQualityProfileId: null, autoSearch: true, allowUserRefetch: false,
  userAutoApprove: true, userActiveRequestLimit: 3, pauseRequestsWhenStorageLow: true,
  discoveryLimit: 12, notificationsEnabled: true, notifyAvailable: true, notifyFailed: true, notifyDiskLow: true,
  smtpHost: '', smtpPort: 587, smtpSecure: false, smtpUser: '', smtpPass: '', smtpFrom: ''
};
function loadJson(file, fallback) { try { return {...fallback,...JSON.parse(fs.readFileSync(file,'utf8'))}; } catch { return {...fallback}; } }
let runtimeSettings = loadJson(SETTINGS_FILE, defaultSettings);
if (['ARR Home','ARRstack'].includes(runtimeSettings.appName)) runtimeSettings.appName = 'Provisionarr';
function atomicWriteText(file,text,mode=0o600) { fs.mkdirSync(path.dirname(file),{recursive:true});const temp=`${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;fs.writeFileSync(temp,text,{mode});fs.renameSync(temp,file);try{fs.chmodSync(file,mode)}catch{} }
function atomicWriteJson(file,value) { atomicWriteText(file,JSON.stringify(value,null,2)); }
function saveSettings(next) { runtimeSettings={...defaultSettings,...next}; atomicWriteJson(SETTINGS_FILE,runtimeSettings); return runtimeSettings; }
saveSettings(runtimeSettings);
function publicSettings() { const {smtpPass,...safe}=runtimeSettings; return {...safe,smtpPasswordSet:Boolean(smtpPass)}; }
function setupToken() { fs.mkdirSync(DATA_ROOT,{recursive:true}); try { return fs.readFileSync(SETUP_TOKEN_FILE,'utf8').trim(); } catch { const token=crypto.randomBytes(18).toString('base64url'); fs.writeFileSync(SETUP_TOKEN_FILE,token+'\n',{mode:0o600}); console.log(`Provisionarr owner setup token created at ${SETUP_TOKEN_FILE}`); return token; } }
function ownerConfiguredOnDisk() { try { return JSON.parse(fs.readFileSync(USERS_FILE,'utf8')).some(x=>x.role==='owner'); } catch { return false; } }
const OWNER_SETUP_TOKEN = ownerConfiguredOnDisk() ? '' : setupToken();

const services = {
  sonarr: {id: 'sonarr', label: 'TV', port: 8989, type: 'series', search: '/api/v3/series/lookup', library: '/api/v3/series'},
  radarr: {id: 'radarr', label: 'Movies', port: 7878, type: 'movie', search: '/api/v3/movie/lookup', library: '/api/v3/movie'},
  prowlarr: {id: 'prowlarr', label: 'Prowlarr', port: 9696, type: 'indexer', system: '/api/v1/system/status', health: '/api/v1/health', indexers: '/api/v1/indexer'}
};

const ORCHESTRATION_SERVICE_IDS = Object.freeze(['sonarr', 'radarr']);
const API_KEY_CONNECTION_IDS = Object.freeze(['sonarr', 'radarr', 'prowlarr']);

function loadOrchestrationConnections() {
  try {
    const parsed=JSON.parse(fs.readFileSync(ORCHESTRATION_CONNECTIONS_FILE,'utf8'));
    if(parsed?.version!==1||!parsed.services||typeof parsed.services!=='object')return {version:1,services:{}};
    const saved={};
    for(const id of API_KEY_CONNECTION_IDS){const item=parsed.services[id];if(!item)continue;try{saved[id]={url:normalizeOrchestrationUrl(item.url),apiKey:normalizeOrchestrationKey(item.apiKey)};}catch{}}
    const qbit=parsed.services.qbittorrent;
    if(qbit)try{saved.qbittorrent={url:normalizeOrchestrationUrl(qbit.url),username:normalizeQbittorrentUsername(qbit.username),password:normalizeQbittorrentPassword(qbit.password)};}catch{}
    return {version:1,services:saved};
  } catch { return {version:1,services:{}}; }
}

let orchestrationConnectionState=loadOrchestrationConnections();

function keyFor(id) {
  try { const xml = fs.readFileSync(path.join(CONFIG_ROOT, id, 'config.xml'), 'utf8'); return (xml.match(/<ApiKey>([^<]+)<\/ApiKey>/i) || [])[1] || ''; }
  catch { return process.env[`${id.toUpperCase()}_API_KEY`] || ''; }
}
for (const service of Object.values(services)) {
  service.url=normalizeOrchestrationUrl(process.env[`${service.id.toUpperCase()}_URL`]||`http://${HOST}:${service.port}`);
  service.key=keyFor(service.id);
  const saved=orchestrationConnectionState.services[service.id];
  if(saved){service.url=saved.url;service.key=saved.apiKey;}
}
let qbitConnection={url:normalizeOrchestrationUrl(QBIT_URL),username:QBIT_USERNAME,password:QBIT_PASSWORD};
if(orchestrationConnectionState.services.qbittorrent)qbitConnection={...orchestrationConnectionState.services.qbittorrent};

function publicOrchestrationConnection(service) {
  const saved=Boolean(orchestrationConnectionState.services[service.id]);
  return {id:service.id,label:orchestrationLabel(service),url:normalizeOrchestrationUrl(service.url),apiKeySet:Boolean(service.key),source:saved?'saved':service.key?'server':'missing'};
}

function publicQbittorrentConnection() {
  const saved=Boolean(orchestrationConnectionState.services.qbittorrent);
  return {id:'qbittorrent',label:'qBittorrent',url:normalizeOrchestrationUrl(qbitConnection.url),usernameSet:Boolean(qbitConnection.username),passwordSet:Boolean(qbitConnection.password),source:saved?'saved':qbitConnection.username||qbitConnection.password?'server':'missing'};
}

function publicOrchestrationConnections() { return [...API_KEY_CONNECTION_IDS.map(id=>publicOrchestrationConnection(services[id])),publicQbittorrentConnection()]; }

function saveOrchestrationConnection(service,candidate) {
  orchestrationConnectionState={version:1,services:{...orchestrationConnectionState.services,[service.id]:{url:candidate.url,apiKey:candidate.key}}};
  atomicWriteJson(ORCHESTRATION_CONNECTIONS_FILE,orchestrationConnectionState);
  service.url=candidate.url;
  service.key=candidate.key;
  responseCache.clear();
  orchestrationPlans.clear();
  bootstrapPlans.clear();
  prowlarrPlans.clear();
}

function saveQbittorrentConnection(candidate) {
  orchestrationConnectionState={version:1,services:{...orchestrationConnectionState.services,qbittorrent:{url:candidate.url,username:candidate.username,password:candidate.password}}};
  atomicWriteJson(ORCHESTRATION_CONNECTIONS_FILE,orchestrationConnectionState);
  qbitConnection={...candidate};
  qbitCookie='';
  responseCache.clear();
  bootstrapPlans.clear();
}

const securityHeaders={'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','permissions-policy':'camera=(), microphone=(), geolocation=()','cross-origin-opener-policy':'same-origin',...(SECURE_COOKIES?{'strict-transport-security':'max-age=31536000; includeSubDomains'}:{})};
const USER_ATTENTION_MESSAGE='Something needs attention. Please contact your system administrator.';
function json(res, status, body, extra={}) { res.writeHead(status, {...securityHeaders,'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extra}); res.end(JSON.stringify(body)); }
function readBody(req,maxBytes=65536) { return new Promise((resolve, reject) => { let body='',bytes=0,settled=false;const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value)};const timer=setTimeout(()=>{const error=new Error('Request body timed out');error.code='BODY_TIMEOUT';error.closeConnection=true;req.pause();finish(error);},REQUEST_TIMEOUT_MS);req.on('data', c => { if(settled)return; bytes+=c.length; if(bytes>maxBytes){const error=new Error('Request body is too large');error.code='BODY_TOO_LARGE';error.closeConnection=true;req.pause();finish(error);return;} body += c; }); req.on('end', () => { if(settled)return; try { finish(null,body ? JSON.parse(body) : {}); } catch { finish(new Error('Invalid JSON')); } }); req.on('error', error=>finish(error)); }); }
function cookieMap(req) { const result={};for(const entry of (req.headers.cookie||'').split(';').map(x=>x.trim()).filter(Boolean)){const i=entry.indexOf('=');if(i<=0)continue;try{result[decodeURIComponent(entry.slice(0,i))]=decodeURIComponent(entry.slice(i+1));}catch{}}return result; }
function adminRecord() { try { return JSON.parse(fs.readFileSync(ADMIN_FILE,'utf8')); } catch { return null; } }
function loadUsers() { try { return JSON.parse(fs.readFileSync(USERS_FILE,'utf8')); } catch { return []; } }
function saveUsers(users) { atomicWriteJson(USERS_FILE,users); }
function safeUser(user) { return user?{id:user.id,username:user.username,displayName:user.displayName,email:user.email||'',avatar:user.avatar||'',role:user.role,preferences:user.preferences||{}}:null; }
function sanitizeAvatar(value,current='') {
  if(value===undefined)return current;
  if(value==='')return '';
  const match=String(value).match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match)throw new Error('Profile picture must be a JPEG, PNG, or WebP image.');
  const data=Buffer.from(match[2],'base64');
  if(!data.length||data.length>256*1024)throw new Error('Profile picture is too large.');
  const png=data.length>=8&&data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  const jpeg=data.length>=3&&data[0]===0xff&&data[1]===0xd8&&data[2]===0xff;
  const webp=data.length>=12&&data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP';
  if(!png&&!jpeg&&!webp)throw new Error('Profile picture content is not a valid supported image.');
  return `data:image/${match[1]};base64,${match[2]}`;
}
function passwordHash(password,salt=crypto.randomBytes(16).toString('hex')) { return {salt,hash:crypto.scryptSync(password,salt,64).toString('hex')}; }
function passwordValid(password,record) { try { const actual=Buffer.from(passwordHash(password,record.salt).hash,'hex'),expected=Buffer.from(record.hash,'hex'); return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected); } catch { return false; } }
function trimMap(map,limit) { while(map.size>=limit) map.delete(map.keys().next().value); }
function setBounded(map,key,value,limit) { if(!map.has(key)) trimMap(map,limit); map.set(key,value); }
async function cachedAsync(key,ttlMs,factory) { const now=Date.now(),cached=responseCache.get(key);if(cached?.value&&cached.expires>now)return cached.value;if(cached?.promise)return cached.promise;const promise=Promise.resolve().then(factory).then(value=>{responseCache.set(key,{value,expires:Date.now()+ttlMs});return value},error=>{responseCache.delete(key);throw error});responseCache.set(key,{promise,expires:now+ttlMs});return promise; }
function sessionCookie(value,maxAge) { return `arr_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${SECURE_COOKIES?'; Secure':''}`; }
function sessionKey(token='') { return token ? crypto.createHash('sha256').update(token).digest('hex') : ''; }
function loadSessions() { try { const now=Date.now(),entries=JSON.parse(fs.readFileSync(SESSION_FILE,'utf8')); return new Map(entries.filter(([key,value])=>/^[a-f0-9]{64}$/.test(key)&&value?.expires>now&&value?.userId)); } catch { return new Map(); } }
function saveSessions() { try { fs.mkdirSync(DATA_ROOT,{recursive:true});const temp=`${SESSION_FILE}.tmp`;fs.writeFileSync(temp,JSON.stringify([...sessions]),{mode:0o600});fs.renameSync(temp,SESSION_FILE);try{fs.chmodSync(SESSION_FILE,0o600)}catch{} } catch(error) { console.error(`Session persistence failed: ${error.message}`); } }
function newSession(res,user) { const token=crypto.randomBytes(32).toString('base64url'),csrf=crypto.randomBytes(24).toString('base64url'); setBounded(sessions,sessionKey(token),{csrf,userId:user?.id||'owner',role:user?.role||'owner',expires:Date.now()+SESSION_TTL_MS},MAP_LIMITS.sessions); saveSessions(); return {token,csrf,cookie:sessionCookie(token,Math.floor(SESSION_TTL_MS/1000))}; }
function sessionFor(req) { const token=cookieMap(req).arr_session,key=sessionKey(token),s=key&&sessions.get(key); if(!s||s.expires<Date.now()){if(key&&sessions.delete(key))saveSessions();return null} const user=loadUsers().find(x=>x.id===s.userId); return user?{...s,token,key,user}:null; }
function requireUser(req,res,csrf=false) { const s=sessionFor(req); if(!s){json(res,401,{error:'Sign in required',code:'LOGIN_REQUIRED'});return null} if(csrf&&req.headers['x-csrf-token']!==s.csrf){json(res,403,{error:'Security token expired. Refresh and try again.',code:'CSRF_INVALID'});return null} return s; }
function requireAdmin(req,res,csrf=false) { const s=requireUser(req,res,csrf); if(!s)return null; if(s.role!=='owner'){json(res,403,{error:'Owner access required',code:'OWNER_REQUIRED'});return null} return s; }
function clientIp(req) { const source=TRUST_PROXY?req.headers['x-forwarded-for']:req.socket.remoteAddress; return String(source||'unknown').split(',')[0].trim(); }
function rateSubject(req) { const key=sessionKey(cookieMap(req).arr_session); return key&&sessions.has(key)?`session:${key}`:`ip:${clientIp(req)}`; }
function limitedKey(key,limit,windowMs=60000) { const now=Date.now(),hits=(rateLimits.get(key)||[]).filter(x=>x>now-windowMs); hits.push(now); setBounded(rateLimits,key,hits,MAP_LIMITS.rateLimits); return hits.length>limit; }
function limited(req,bucket,limit,windowMs=60000) { return limitedKey(`${rateSubject(req)}:${bucket}`,limit,windowMs); }
function cleanupTransientState() { const now=Date.now();let sessionsChanged=false;for(const [key,value] of sessions)if(value.expires<now){sessions.delete(key);sessionsChanged=true}if(sessionsChanged)saveSessions();for(const [key,value] of pendingActions)if(value.expires<now||value.used)pendingActions.delete(key);for(const [key,value] of mediaRefs)if(value.expires<now)mediaRefs.delete(key);for(const [key,value] of orchestrationPlans)if(value.expires<now||value.used)orchestrationPlans.delete(key);for(const [key,value] of bootstrapPlans)if(value.expires<now||value.used)bootstrapPlans.delete(key);for(const [key,value] of prowlarrPlans)if(value.expires<now||value.used)prowlarrPlans.delete(key);for(const [key,hits] of rateLimits){const fresh=hits.filter(x=>x>now-15*60*1000);if(fresh.length)rateLimits.set(key,fresh);else rateLimits.delete(key);} }
function audit(req,action,detail={}) { try { fs.mkdirSync(DATA_ROOT,{recursive:true});if(fs.existsSync(AUDIT_FILE)&&fs.statSync(AUDIT_FILE).size>5*1024*1024){try{fs.unlinkSync(`${AUDIT_FILE}.1`)}catch{}fs.renameSync(AUDIT_FILE,`${AUDIT_FILE}.1`);}const actorId=detail.actorId||sessionFor(req)?.user?.id||detail.userId||null;fs.appendFileSync(AUDIT_FILE,JSON.stringify({at:new Date().toISOString(),ip:clientIp(req),action,actorId,...detail})+'\n',{mode:0o600});return true; } catch(error) { console.error(`Audit persistence failed: ${error.message}`);return false; } }
async function sendEmail(recipients,subject,text) { if(!runtimeSettings.notificationsEnabled||!runtimeSettings.smtpHost||!runtimeSettings.smtpFrom||!recipients.length)return {sent:false,reason:'SMTP is not configured.'}; let nodemailer;try{nodemailer=require('nodemailer')}catch{return {sent:false,reason:'Email transport is not installed.'}} const transport=nodemailer.createTransport({host:runtimeSettings.smtpHost,port:Number(runtimeSettings.smtpPort)||587,secure:Boolean(runtimeSettings.smtpSecure),auth:runtimeSettings.smtpUser?{user:runtimeSettings.smtpUser,pass:runtimeSettings.smtpPass}:undefined});await transport.sendMail({from:runtimeSettings.smtpFrom,to:recipients.join(','),subject,text});return {sent:true}; }
function notificationFor(userId,type,title,message,href) { return {id:crypto.randomUUID(),userId,type,title,message,href,createdAt:new Date().toISOString(),read:false}; }
function publicNotification(item) { return {id:item.id,type:item.type,title:item.title,message:item.message,href:item.href||'#/requests',createdAt:item.createdAt,read:Boolean(item.read)}; }
function notificationInbox(userId,limit=100) { const state=loadJson(NOTIFICATION_STATE_FILE,{items:{},diskLow:false,notifications:[]});return (state.notifications||[]).filter(x=>x.userId===userId).slice(0,Math.max(1,Math.min(200,Number(limit)||100))).map(publicNotification); }
function saveNotificationState(state) { atomicWriteJson(NOTIFICATION_STATE_FILE,{items:state.items||{},diskLow:Boolean(state.diskLow),notifications:(state.notifications||[]).slice(0,500)}); }
async function checkNotifications() { const users=loadUsers(),state=loadJson(NOTIFICATION_STATE_FILE,{items:{},diskLow:false,notifications:[]}),next={items:{...(state.items||{})},diskLow:Boolean(state.diskLow),notifications:Array.isArray(state.notifications)?state.notifications:[]};try{const requests=await requestHistory();for(const item of requests){const status=item.displayStatus||item.status,key=`${item.service}:${item.arrId||item.title}:${item.requestedBy||'owner'}`;if(next.items[key]===status)continue;next.items[key]=status;if(!['available','failed'].includes(status))continue;const user=users.find(x=>x.id===item.requestedBy),owners=users.filter(x=>x.role==='owner'),recipients=[...(user?[user]:[]),...(status==='failed'?owners:[])].filter((x,i,a)=>x&&a.findIndex(y=>y.id===x.id)===i);const message=status==='available'?`${item.title} is now available in your media library.`:`${item.title} needs attention. Please contact your system administrator.`;for(const recipient of recipients)next.notifications.unshift(notificationFor(recipient.id,status,item.title,message,'#/requests'));const emailTargets=(user&&user.email&&(user.preferences?.notifications!==false))?[user.email]:owners.filter(x=>x.email).map(x=>x.email);if(status==='available'&&runtimeSettings.notifyAvailable)await sendEmail(emailTargets,`${item.title} is ready`,`${item.title} is now available in your media library.`);if(status==='failed'&&runtimeSettings.notifyFailed)await sendEmail(emailTargets,`${item.title} needs attention`,`${item.title} failed to download or import. Open Provisionarr to review it.`);}const disk=diskStatus();if(disk.low&&!next.diskLow){const message=disk.error||`The media disk has ${disk.freeGb} GB (${disk.freePercent}%) free.`;for(const owner of users.filter(x=>x.role==='owner'))next.notifications.unshift(notificationFor(owner.id,'storage',`${runtimeSettings.appName}: storage is low`,message,'#/status'));if(runtimeSettings.notifyDiskLow)await sendEmail(users.filter(x=>x.role==='owner'&&x.email).map(x=>x.email),`${runtimeSettings.appName}: storage is low`,message);}next.diskLow=Boolean(disk.low);saveNotificationState(next);}catch(error){console.error(`Notification check failed: ${error.message}`);} }
function collectUpstream(r,label) { return new Promise((resolve,reject)=>{let data='',bytes=0,done=false;const fail=error=>{if(done)return;done=true;reject(error)};r.setEncoding('utf8');r.on('data',chunk=>{if(done)return;bytes+=Buffer.byteLength(chunk);if(bytes>MAX_UPSTREAM_BYTES){const error=new Error(`${label} response exceeded the configured limit.`);r.destroy(error);return fail(error);}data+=chunk;});r.on('end',()=>{if(done)return;done=true;resolve(data)});r.on('error',fail);}); }
function collectUpstreamBuffer(r,label,maxBytes=5*1024*1024) { return new Promise((resolve,reject)=>{const chunks=[];let bytes=0,done=false;const fail=error=>{if(done)return;done=true;reject(error)};r.on('data',chunk=>{if(done)return;bytes+=chunk.length;if(bytes>maxBytes){const error=new Error(`${label} response exceeded the configured limit.`);r.destroy(error);return fail(error);}chunks.push(chunk);});r.on('end',()=>{if(done)return;done=true;resolve(Buffer.concat(chunks))});r.on('error',fail);}); }
function upstreamTransport(target,label) { if(target.protocol==='https:')return https;if(target.protocol==='http:'&&(ALLOW_INSECURE_UPSTREAMS||isTrustedPrivateHost(target.hostname)))return http;if(target.protocol==='http:')throw new Error(`${label} uses plaintext HTTP on a public address. Use HTTPS for public upstreams.`);throw new Error(`${label} URL must use HTTP or HTTPS.`); }
function api(service, endpoint, method='GET', body) {
  return new Promise((resolve, reject) => {
    const target = orchestrationTarget(service.url, endpoint);
    const req = upstreamTransport(target,service.label).request(target, {method, timeout: 7000, headers: {'X-Api-Key': service.key, 'content-type': 'application/json'}}, r => {
      collectUpstream(r,service.label).then(data=>{let parsed={};try{parsed=data?JSON.parse(data):{}}catch{}resolve({status:r.statusCode||0,data:parsed});},reject);
    });
    req.on('timeout', () => req.destroy(new Error('Timed out'))); req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}
function embyApi(endpoint) {
  return new Promise((resolve,reject)=>{if(!EMBY_URL||!EMBY_API_KEY)return resolve({status:0,data:{}});const target=new url.URL(endpoint,EMBY_URL);const req=upstreamTransport(target,'Emby').request(target,{method:'GET',timeout:7000,headers:{'X-Emby-Token':EMBY_API_KEY,'accept':'application/json'}},r=>{collectUpstream(r,'Emby').then(data=>{let parsed={};try{parsed=data?JSON.parse(data):{}}catch{}resolve({status:r.statusCode||0,data:parsed});},reject);});req.on('timeout',()=>req.destroy(new Error('Emby timed out')));req.on('error',reject);req.end();});
}
async function embyUsers() { if(!EMBY_URL||!EMBY_API_KEY)return [];const response=await embyApi('/Users');if(response.status<200||response.status>=300)return [];return (Array.isArray(response.data)?response.data:[]).filter(user=>!user.Policy?.IsDisabled).map(user=>({id:String(user.Id),name:String(user.Name||'Emby user').slice(0,80)})); }
function mapEmbyItem(item) { const isSeries=item.Type==='Series';return {id:item.Id,kind:isSeries?'series':'movie',service:isSeries?'TV':'Movies',serviceId:isSeries?'sonarr':'radarr',title:item.Name||'Untitled',year:item.ProductionYear||null,overview:item.Overview||'',poster:item.ImageTags?.Primary?`/api/images/emby/${encodeURIComponent(item.Id)}`:null,tmdbId:item.ProviderIds?.Tmdb||null,tvdbId:item.ProviderIds?.Tvdb||null,dateCreated:item.DateCreated||null,seasons:[]}; }
async function collectEmbyLibrary() { if(!EMBY_URL||!EMBY_API_KEY)return {connected:false,items:[],message:'Emby is not configured.'};const endpoint='/Items?Recursive=true&IncludeItemTypes=Movie,Series&Fields=Overview,ProviderIds,DateCreated,ProductionYear&ImageTypeLimit=1&EnableImageTypes=Primary&SortBy=SortName&SortOrder=Ascending';const response=await embyApi(endpoint);if(response.status<200||response.status>=300)throw new Error('Emby library is unavailable.');const rows=Array.isArray(response.data?.Items)?response.data.Items:[];return {connected:true,server:'Emby',items:rows.map(mapEmbyItem),total:rows.length}; }
async function embyLibrary(refresh=false) { if(refresh)responseCache.delete('emby-library');return cachedAsync('emby-library',30000,collectEmbyLibrary); }
async function embyInspiredRecommendations(limit=12,userId='') { if(!EMBY_URL||!EMBY_API_KEY)return [];const library=await embyLibrary();if(!library.items.length)return [];let seeds=[];if(userId){const history=await embyApi(`/Users/${encodeURIComponent(userId)}/Items?Recursive=true&IncludeItemTypes=Movie,Series&Filters=IsPlayed&SortBy=DatePlayed&SortOrder=Descending&Limit=8&Fields=ProviderIds,Overview,ProductionYear,DateCreated`).catch(()=>({status:0,data:{}}));if(history.status>=200&&history.status<300)seeds=(history.data?.Items||[]).map(mapEmbyItem);}if(!seeds.length)seeds=[...library.items].sort(()=>Math.random()-.5).slice(0,4);const responses=await Promise.all(seeds.slice(0,4).map(seed=>embyApi(`/Items/${encodeURIComponent(seed.id)}/Similar?${userId?`UserId=${encodeURIComponent(userId)}&`:''}Limit=10&Fields=ProviderIds,Overview,ProductionYear` ).catch(()=>({status:0,data:{}}))));const ownedIds=new Set(library.items.map(x=>x.id)),ownedProviders=new Set(library.items.flatMap(x=>[x.tmdbId&&`tmdb:${x.tmdbId}`,x.tvdbId&&`tvdb:${x.tvdbId}`]).filter(Boolean));const candidates=[];for(const response of responses)for(const raw of (response.data?.Items||[])){const item=mapEmbyItem(raw),provider=item.tmdbId?`tmdb:${item.tmdbId}`:item.tvdbId?`tvdb:${item.tvdbId}`:null;if(ownedIds.has(item.id)||(provider&&ownedProviders.has(provider)))continue;if(item.kind==='movie'&&!item.tmdbId)continue;if(item.kind==='series'&&!item.tvdbId)continue;candidates.push(item);}return Array.from(new Map(candidates.map(x=>[`${x.serviceId}:${x.tvdbId||x.tmdbId||x.id}`,x])).values()).slice(0,limit); }
function proxyEmbyImage(req,res,id) { if(!EMBY_URL||!EMBY_API_KEY)return json(res,404,{error:'Image unavailable'});const target=new url.URL(`/Items/${encodeURIComponent(id)}/Images/Primary?maxWidth=500&quality=88`,EMBY_URL);let transport;try{transport=upstreamTransport(target,'Emby')}catch{return json(res,502,{error:'Image unavailable'})}const upstream=transport.request(target,{method:'GET',timeout:7000,headers:{'X-Emby-Token':EMBY_API_KEY}},r=>{if((r.statusCode||0)<200||(r.statusCode||0)>=300){r.resume();return json(res,404,{error:'Image unavailable'});}const contentType=r.headers['content-type']||'image/jpeg';collectUpstreamBuffer(r,'Emby image').then(data=>{if(res.writableEnded)return;res.writeHead(200,{...securityHeaders,'content-type':contentType,'cache-control':'private, max-age=86400'});res.end(data);},()=>{if(!res.headersSent)json(res,404,{error:'Image unavailable'});});});upstream.on('timeout',()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)json(res,404,{error:'Image unavailable'});});upstream.end(); }
function qbitRequest(endpoint, method='GET', form='', connection=qbitConnection, cookie=qbitCookie) {
  return new Promise((resolve, reject) => {
    const target = new url.URL(endpoint, connection.url);
    const headers={'content-type':'application/x-www-form-urlencoded',referer:`${target.protocol}//${target.host}/`}; if(form)headers['content-length']=String(Buffer.byteLength(form));if(cookie) headers.cookie=cookie;
    const req = upstreamTransport(target,'qBittorrent').request(target, {method, timeout: 7000, headers}, r => {
      collectUpstream(r,'qBittorrent').then(data=>{let parsed=data;try{parsed=data?JSON.parse(data):{}}catch{}const rawCookies=r.headers['set-cookie'],cookieRows=Array.isArray(rawCookies)?rawCookies:rawCookies?[rawCookies]:[];const responseCookie=(r.statusCode||0)>=200&&(r.statusCode||0)<300?cookieRows.map(x=>x.split(';')[0]).join('; '):'';resolve({status:r.statusCode||0,data:parsed,cookie:responseCookie});},reject);
    });
    req.on('timeout', () => req.destroy(new Error('qBittorrent timed out'))); req.on('error', reject); if(form) req.write(form); req.end();
  });
}
function qbitLoginAccepted(login) { return login.status>=200&&login.status<300&&Boolean(login.cookie)&&(login.status===204||/^ok\.?$/i.test(String(login.data||'').trim())); }
async function qbit(endpoint, method='GET', form='', retry=true) { const result=await qbitRequest(endpoint,method,form);if(result.cookie)qbitCookie=result.cookie;if(![401,403].includes(result.status)||!retry||!qbitConnection.username||!qbitConnection.password)return result;if(!qbitLoginPromise)qbitLoginPromise=qbitRequest('/api/v2/auth/login','POST',formEncode({username:qbitConnection.username,password:qbitConnection.password}),qbitConnection,'').finally(()=>{qbitLoginPromise=null});const login=await qbitLoginPromise;if(!qbitLoginAccepted(login))return result;qbitCookie=login.cookie;const retried=await qbitRequest(endpoint,method,form,qbitConnection,qbitCookie);if(retried.cookie)qbitCookie=retried.cookie;return retried; }

async function qbitCompatibilitySnapshot(connection) {
  let cookie='';
  let version=await qbitRequest('/api/v2/app/version','GET','',connection,cookie);
  if([401,403].includes(version.status)){
    const login=await qbitRequest('/api/v2/auth/login','POST',formEncode({username:connection.username,password:connection.password}),connection,'');
    if(!qbitLoginAccepted(login))return qBittorrentCompatibility({authenticated:false});
    cookie=login.cookie;
    version=await qbitRequest('/api/v2/app/version','GET','',connection,cookie);
  }
  if(version.status<200||version.status>=300)return qBittorrentCompatibility({authenticated:false});
  const [preferences,queue]=await Promise.all([
    qbitRequest('/api/v2/app/preferences','GET','',connection,cookie),
    qbitRequest('/api/v2/torrents/info?limit=200','GET','',connection,cookie)
  ]);
  return qBittorrentCompatibility({authenticated:true,version:String(version.data||''),preferences:preferences.status>=200&&preferences.status<300?preferences.data:null,queue:queue.status>=200&&queue.status<300&&Array.isArray(queue.data)?queue.data:null});
}
function qbitState(state) { if(['downloading','stalledDL','metaDL','checkingDL','allocating'].includes(state)) return 'downloading'; if(['uploading','stalledUP','forcedUP'].includes(state)) return 'seeding'; if(['pausedDL','pausedUP'].includes(state)) return 'paused'; if(['checkingUP','checkingResumeData'].includes(state)) return 'checking'; if(['error','missingFiles'].includes(state)) return 'failed'; return state || 'queued'; }
function formEncode(values) { return Object.entries(values).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&'); }
async function downloadSnapshot() {
  const [sonarrQueue, radarrQueue, torrents] = await Promise.all([
    api(services.sonarr, '/api/v3/queue?page=1&pageSize=100&includeUnknownSeriesItems=true'),
    api(services.radarr, '/api/v3/queue?page=1&pageSize=100&includeUnknownMovieItems=true'),
    qbit('/api/v2/torrents/info')
  ]);
  const torrentRows=(Array.isArray(torrents.data)?torrents.data:[]).filter(x=>['radarr','tv-sonarr'].includes(x.category));
  const arrRows=[...(sonarrQueue.data?.records||[]).map(x=>({...x,serviceId:'sonarr',service:'TV'})), ...(radarrQueue.data?.records||[]).map(x=>({...x,serviceId:'radarr',service:'Movies'}))];
  const used=new Set();
  const rows=arrRows.map(x=>{const hash=String(x.downloadId||'').toLowerCase(); const torrent=torrentRows.find(t=>String(t.hash||'').toLowerCase()===hash); if(torrent)used.add(torrent.hash); return {id:`${x.serviceId}-${x.id}`,arrId:x.id,episodeId:x.episodeId||null,movieId:x.movieId||null,serviceId:x.serviceId,service:x.service,title:x.title||x.series?.title||x.movie?.title||'Unknown download',downloadId:x.downloadId||null,hash:torrent?.hash||null,progress:torrent?Math.round(torrent.progress*100):Math.max(0,Math.min(99,Math.round((x.size&&x.sizeleft)?(1-x.sizeleft/x.size)*100:0))),state:torrent?qbitState(torrent.state):(x.status||'queued'),status:x.status||null,trackedStatus:x.trackedDownloadStatus||null,trackedState:x.trackedDownloadState||null,speed:torrent?.dlspeed||0,uploadSpeed:torrent?.upspeed||0,eta:torrent?.eta||0,size:torrent?.size||x.size||0,amountLeft:torrent?.amount_left||x.sizeleft||0,category:torrent?.category||'',error:x.errorMessage||x.statusMessages?.map(y=>y.title||y.message).join('; ')||'',importing:x.trackedDownloadState==='importing'||x.trackedDownloadState==='importPending',sourceTitle:x.sourceTitle||torrent?.name||''};});
  torrentRows.filter(t=>!used.has(t.hash)).forEach(t=>rows.push({id:`qbit-${t.hash}`,serviceId:'qbit',service:'qBittorrent',title:t.name,downloadId:t.hash,hash:t.hash,progress:Math.round(t.progress*100),state:qbitState(t.state),status:null,trackedStatus:null,trackedState:null,speed:t.dlspeed||0,uploadSpeed:t.upspeed||0,eta:t.eta||0,size:t.size||0,amountLeft:t.amount_left||0,category:t.category||'',error:t.state==='error'||t.state==='missingFiles'?'qBittorrent reports an error.':'',importing:false,sourceTitle:t.name}));
  for (const row of rows) {
    const evidence=`${row.sourceTitle||''} ${row.error||''}`;
    row.unsafeRejected=/\.(?:exe|scr|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|sh|bash|zsh|fish|py|pl|rb|jar|msi|apk|zip|rar|7z|tar|gz|bz2|xz)(?:\s|$|[.()[\]_-])/i.test(evidence)||/executable|script file|archive contains|blocked extension/i.test(evidence);
    row.canRejectThroughArr=row.serviceId==='sonarr'||row.serviceId==='radarr';
  }
  return {checkedAt:new Date().toISOString(),client:'qBittorrent',connected:torrents.status>=200&&torrents.status<300,rows};
}
function publicDownloads(snapshot) { return {...snapshot,rows:snapshot.rows.map(({hash,downloadId,sourceTitle,...safe})=>safe)}; }
async function activity() {
  const [s,r]=await Promise.all([api(services.sonarr,'/api/v3/history?page=1&pageSize=40&sortKey=date&sortDirection=descending'),api(services.radarr,'/api/v3/history?page=1&pageSize=40&sortKey=date&sortDirection=descending')]);
  const map=(rows,service)=>rows.map(x=>({id:`${service.id}-${x.id}`,service:service.label,title:x.sourceTitle||'Unknown release',date:x.date,event:x.eventType,status:x.eventType==='downloadFolderImported'?'available':x.eventType==='grabbed'?'downloading':x.eventType,quality:x.quality?.quality?.name||'',downloadClient:x.data?.downloadClientName||x.data?.downloadClient||'',error:x.data?.message||x.data?.errorMessage||''}));
  return {events:[...map(s.data?.records||[],services.sonarr),...map(r.data?.records||[],services.radarr)].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,80)};
}
function titleFrom(item) { return item.title || item.artistName || item.authorName || 'Untitled'; }
function imageFrom(item) { return item.remotePoster || item.images?.find(i => i.coverType === 'poster')?.remoteUrl || item.remoteCover || null; }
function mapMedia(item, service) { return {id: item.tvdbId || item.tmdbId || item.id, arrId: item.id, kind: service.type, service: service.label, serviceId: service.id, title: titleFrom(item), year: item.year || item.firstYear || null, overview: item.overview || 'Ready to request.', poster: imageFrom(item), tvdbId: item.tvdbId, tmdbId: item.tmdbId, seasons: item.seasons || []}; }

const TITLE_ALIASES = new Map([
  ['southpark', 'south park']
]);
const NUMBER_WORDS = new Map([
  ['zero', 0], ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5],
  ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10]
]);
const ORDINAL_WORDS = new Map([
  ['zeroth', 0], ['first', 1], ['second', 2], ['third', 3], ['fourth', 4],
  ['fifth', 5], ['sixth', 6], ['seventh', 7], ['eighth', 8], ['ninth', 9], ['tenth', 10]
]);

function normalizeTitle(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function titleKey(value) { return normalizeTitle(value).replace(/ /g, ''); }

function canonicalTitle(value) {
  const normalized = normalizeTitle(value);
  return TITLE_ALIASES.get(titleKey(normalized)) || normalized;
}
function editDistance(a,b) { const left=titleKey(a),right=titleKey(b);if(!left)return right.length;if(!right)return left.length;const row=Array.from({length:right.length+1},(_,i)=>i);for(let i=1;i<=left.length;i++){let diagonal=row[0];row[0]=i;for(let j=1;j<=right.length;j++){const previous=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,diagonal+(left[i-1]===right[j-1]?0:1));diagonal=previous;}}return row[right.length]; }

function parseSeasonNumber(value) {
  const text = normalizeTitle(value);
  const numeric = text.match(/(?:season|series|s)\s*0?(\d{1,2})\b/i);
  if (numeric) return Number(numeric[1]);
  const ordinal = text.match(/(?:season|series)\s+(zeroth|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/i);
  if (ordinal) return ORDINAL_WORDS.get(ordinal[1]);
  const before = text.match(/\b(zeroth|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+season\b/i);
  if (before) return ORDINAL_WORDS.get(before[1]);
  const word = text.match(/\bseason\s+(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  return word ? NUMBER_WORDS.get(word[1]) : null;
}

function parseMediaQuery(input) {
  const original = String(input || '').trim();
  let text = normalizeTitle(original);
  text = text.replace(/^(?:can you tell me if|can i|could i|would i|is it possible to|please tell me if)\b/, ' ');
  const seasonNumber = parseSeasonNumber(text);
  const seasonPattern = /\b(?:season|series)\s+(?:0?\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+of)?\b|\b(?:s\s*0?\d{1,2})\b|\b(?:the\s+)?(?:zeroth|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+season(?:\s+of)?\b/g;
  text = text.replace(seasonPattern, ' ');
  text = text.replace(/\b(?:the|a|an)\s+season\s+of\b/g, ' ');
  text = text.replace(/\b(?:can|could|would|should)\s+(?:i|we)\s+(?:download|get|fetch|watch)\b/g, ' ');
  text = text.replace(/\b(?:download|fetch|request|add|get|find|search|look\s+for|look)\b/g, ' ');
  text = text.replace(/\b(?:me|movie|film|show|series|tv|please|it|this|that)\b/g, ' ');
  text = text.replace(/\b(?:from|in)\s+(?:the\s+)?(?:discover|library|lists?)\b/g, ' ');
  text = text.replace(/\b(?:of|for|to|could|be|downloaded|available|tell|if)\b/g, ' ');
  const title = text.replace(/[^a-z0-9]+/gi, ' ').replace(/\s+/g, ' ').trim();
  const canonical = canonicalTitle(title);
  const mediaType = seasonNumber !== null || /\b(?:show|series|tv|episode|season)\b/i.test(original) ? 'series' :
    /\b(?:movie|film)\b/i.test(original) ? 'movie' : null;
  return {original, title, canonicalTitle: canonical, seasonNumber, isSeasonRequest: seasonNumber !== null, mediaType};
}

function mediaMatchScore(item, parsed) {
  const candidate = normalizeTitle(item.title);
  const candidateCanonical = canonicalTitle(candidate);
  const query = normalizeTitle(parsed.canonicalTitle || parsed.title);
  const queryKey = titleKey(query);
  const candidateKey = titleKey(candidateCanonical);
  if (!query) return 0;
  if (candidateCanonical === query) return 1000;
  if (candidateKey === queryKey) return 950;
  if (candidateCanonical.startsWith(query) || candidateKey.startsWith(queryKey)) return 700;
  if (candidateCanonical.includes(query) || candidateKey.includes(queryKey)) return 500;
  const words = query.split(' ').filter(Boolean);
  if(words.length && words.every(word => candidateCanonical.includes(word)))return 300;
  const distance=editDistance(candidateCanonical,query),allowed=Math.max(1,Math.floor(Math.max(candidateKey.length,queryKey.length)*0.2));
  return distance<=allowed?250-distance*20:0;
}

function rankMediaResults(items, parsed) {
  const best = new Map();
  for (const item of items) {
    const score = mediaMatchScore(item, parsed);
    if (!score) continue;
    const key = `${item.serviceId}:${item.tvdbId || item.tmdbId || item.arrId || titleKey(item.title)}`;
    const previous = best.get(key);
    if (!previous || score > previous.score) best.set(key, {item, score});
  }
  return [...best.values()].sort((a, b) => b.score - a.score || String(a.item.title).localeCompare(String(b.item.title))).map(x => x.item);
}

function seasonDetails(item, seasonNumber) {
  if (seasonNumber === null || seasonNumber === undefined || item.kind !== 'series') return item;
  const season = (item.seasons || []).find(x => Number(x.seasonNumber) === Number(seasonNumber));
  return {...item, seasonNumber: Number(seasonNumber), seasonTitle: `Season ${Number(seasonNumber)}`, missingEpisodeIds: (season?.statistics?.episodeFileCount || season?.statistics?.totalEpisodeCount) ? [] : undefined};
}

async function settings(service) {
  const [roots, profiles] = await Promise.all([api(service, '/api/v3/rootfolder'), api(service, '/api/v3/qualityprofile')]);
  const preferred=service.id==='sonarr'?runtimeSettings.tvQualityProfileId:runtimeSettings.movieQualityProfileId; const profile=(profiles.data||[]).find(x=>x.id===Number(preferred))||profiles.data?.[0];
  return {rootFolderPath: roots.data?.[0]?.path || '', qualityProfileId: profile?.id || 1, qualityProfileName: profile?.name || 'Default'};
}
async function integrationStatus() {
  const result = {checkedAt: new Date().toISOString(), services: [], indexers: [], alerts: [], qbittorrent:{connected:false}};
  for (const s of Object.values(services)) {
    if (s.id === 'prowlarr') continue;
    const entry = {id:s.id,label:s.label,ok:false,version:null,downloadClient:null,rootFolder:null,qualityProfile:null};
    try { const r=await api(s,'/api/v3/system/status'); entry.ok=r.status>=200&&r.status<300; entry.version=r.data?.version||null; } catch {}
    try { const r=await api(s,'/api/v3/downloadclient'); const clients=Array.isArray(r.data)?r.data:[]; entry.downloadClient=clients.find(x=>x.enable!==false)?.name||null; entry.downloadClientConfigured=clients.filter(x=>x.enable!==false).length>0; const t=await api(s,'/api/v3/downloadclient/testall','POST'); entry.downloadClientValid=Array.isArray(t.data)?t.data.every(x=>x.isValid):false; } catch { entry.downloadClientConfigured=false; entry.downloadClientValid=false; }
    try { const r=await api(s,'/api/v3/rootfolder'); entry.rootFolder=r.data?.[0]?.path||null; } catch {}
    try { const r=await api(s,'/api/v3/qualityprofile'); entry.qualityProfile=r.data?.[0]?.name||null; } catch {}
    result.services.push(entry);
  }
  const p=services.prowlarr; const prow={id:'prowlarr',label:'Prowlarr',ok:false,version:null};
  try { const r=await api(p,p.system); prow.ok=r.status>=200&&r.status<300; prow.version=r.data?.version||null; } catch {}
  try { const r=await api(p,p.indexers); result.indexers=(Array.isArray(r.data)?r.data:[]).map(x=>({id:x.id,name:x.name,enable:x.enable!==false,protocol:x.protocol||'torrent',implementation:x.implementation||''})); } catch {}
  result.services.push(prow);
  try { const q=await qbit('/api/v2/transfer/info'); result.qbittorrent={connected:q.status>=200&&q.status<300,connectionStatus:q.data?.connection_status||null,downloadSpeed:q.data?.dl_info_speed||0,uploadSpeed:q.data?.up_info_speed||0}; } catch {}
  return result;
}

function orchestrationLabel(service) { return ({sonarr:'Sonarr',radarr:'Radarr',prowlarr:'Prowlarr'})[service.id]||service.label||service.id; }
function orchestrationString(value, fallback = '', limit = 160) { return String(value ?? fallback).slice(0, limit); }
function orchestrationNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
async function orchestrationResource(service, endpoint, warnings, label) {
  try {
    const response = await api(service, endpoint);
    if (response.status < 200 || response.status >= 300) {
      warnings.push(`${label} could not be read.`);
      return null;
    }
    return response.data;
  } catch {
    warnings.push(`${label} could not be read.`);
    return null;
  }
}
async function orchestrationServiceInventory(service) {
  const warnings = [], label = orchestrationLabel(service);
  const [status, roots, profiles, clients, media, download] = await Promise.all([
    orchestrationResource(service, '/api/v3/system/status', warnings, `${label} status`),
    orchestrationResource(service, '/api/v3/rootfolder', warnings, `${label} root folders`),
    orchestrationResource(service, '/api/v3/qualityprofile', warnings, `${label} quality profiles`),
    orchestrationResource(service, '/api/v3/downloadclient', warnings, `${label} download clients`),
    orchestrationResource(service, arrOrchestrator.ENDPOINTS.mediaManagement, warnings, `${label} media handling settings`),
    orchestrationResource(service, arrOrchestrator.ENDPOINTS.downloadHandling, warnings, `${label} download handling settings`)
  ]);
  const current=media&&download?{
    mediaManagement:{
      renameFiles:service.id==='sonarr'?media.renameEpisodes===true:media.renameMovies===true,
      replaceIllegalCharacters:media.replaceIllegalCharacters===true,
      importExtraFiles:media.importExtraFiles===true
    },
    downloadHandling:{
      completedDownloadHandling:download.enableCompletedDownloadHandling===true,
      removeCompletedDownloads:download.removeCompletedDownloads===true
    }
  }:null;
  const inventory={
    id: service.id,
    label,
    connected: Boolean(status),
    version: status ? orchestrationString(status.version, '', 40) || null : null,
    rootFolders: (Array.isArray(roots) ? roots : []).map(root => ({
      id: orchestrationNumber(root.id),
      path: orchestrationString(root.path, '', 1024),
      freeSpace: orchestrationNumber(root.freeSpace),
      accessible: root.accessible !== false
    })),
    qualityProfiles: (Array.isArray(profiles) ? profiles : []).map(profile => ({
      id: orchestrationNumber(profile.id),
      name: orchestrationString(profile.name, 'Unnamed profile', 120),
      upgradeAllowed: profile.upgradeAllowed !== false,
      cutoff: orchestrationNumber(profile.cutoff)
    })),
    downloadClients: (Array.isArray(clients) ? clients : []).map(client => ({
      id: orchestrationNumber(client.id),
      name: orchestrationString(client.name, 'Unnamed client', 120),
      enabled: client.enable !== false,
      implementation: orchestrationString(client.implementation, '', 120),
      protocol: orchestrationString(client.protocol, '', 40),
      priority: orchestrationNumber(client.priority),
      removeCompletedDownloads: client.removeCompletedDownloads === true,
      removeFailedDownloads: client.removeFailedDownloads === true
    })),
    warnings,
    current
  };
  inventory.compatibility=orchestrationCompatibility(inventory);
  return inventory;
}

function orchestrationCompatibility(service) {
  const enabledClients=service.downloadClients.filter(client=>client.enabled);
  const checks=[
    {id:'connection',label:'Service connection',ok:service.connected,message:service.connected?`Connected to ${service.label} ${service.version||''}`.trim():'Provisionarr could not authenticate to this service.'},
    {id:'settings',label:'Supported settings API',ok:Boolean(service.current),message:service.current?'The allowlisted v3 settings endpoints are available.':'The allowlisted v3 settings endpoints could not be read.'},
    {id:'root-folder',label:'Library location',ok:service.rootFolders.some(root=>root.path&&root.accessible),message:service.rootFolders.some(root=>root.path&&root.accessible)?'An accessible root folder is configured.':'Add an accessible root folder in this service.'},
    {id:'quality-profile',label:'Quality profile',ok:service.qualityProfiles.length>0,message:service.qualityProfiles.length?'At least one quality profile is available.':'Add a quality profile in this service.'},
    {id:'download-client',label:'Download client',ok:enabledClients.length>0,message:enabledClients.length?`${enabledClients[0].name} is enabled.`:'Add and enable a download client.'}
  ];
  const ready=checks.every(check=>check.ok);
  return {ready,state:ready?'ready':service.connected?'needs_configuration':'unavailable',summary:ready?'Ready for guided management.':service.connected?'Connected, but setup needs attention.':'Connection required.',checks};
}

async function prowlarrServiceInventory(service=services.prowlarr) {
  const warnings=[],label='Prowlarr';
  const [status,healthRows,indexers,applications]=await Promise.all([
    orchestrationResource(service,service.system,warnings,`${label} status`),
    orchestrationResource(service,service.health,warnings,`${label} health`),
    orchestrationResource(service,service.indexers,warnings,`${label} indexers`),
    orchestrationResource(service,'/api/v1/applications',warnings,`${label} applications`)
  ]);
  const compatibility=prowlarrCompatibility({status:status?{authenticated:true}:null,health:healthRows,indexers,applications});
  return {id:'prowlarr',label,connected:Boolean(status),version:orchestrationString(status?.version,'',80)||null,warnings,compatibility};
}

async function prowlarrApplicationSnapshot() {
  const [applications,schemas]=await Promise.all([
    api(services.prowlarr,'/api/v1/applications'),
    api(services.prowlarr,'/api/v1/applications/schema')
  ]);
  if(applications.status<200||applications.status>=300||!Array.isArray(applications.data))throw Object.assign(new Error('Prowlarr application links could not be read.'),{statusCode:422,code:'PROWLARR_APPLICATIONS_UNAVAILABLE'});
  if(schemas.status<200||schemas.status>=300||!Array.isArray(schemas.data))throw Object.assign(new Error('Prowlarr application templates could not be read.'),{statusCode:422,code:'PROWLARR_SCHEMAS_UNAVAILABLE'});
  return {applications:applications.data,schemas:schemas.data};
}

function prowlarrLinkChoices(body) {
  if(!body||typeof body!=='object'||Array.isArray(body))throw Object.assign(new Error('Prowlarr link choices are invalid.'),{statusCode:400,code:'PROWLARR_LINKS_INVALID'});
  const source=body,allowed=new Set(['prowlarrUrl','sonarrUrl','radarrUrl','syncLevel']);
  if(Object.keys(source).some(key=>!allowed.has(key)))throw Object.assign(new Error('Prowlarr link choices contain an unsupported field.'),{statusCode:400,code:'PROWLARR_LINKS_INVALID'});
  return {
    prowlarrUrl:normalizeOrchestrationUrl(source.prowlarrUrl||services.prowlarr.url),
    sonarrUrl:normalizeOrchestrationUrl(source.sonarrUrl||services.sonarr.url),
    radarrUrl:normalizeOrchestrationUrl(source.radarrUrl||services.radarr.url),
    syncLevel:String(source.syncLevel||'fullSync')
  };
}

async function previewProwlarrLinks(body,session) {
  const snapshot=await prowlarrApplicationSnapshot(),desired=prowlarrLinkChoices(body);
  const plan=prowlarrOrchestrator.preview(desired,snapshot,{sonarr:services.sonarr.key,radarr:services.radarr.key}),planId=crypto.randomUUID(),expires=Date.now()+10*60*1000;
  setBounded(prowlarrPlans,planId,{plan,userId:session.user.id,createdAt:Date.now(),expires,used:false},MAP_LIMITS.prowlarrPlans);
  return {generatedAt:new Date().toISOString(),planId,expiresAt:new Date(expires).toISOString(),canApply:ORCHESTRATION_WRITES_ENABLED,plan:prowlarrOrchestrator.publicPlan(plan)};
}

async function qbittorrentServiceInventory(connection=qbitConnection) {
  try{
    const compatibility=await qbitCompatibilitySnapshot(connection);
    const connected=compatibility.checks.find(check=>check.id==='authenticated_version')?.state==='pass';
    return {id:'qbittorrent',label:'qBittorrent',connected,version:compatibility.version,warnings:connected?[]:['qBittorrent did not accept the connection.'],compatibility};
  }catch(error){console.error(`qBittorrent compatibility check failed: ${error.message}`);return {id:'qbittorrent',label:'qBittorrent',connected:false,version:null,warnings:['qBittorrent could not be reached.'],compatibility:qBittorrentCompatibility({authenticated:false})};}
}

async function orchestrationInventory() {
  const [raw,supportServices]=await Promise.all([
    Promise.all(ORCHESTRATION_SERVICE_IDS.map(id=>orchestrationServiceInventory(services[id]))),
    Promise.all([prowlarrServiceInventory(),qbittorrentServiceInventory()])
  ]);
  const current={};
  const servicesInventory=raw.map(({current:serviceCurrent,...service})=>{if(serviceCurrent)current[service.id]=serviceCurrent;return service;});
  return {checkedAt:new Date().toISOString(),connections:publicOrchestrationConnections(),services:servicesInventory,supportServices,current};
}

async function updateOrchestrationConnection(req, serviceId, body, session) {
  if(!API_KEY_CONNECTION_IDS.includes(serviceId))throw Object.assign(new Error('That service is not supported.'),{statusCode:404,code:'SERVICE_UNSUPPORTED'});
  if(!body||typeof body!=='object'||Array.isArray(body))throw Object.assign(new Error('Connection details are invalid.'),{statusCode:400,code:'CONNECTION_INVALID'});
  const allowed=new Set(['url','apiKey']);
  if(Object.keys(body).some(key=>!allowed.has(key)))throw Object.assign(new Error('Connection details contain an unsupported field.'),{statusCode:400,code:'CONNECTION_INVALID'});
  const service=services[serviceId],serviceUrl=normalizeOrchestrationUrl(body.url||service.url);
  const submittedKey=body.apiKey===undefined?'':String(body.apiKey).trim();
  const apiKey=submittedKey?normalizeOrchestrationKey(submittedKey):normalizeOrchestrationKey(service.key);
  const candidate={...service,url:serviceUrl,key:apiKey};
  let status;
  try{status=await api(candidate,service.id==='prowlarr'?service.system:'/api/v3/system/status');}catch(error){throw Object.assign(new Error(error.message),{statusCode:422,code:'CONNECTION_FAILED'});}
  if(status.status===401||status.status===403)throw Object.assign(new Error(`${orchestrationLabel(service)} rejected the API key.`),{statusCode:422,code:'CONNECTION_AUTH_FAILED'});
  if(status.status<200||status.status>=300)throw Object.assign(new Error(`${orchestrationLabel(service)} returned HTTP ${status.status||'error'}.`),{statusCode:422,code:'CONNECTION_FAILED'});
  const appName=String(status.data?.appName||'').toLowerCase();
  if(appName&&!appName.includes(serviceId))throw Object.assign(new Error(`This URL identifies ${status.data.appName}, not ${orchestrationLabel(service)}.`),{statusCode:422,code:'CONNECTION_SERVICE_MISMATCH'});
  const inventory=service.id==='prowlarr'?await prowlarrServiceInventory(candidate):await orchestrationServiceInventory(candidate);
  saveOrchestrationConnection(service,candidate);
  audit(req,'orchestration_connection_saved',{userId:session.user.id,service:serviceId});
  const {current,...publicInventory}=inventory;
  return {ok:true,message:`${orchestrationLabel(service)} connected and saved.`,connection:publicOrchestrationConnection(service),service:publicInventory};
}

async function updateQbittorrentConnection(req,body,session) {
  if(!body||typeof body!=='object'||Array.isArray(body))throw Object.assign(new Error('Connection details are invalid.'),{statusCode:400,code:'CONNECTION_INVALID'});
  const allowed=new Set(['url','username','password']);
  if(Object.keys(body).some(key=>!allowed.has(key)))throw Object.assign(new Error('Connection details contain an unsupported field.'),{statusCode:400,code:'CONNECTION_INVALID'});
  const submittedUsername=body.username===undefined?'':String(body.username).trim(),submittedPassword=body.password===undefined?'':String(body.password);
  const candidate={
    url:normalizeOrchestrationUrl(body.url||qbitConnection.url),
    username:submittedUsername?normalizeQbittorrentUsername(submittedUsername):normalizeQbittorrentUsername(qbitConnection.username),
    password:submittedPassword?normalizeQbittorrentPassword(submittedPassword):normalizeQbittorrentPassword(qbitConnection.password)
  };
  const inventory=await qbittorrentServiceInventory(candidate);
  if(!inventory.connected)throw Object.assign(new Error('qBittorrent rejected the connection details or could not be reached.'),{statusCode:422,code:'CONNECTION_AUTH_FAILED'});
  saveQbittorrentConnection(candidate);
  audit(req,'orchestration_connection_saved',{userId:session.user.id,service:'qbittorrent'});
  return {ok:true,message:'qBittorrent connected and saved.',connection:publicQbittorrentConnection(),service:inventory};
}
function bootstrapChoices(body) {
  if(!body||typeof body!=='object'||Array.isArray(body))throw Object.assign(new Error('Fresh-stack choices are invalid.'),{statusCode:400,code:'BOOTSTRAP_INPUT_INVALID'});
  const allowed=new Set(['sonarrRoot','radarrRoot','qbittorrentUrl','qbittorrentUsername','qbittorrentPassword','sonarrCategory','radarrCategory']);
  if(Object.keys(body).some(key=>!allowed.has(key)))throw Object.assign(new Error('Fresh-stack choices contain an unsupported field.'),{statusCode:400,code:'BOOTSTRAP_INPUT_INVALID'});
  return {
    sonarrRoot:body.sonarrRoot,
    radarrRoot:body.radarrRoot,
    qbittorrentUrl:body.qbittorrentUrl||qbitConnection.url,
    qbittorrentUsername:String(body.qbittorrentUsername||'').trim()||qbitConnection.username,
    qbittorrentPassword:String(body.qbittorrentPassword||'')||qbitConnection.password,
    sonarrCategory:body.sonarrCategory||'tv-sonarr',
    radarrCategory:body.radarrCategory||'radarr'
  };
}
async function currentBootstrapSnapshot() {
  const snapshot={};
  for(const service of [services.sonarr,services.radarr]){
    const [roots,clients,schemas]=await Promise.all([
      api(service,'/api/v3/rootfolder'),
      api(service,'/api/v3/downloadclient'),
      api(service,'/api/v3/downloadclient/schema')
    ]);
    if([roots,clients,schemas].some(response=>response.status<200||response.status>=300))throw Object.assign(new Error(`${orchestrationLabel(service)} setup inventory is unavailable.`),{statusCode:502,code:'BOOTSTRAP_INVENTORY_UNAVAILABLE'});
    snapshot[service.id]={
      rootFolders:Array.isArray(roots.data)?roots.data:[],
      downloadClients:Array.isArray(clients.data)?clients.data:[],
      downloadClientSchemas:Array.isArray(schemas.data)?schemas.data:[]
    };
  }
  return snapshot;
}
async function previewBootstrapPlan(body,session) {
  const snapshot=await currentBootstrapSnapshot(),plan=arrBootstrapOrchestrator.preview(bootstrapChoices(body),snapshot),planId=crypto.randomUUID(),expires=Date.now()+10*60*1000;
  setBounded(bootstrapPlans,planId,{plan,userId:session.user.id,createdAt:Date.now(),expires,used:false},MAP_LIMITS.bootstrapPlans);
  return {generatedAt:new Date().toISOString(),planId,expiresAt:new Date(expires).toISOString(),canApply:ORCHESTRATION_WRITES_ENABLED,plan:arrBootstrapOrchestrator.publicPlan(plan)};
}
function createdResource(response) { return Array.isArray(response?.data)?response.data[0]:response?.data; }
function bootstrapRollbackResource(request,response) {
  if(request.method==='PUT'){
    const original=request.original;
    if(!original||typeof original!=='object'||Array.isArray(original)||!Number.isInteger(Number(original.id)))throw new Error('The setup preview no longer has a valid rollback copy.');
    return {service:request.service,method:'PUT',path:`${request.path.replace(/\/$/,'').replace(/\/\d+$/,'')}/${Number(original.id)}`,body:original};
  }
  const created=createdResource(response),id=Number(created?.id);
  if(request.method!=='POST'||!Number.isInteger(id)||id<1)throw new Error(`${orchestrationLabel(services[request.service])} did not return the created resource identifier.`);
  return {service:request.service,method:'DELETE',path:`${request.path.replace(/\/$/,'')}/${id}`,body:null};
}
async function applyBootstrapPlan(req,planId,session) {
  if(!ORCHESTRATION_WRITES_ENABLED)throw Object.assign(new Error('ARR changes are locked on this instance.'),{statusCode:409,code:'ORCHESTRATION_LOCKED'});
  const record=bootstrapPlans.get(planId);
  if(!record||record.expires<Date.now()||record.used||record.userId!==session.user.id)throw Object.assign(new Error('This fresh-stack preview expired. Review the setup again.'),{statusCode:409,code:'PLAN_EXPIRED'});
  if(orchestrationApplyLocked)throw Object.assign(new Error('Another ARR change is already in progress.'),{statusCode:409,code:'ORCHESTRATION_BUSY'});
  const requests=arrBootstrapOrchestrator.applicationRequests(record.plan);
  if(!requests.length){record.used=true;return {ok:true,message:'Sonarr and Radarr already match these setup choices.',changes:0};}
  orchestrationApplyLocked=true;
  const backup={id:crypto.randomUUID(),kind:'fresh_stack',createdAt:new Date().toISOString(),createdBy:session.user.id,status:'created',planId,resources:[]};
  saveOrchestrationBackup(backup);
  const applied=[];
  try{
    for(const request of requests.filter(item=>item.path.startsWith('/api/v3/downloadclient'))){
      const tested=await api(services[request.service],'/api/v3/downloadclient/test','POST',request.body);
      if(tested.status<200||tested.status>=300)throw new Error(`${orchestrationLabel(services[request.service])} rejected the qBittorrent settings.`);
    }
    for(const request of requests){
      const response=await api(services[request.service],request.path,request.method,request.body);
      if(response.status<200||response.status>=300)throw new Error(`${orchestrationLabel(services[request.service])} rejected a fresh-stack change.`);
      const rollback=bootstrapRollbackResource(request,response);
      backup.resources.push(rollback);applied.push(rollback);saveOrchestrationBackup(backup);
    }
    const verification=await currentBootstrapSnapshot(),mismatches=arrBootstrapOrchestrator.mismatchFields(record.plan,verification);
    if(mismatches.length)throw new Error(`Fresh-stack verification failed (${mismatches.join(', ')}).`);
    record.used=true;backup.status='applied';backup.appliedAt=new Date().toISOString();backup.verifiedAt=backup.appliedAt;saveOrchestrationBackup(backup);responseCache.clear();audit(req,'fresh_stack_applied',{userId:session.user.id,backupId:backup.id,changes:record.plan.changes.length,verified:true});
    return {ok:true,message:`Configured ${record.plan.changes.length} fresh-stack ${record.plan.changes.length===1?'item':'items'}.`,changes:record.plan.changes.length,backup:{id:backup.id,createdAt:backup.createdAt,status:backup.status}};
  }catch(error){
    if(applied.length){try{await restoreOrchestrationResources(applied);backup.status='automatically_rolled_back';backup.rolledBackAt=new Date().toISOString();}catch(rollbackError){backup.status='rollback_failed';backup.rollbackError=rollbackError.message;}}
    else backup.status='failed';
    backup.error=error.message;saveOrchestrationBackup(backup);audit(req,'fresh_stack_apply_failed',{userId:session.user.id,backupId:backup.id,status:backup.status});throw error;
  }finally{orchestrationApplyLocked=false;}
}
async function currentOrchestrationSnapshot() {
  const current = {}, resources = [];
  for (const service of [services.sonarr, services.radarr]) {
    const label = orchestrationLabel(service);
    const [media, download] = await Promise.all([
      api(service, '/api/v3/config/mediamanagement'),
      api(service, '/api/v3/config/downloadclient')
    ]);
    if (media.status < 200 || media.status >= 300 || download.status < 200 || download.status >= 300) throw new Error(`${label} settings are unavailable.`);
    resources.push(
      {service:service.id,path:arrOrchestrator.ENDPOINTS.mediaManagement,body:media.data},
      {service:service.id,path:arrOrchestrator.ENDPOINTS.downloadHandling,body:download.data}
    );
    current[service.id] = {
      mediaManagement: {
        renameFiles: service.id === 'sonarr' ? media.data?.renameEpisodes === true : media.data?.renameMovies === true,
        replaceIllegalCharacters: media.data?.replaceIllegalCharacters === true,
        importExtraFiles: media.data?.importExtraFiles === true
      },
      downloadHandling: {
        completedDownloadHandling: download.data?.enableCompletedDownloadHandling === true,
        removeCompletedDownloads: download.data?.removeCompletedDownloads === true
      }
    };
  }
  return {current, resources};
}
async function currentOrchestrationSettings() { return (await currentOrchestrationSnapshot()).current; }
function orchestrationBackupFile(id) {
  if (!/^[a-f0-9-]{36}$/.test(String(id))) throw new Error('Backup identifier is invalid.');
  return path.join(ORCHESTRATION_BACKUP_ROOT, `${id}.json`);
}
function saveOrchestrationBackup(backup) {
  fs.mkdirSync(ORCHESTRATION_BACKUP_ROOT, {recursive:true, mode:0o700});
  atomicWriteJson(orchestrationBackupFile(backup.id), backup);
  const files=fs.readdirSync(ORCHESTRATION_BACKUP_ROOT).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)).map(name=>({name,mtime:fs.statSync(path.join(ORCHESTRATION_BACKUP_ROOT,name)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime);
  for(const old of files.slice(20))try{fs.unlinkSync(path.join(ORCHESTRATION_BACKUP_ROOT,old.name))}catch{}
}
function loadOrchestrationBackup(id) { return JSON.parse(fs.readFileSync(orchestrationBackupFile(id), 'utf8')); }
function orchestrationBackups() {
  try {
    return fs.readdirSync(ORCHESTRATION_BACKUP_ROOT).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)).map(name=>loadOrchestrationBackup(name.slice(0,-5))).map(({resources,...backup})=>({...backup,resourceCount:Array.isArray(resources)?resources.length:0})).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  } catch { return []; }
}
function validateOrchestrationResources(resources) {
  if(!Array.isArray(resources)||!resources.length)throw new Error('Backup does not contain restorable settings.');
  for(const resource of resources){
    const arrResource=['sonarr','radarr'].includes(resource.service)&&Object.values(arrOrchestrator.ENDPOINTS).includes(resource.path)&&(resource.method===undefined||resource.method==='PUT')&&resource.body&&typeof resource.body==='object'&&!Array.isArray(resource.body);
    const bootstrapMethod=resource.method==='PUT'||resource.method==='DELETE',bootstrapBody=resource.method==='DELETE'?resource.body===null:resource.body&&typeof resource.body==='object'&&!Array.isArray(resource.body);
    const bootstrapResource=['sonarr','radarr'].includes(resource.service)&&bootstrapMethod&&/^\/api\/v3\/(?:rootfolder|downloadclient)\/[1-9]\d*$/.test(resource.path)&&bootstrapBody;
    const prowlarrMethod=resource.method==='PUT'||resource.method==='DELETE',prowlarrBody=resource.method==='DELETE'?resource.body===null:resource.body&&typeof resource.body==='object'&&!Array.isArray(resource.body);
    const prowlarrResource=resource.service==='prowlarr'&&prowlarrMethod&&/^\/api\/v1\/applications\/[1-9]\d*$/.test(resource.path)&&prowlarrBody;
    if(!arrResource&&!bootstrapResource&&!prowlarrResource)throw new Error('Backup contains an unsupported resource.');
  }
  return resources;
}
async function restoreOrchestrationResources(resources) {
  const restored=[];
  try{
    for(const resource of [...validateOrchestrationResources(resources)].reverse()){
      const response=await api(services[resource.service],resource.path,resource.method||'PUT',resource.body);
      if(response.status<200||response.status>=300)throw new Error(`${orchestrationLabel(services[resource.service])} rejected a rollback request.`);
      restored.push({service:resource.service,path:resource.path});
    }
  }catch(error){error.restoredResources=restored.length;throw error;}
  return restored;
}
function orchestrationRequestMatches(request,data) {
  return request&&request.body&&data&&typeof data==='object'&&!Array.isArray(data)&&Object.entries(request.body).every(([key,value])=>data[key]===value);
}
async function applyOrchestrationPlan(req, planId, session) {
  if(!ORCHESTRATION_WRITES_ENABLED)throw Object.assign(new Error('ARR changes are locked on this instance.'),{statusCode:409,code:'ORCHESTRATION_LOCKED'});
  const record=orchestrationPlans.get(planId);
  if(!record||record.expires<Date.now()||record.used||record.userId!==session.user.id)throw Object.assign(new Error('This change preview expired. Review the settings again.'),{statusCode:409,code:'PLAN_EXPIRED'});
  if(orchestrationApplyLocked)throw Object.assign(new Error('Another ARR change is already in progress.'),{statusCode:409,code:'ORCHESTRATION_BUSY'});
  const requests=arrOrchestrator.applicationRequests(record.plan);
  if(!requests.length)return {ok:true,message:'No changes were needed.',changes:0};
  orchestrationApplyLocked=true;
  const backup={id:crypto.randomUUID(),createdAt:new Date().toISOString(),createdBy:session.user.id,status:'created',planId,resources:record.resources};
  saveOrchestrationBackup(backup);
  const applied=[];
  try{
    for(const request of requests){
      const original=record.resources.find(resource=>resource.service===request.service&&resource.path===request.path);
      if(!original)throw new Error('The change preview no longer matches its backup.');
      const response=await api(services[request.service],request.path,'PUT',{...original.body,...request.body});
      if(response.status<200||response.status>=300)throw new Error(`${orchestrationLabel(services[request.service])} rejected a settings change.`);
      applied.push(original);
    }
    for(const request of requests){
      const verification=await api(services[request.service],request.path);
      if(verification.status<200||verification.status>=300||!orchestrationRequestMatches(request,verification.data))throw new Error(`${orchestrationLabel(services[request.service])} did not retain a reviewed settings change.`);
    }
    record.used=true;backup.status='applied';backup.appliedAt=new Date().toISOString();backup.verifiedAt=backup.appliedAt;saveOrchestrationBackup(backup);audit(req,'orchestration_applied',{userId:session.user.id,backupId:backup.id,changes:record.plan.changes.length,verified:true});
    return {ok:true,message:`Applied ${record.plan.changes.length} safe ${record.plan.changes.length===1?'change':'changes'}.`,changes:record.plan.changes.length,backup:{id:backup.id,createdAt:backup.createdAt,status:backup.status}};
  }catch(error){
    if(applied.length){try{await restoreOrchestrationResources(applied);backup.status='automatically_rolled_back';backup.rolledBackAt=new Date().toISOString();}catch(rollbackError){backup.status='rollback_failed';backup.rollbackError=rollbackError.message;}}
    else backup.status='failed';
    backup.error=error.message;saveOrchestrationBackup(backup);audit(req,'orchestration_apply_failed',{userId:session.user.id,backupId:backup.id,status:backup.status});throw error;
  }finally{orchestrationApplyLocked=false;}
}

async function applyProwlarrPlan(req,planId,session) {
  if(!ORCHESTRATION_WRITES_ENABLED)throw Object.assign(new Error('ARR changes are locked on this instance.'),{statusCode:409,code:'ORCHESTRATION_LOCKED'});
  const record=prowlarrPlans.get(planId);
  if(!record||record.expires<Date.now()||record.used||record.userId!==session.user.id)throw Object.assign(new Error('This Prowlarr preview expired. Review the links again.'),{statusCode:409,code:'PLAN_EXPIRED'});
  if(orchestrationApplyLocked)throw Object.assign(new Error('Another ARR change is already in progress.'),{statusCode:409,code:'ORCHESTRATION_BUSY'});
  const requests=prowlarrOrchestrator.applicationRequests(record.plan);
  if(!requests.length)return {ok:true,message:'Prowlarr already has both application links.',changes:0};
  orchestrationApplyLocked=true;
  const backup={id:crypto.randomUUID(),kind:'prowlarr_applications',createdAt:new Date().toISOString(),createdBy:session.user.id,status:'created',planId,resources:requests.filter(request=>request.original).map(request=>({service:'prowlarr',method:'PUT',path:`/api/v1/applications/${request.original.id}`,body:request.original}))};
  saveOrchestrationBackup(backup);
  const applied=[];
  try{
    for(const request of requests){
      const tested=await api(services.prowlarr,'/api/v1/applications/test','POST',request.body);
      if(tested.status<200||tested.status>=300)throw new Error(`Prowlarr rejected the proposed ${orchestrationLabel(services[request.service])} link.`);
    }
    for(const request of requests){
      const response=await api(services.prowlarr,request.path,request.method,request.body);
      if(response.status<200||response.status>=300)throw new Error(`Prowlarr rejected the ${orchestrationLabel(services[request.service])} application link.`);
      if(request.method==='POST'){
        const created=Array.isArray(response.data)?response.data[0]:response.data,id=Number(created?.id);
        if(!Number.isInteger(id)||id<1)throw new Error('Prowlarr created an application link without returning its identifier.');
        const rollback={service:'prowlarr',method:'DELETE',path:`/api/v1/applications/${id}`,body:null};
        backup.resources.push(rollback);applied.push(rollback);saveOrchestrationBackup(backup);
      }else{
        const rollback=backup.resources.find(resource=>resource.path===request.path&&resource.method==='PUT');
        if(!rollback)throw new Error('The Prowlarr change no longer matches its backup.');
        applied.push(rollback);
      }
    }
    const verification=await api(services.prowlarr,'/api/v1/applications');
    const mismatches=Array.isArray(verification.data)?prowlarrOrchestrator.mismatchFields(record.plan,verification.data):['applications'];
    if(verification.status<200||verification.status>=300||!Array.isArray(verification.data)||mismatches.length)throw new Error(`Prowlarr did not retain both reviewed application links (${mismatches.join(', ')}).`);
    record.used=true;backup.status='applied';backup.appliedAt=new Date().toISOString();backup.verifiedAt=backup.appliedAt;saveOrchestrationBackup(backup);responseCache.clear();audit(req,'prowlarr_links_applied',{userId:session.user.id,backupId:backup.id,changes:record.plan.changes.length,verified:true});
    return {ok:true,message:`Configured ${record.plan.changes.length} Prowlarr application ${record.plan.changes.length===1?'link':'links'}.`,changes:record.plan.changes.length,backup:{id:backup.id,createdAt:backup.createdAt,status:backup.status}};
  }catch(error){
    if(applied.length){try{await restoreOrchestrationResources(applied);backup.status='automatically_rolled_back';backup.rolledBackAt=new Date().toISOString();}catch(rollbackError){backup.status='rollback_failed';backup.rollbackError=rollbackError.message;}}
    else backup.status='failed';
    backup.error=error.message;saveOrchestrationBackup(backup);audit(req,'prowlarr_links_apply_failed',{userId:session.user.id,backupId:backup.id,status:backup.status});throw error;
  }finally{orchestrationApplyLocked=false;}
}
async function rollbackOrchestrationBackup(req,id,session){
  if(!ORCHESTRATION_WRITES_ENABLED)throw Object.assign(new Error('ARR changes are locked on this instance.'),{statusCode:409,code:'ORCHESTRATION_LOCKED'});
  if(orchestrationApplyLocked)throw Object.assign(new Error('Another ARR change is already in progress.'),{statusCode:409,code:'ORCHESTRATION_BUSY'});
  const backup=loadOrchestrationBackup(id);
  orchestrationApplyLocked=true;
  try{const restored=await restoreOrchestrationResources(backup.resources);backup.status='rolled_back';backup.rolledBackAt=new Date().toISOString();backup.rolledBackBy=session.user.id;saveOrchestrationBackup(backup);audit(req,'orchestration_rolled_back',{userId:session.user.id,backupId:id,resources:restored.length});return {ok:true,message:'The previous ARR settings were restored.',backup:{id,status:backup.status,rolledBackAt:backup.rolledBackAt}};}
  catch(error){backup.status='rollback_failed';backup.rollbackFailedAt=new Date().toISOString();backup.rollbackError=error.message;backup.restoredResources=Number(error.restoredResources||0);saveOrchestrationBackup(backup);audit(req,'orchestration_rollback_failed',{userId:session.user.id,backupId:id,resources:backup.restoredResources});throw Object.assign(error,{statusCode:502,code:'ROLLBACK_FAILED'});}
  finally{orchestrationApplyLocked=false;}
}
async function requestHistory() {
  const records=loadRequests(), normalized=x=>String(x||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const data={};
  for(const s of [services.sonarr,services.radarr]) { try { const [library,queue]=await Promise.all([api(s,s.library),api(s,s.type==='series'?'/api/v3/queue?page=1&pageSize=100&includeUnknownSeriesItems=true':'/api/v3/queue?page=1&pageSize=100&includeUnknownMovieItems=true')]); data[s.id]={s,library:Array.isArray(library.data)?library.data:[],queue:queue.data?.records||[]}; } catch { data[s.id]={s,library:[],queue:[]}; } }
  let changed=false;
  const result=records.map(item=>{const entry=Object.values(data).find(x=>x.s.label===item.service); if(!entry)return {...item,displayStatus:item.status||'accepted'}; let current=item.arrId?entry.library.find(x=>x.id===item.arrId):null; if(!current){current=entry.library.find(x=>normalized(x.title)===normalized(item.title)); if(current&&!item.arrId){item.arrId=current.id;changed=true;}}
    if(!current)return {...item,displayStatus:item.status||'accepted',stage:requestStage(item.status||'waiting'),progress:0}; const q=entry.queue.find(x=>x.seriesId===current.id||x.movieId===current.id); const files=entry.s.type==='series'?Number(current.statistics?.episodeFileCount||0)>0:Boolean(current.movieFileId||current.hasFile); let displayStatus=files?'available':'waiting'; if(q){if(q.status==='failed'||q.trackedDownloadStatus==='error')displayStatus='failed';else if(q.status==='downloading')displayStatus='downloading';else if(q.status==='completed'||['importing','importPending'].includes(q.trackedDownloadState))displayStatus='importing';else displayStatus='queued';} const size=Number(q?.size||0),left=Number(q?.sizeleft||0),progress=size?Math.max(0,Math.min(100,Math.round((1-left/size)*100))):displayStatus==='available'?100:0;return {...item,displayStatus,stage:requestStage(displayStatus),progress,updatedAt:q?.estimatedCompletionTime||item.createdAt||null,quality:q?.quality?.quality?.name||null};});
  if(changed) writeRequests(records);
  return result;
}
function requestStage(status) { const value=String(status||'waiting');return ({pending_approval:0,accepted:1,waiting:1,queued:2,downloading:3,importing:4,available:5,failed:-1,error:-1})[value]??1; }
async function collectDiscover(user=null) {
  const limit=Math.max(4,Math.min(24,Number(runtimeSettings.discoveryLimit)||12));
  const s=services.radarr;
  const embyUserId=String(user?.preferences?.embyUserId||'');
  const [rawCandidates,library,inspired]=await Promise.all([api(s,'/api/v3/importlist/movie'),api(s,s.library),embyInspiredRecommendations(limit,embyUserId).catch(()=>[])]);
  const owned=new Set((library.data||[]).map(x=>x.tmdbId));
  const genreCounts={};for(const movie of (library.data||[]))for(const genre of (movie.genres||[]))genreCounts[genre]=(genreCounts[genre]||0)+1;
  const rows=(Array.isArray(rawCandidates.data)?rawCandidates.data:[]).filter(x=>x.title&&!owned.has(x.tmdbId)&&!x.isExisting&&!x.isExcluded).map(x=>({raw:x,item:mapMedia(x,s),score:(x.genres||[]).reduce((n,g)=>n+(genreCounts[g]||0),0)+(x.isRecommendation?40:0)+(x.isTrending?20:0)+(x.isPopular?10:0)+Math.min(25,Number(x.popularity||0)/10)}));
  const cards=items=>Array.from(new Map(items.map(x=>[`${x.serviceId}:${x.tvdbId||x.tmdbId||x.title}`,x])).values()).slice(0,limit).map(mediaCard);
  const inspiredItems=[...inspired,...rows.sort((a,b)=>b.score-a.score).map(x=>x.item)];
  const trending=rows.filter(x=>x.raw.isTrending).sort((a,b)=>Number(b.raw.popularity||0)-Number(a.raw.popularity||0)).map(x=>x.item);
  const popular=rows.filter(x=>x.raw.isPopular).sort((a,b)=>Number(b.raw.popularity||0)-Number(a.raw.popularity||0)).map(x=>x.item);
  const newReleases=[...rows].sort((a,b)=>Number(b.raw.year||0)-Number(a.raw.year||0)||Number(b.raw.popularity||0)-Number(a.raw.popularity||0)).map(x=>x.item);
  return {personalized:Boolean(embyUserId),inspired:cards(inspiredItems),trending:cards(trending.length?trending:inspiredItems),popular:cards(popular.length?popular:inspiredItems),newReleases:cards(newReleases)};
}
async function discover(user=null,refresh=false) { const key=`discover:${user?.id||'anonymous'}:${user?.preferences?.embyUserId||'library'}`;if(refresh)responseCache.delete(key);return cachedAsync(key,60000,()=>collectDiscover(user)); }
async function search(term) {
  const parsed = typeof term === 'string' ? parseMediaQuery(term) : term;
  const targets = parsed.mediaType ? Object.values(services).filter(s => s.type === parsed.mediaType) : [services.sonarr, services.radarr];
  const query = parsed.canonicalTitle || parsed.title || parsed.original;
  if (!query) return [];
  const rows = await Promise.all(targets.map(async s => {
    try {
      const r = await api(s, `${s.search}?term=${encodeURIComponent(query)}`);
      return (Array.isArray(r.data) ? r.data : []).slice(0, 40).map(x => mapMedia(x, s));
    } catch { return []; }
  }));
  return rankMediaResults(rows.flat(), parsed).slice(0, 16).map(x => seasonDetails(x, parsed.seasonNumber));
}
function mediaCard(item) {
  const mediaRef=crypto.randomBytes(18).toString('base64url');
  setBounded(mediaRefs,mediaRef,{item,expires:Date.now()+15*60*1000},MAP_LIMITS.mediaRefs);
  return {kind:'media',mediaRef,title:item.title,year:item.year,mediaType:item.kind==='movie'?'movie':'series',service:item.serviceId,poster:item.poster,overview:item.overview,availability:item.arrId?'library_or_monitored':'can_request',seasonNumber:item.seasonNumber||null,seasonTitle:item.seasonTitle||null,actions:['view','propose_request']};
}
function proposalFor(req,mediaRef,userId) { const ref=mediaRefs.get(mediaRef); if(!ref||ref.expires<Date.now())throw new Error('That result expired. Search again.'); const id=crypto.randomBytes(24).toString('base64url'); const proposal={id,type:'media_request',item:ref.item,userId,expires:Date.now()+5*60*1000,used:false}; setBounded(pendingActions,id,proposal,MAP_LIMITS.pendingActions); return {id,type:proposal.type,title:proposal.item.title,year:proposal.item.year,mediaType:proposal.item.kind==='movie'?'movie':'series',service:proposal.item.serviceId,seasonNumber:proposal.item.seasonNumber||null,seasonTitle:proposal.item.seasonTitle||null,confirmationRequired:true,expiresAt:new Date(proposal.expires).toISOString()}; }
async function rejectionProposal(downloadId,userId) { const snap=await downloadSnapshot(),item=snap.rows.find(x=>x.id===downloadId); if(!item)throw new Error('That queue item no longer exists.'); if(!item.canRejectThroughArr)throw new Error('Only releases owned by Sonarr or Radarr can be rejected here.'); if(!item.unsafeRejected&&!['failed','error'].includes(String(item.state))&&item.trackedStatus!=='error')throw new Error('This action is only offered for rejected or failed releases.'); const id=crypto.randomBytes(24).toString('base64url'),proposal={id,type:'reject_release',downloadId:item.id,item:{title:item.title,serviceId:item.serviceId,arrId:item.arrId,hash:item.hash,unsafeRejected:item.unsafeRejected},userId,expires:Date.now()+5*60*1000,used:false};setBounded(pendingActions,id,proposal,MAP_LIMITS.pendingActions);return {id,type:proposal.type,title:item.title,service:item.serviceId,unsafeRejected:item.unsafeRejected,confirmationRequired:true,warning:'Sonarr or Radarr will remove this release from the download client, delete its files, blocklist it, and search for a replacement.',expiresAt:new Date(proposal.expires).toISOString()}; }
async function confirmProposal(req,id,user) { const p=pendingActions.get(id); if(!p||p.used||p.expires<Date.now()||p.userId!==user.id)throw new Error('This confirmation expired. Search again.'); p.used=true; if(p.type==='reject_release'){if(!audit(req,'release_rejection_confirmed',{title:p.item.title,service:p.item.serviceId,userId:user.id,unsafeRejected:p.item.unsafeRejected}))throw new Error('The safety audit could not be recorded, so no files were changed.');const result=await downloadAction(p.downloadId,'refetch',p.item);audit(req,'release_rejected',{title:p.item.title,service:p.item.serviceId,userId:user.id,unsafeRejected:p.item.unsafeRejected});return result;}return submitRequest(req,p.item,user,'request_confirmed'); }
function diskStatus() {
  try { const text = require('child_process').execFileSync('df', ['-Pk', MEDIA_ROOT], {encoding:'utf8'}).trim().split('\n').pop().trim().split(/\s+/); const total=Number(text[1])*1024, used=Number(text[2])*1024, free=Number(text[3])*1024, percent=Number(text[4].replace('%','')); return {path: MEDIA_ROOT, total, used, free, freeGb: +(free/1073741824).toFixed(1), freePercent: +(100-percent).toFixed(1), low: free/1073741824 < Number(runtimeSettings.minFreeGb||MIN_FREE_GB) || 100-percent < Number(runtimeSettings.minFreePercent||MIN_FREE_PERCENT)}; } catch (e) { return {path: MEDIA_ROOT, low: true, error: 'Media disk is not mounted or cannot be read.'}; }
}
async function collectHealth() {
  const checks = await Promise.all(Object.values(services).filter(s=>s.id!=='prowlarr').map(async s => { try { const r=await api(s,'/api/v3/system/status'); return {id:s.id,label:s.label,ok:r.status>=200&&r.status<300,version:r.data.version}; } catch(e) { return {id:s.id,label:s.label,ok:false,error:e.message}; } }));
  try { const r=await api(services.prowlarr,services.prowlarr.system); checks.push({id:'prowlarr',label:'Prowlarr',ok:r.status>=200&&r.status<300,version:r.data?.version||null}); } catch(e) { checks.push({id:'prowlarr',label:'Prowlarr',ok:false,error:e.message}); }
  const disk=diskStatus(); const alerts=[];
  if (disk.low) alerts.push({id:'disk',level:'warning',service:'Storage',message:disk.error || `Only ${disk.freeGb} GB (${disk.freePercent}%) remains on the media disk.`});
  checks.filter(x=>!x.ok).forEach(x=>alerts.push({id:x.id,level:'error',service:x.label,message:'Service is unavailable.'}));
  for (const s of Object.values(services)) {
    try { const r=await api(s,'/api/v3/health'); for(const x of (Array.isArray(r.data)?r.data:[])) alerts.push({id:`${s.id}-${x.message}`,level:x.type||'warning',service:s.label,message:x.message||'Health check needs attention'}); } catch {}
    try { const queuePath=s.type==='series'?'/api/v3/queue?page=1&pageSize=50&includeUnknownSeriesItems=true':'/api/v3/queue?page=1&pageSize=50&includeUnknownMovieItems=true'; const q=await api(s,queuePath); for(const item of (q.data?.records||[])) if(item.status==='failed'||item.trackedDownloadStatus==='warning'||item.trackedDownloadStatus==='error') alerts.push({id:`queue-${s.id}-${item.id}`,level:'error',service:s.label,message:`Download needs attention: ${item.title||'unknown item'}${item.errorMessage?`: ${item.errorMessage}`:''}`}); } catch {}
  }
  try { const r=await api(services.prowlarr,services.prowlarr.health); for(const x of (Array.isArray(r.data)?r.data:[])) alerts.push({id:`prowlarr-${x.source||x.message}`,level:x.type||'warning',service:'Prowlarr',message:x.message||'Indexer health needs attention'}); } catch { alerts.push({id:'prowlarr-down',level:'error',service:'Prowlarr',message:'Prowlarr is unavailable.'}); }
  return {checkedAt:new Date().toISOString(),services:checks,disk,alerts};
}
let healthMemo={value:null,expires:0,promise:null};
async function health(refresh=false) { const now=Date.now();if(!refresh&&healthMemo.value&&healthMemo.expires>now)return healthMemo.value;if(healthMemo.promise)return healthMemo.promise;healthMemo.promise=collectHealth().then(value=>{healthMemo={value,expires:Date.now()+15000,promise:null};return value},error=>{healthMemo.promise=null;throw error});return healthMemo.promise; }
function auditEntries(limit=100) { try { const users=loadUsers(),userName=id=>users.find(user=>user.id===id)?.displayName||users.find(user=>user.id===id)?.username||null;return fs.readFileSync(AUDIT_FILE,'utf8').trim().split('\n').filter(Boolean).slice(-Math.max(1,Math.min(300,Number(limit)||100))).reverse().map(line=>{try{const x=JSON.parse(line),actorId=x.actorId||x.userId||null,targetUserId=x.actorId&&x.userId&&x.actorId!==x.userId?x.userId:null;return {at:x.at,action:x.action,actorId,actor:userName(actorId)||x.username||'System',targetUserId,targetUser:userName(targetUserId),source:x.ip||null,service:x.service||null,title:x.title||null,reason:x.reason||null,requestId:x.requestId||null,linked:typeof x.linked==='boolean'?x.linked:null,unsafeRejected:Boolean(x.unsafeRejected),fields:Array.isArray(x.fields)?x.fields.map(String).filter(field=>field!=='smtpPass').slice(0,30):[]};}catch{return null}}).filter(Boolean); } catch { return []; } }
async function adminOverview() { const [system,requests,library,downloads]=await Promise.all([health(),requestHistory(),embyLibrary().catch(()=>({connected:false,items:[],total:0})),downloadSnapshot().catch(()=>({connected:false,checkedAt:new Date().toISOString(),rows:[]}))]);const counts={available:0,downloading:0,importing:0,failed:0,waiting:0,pending_approval:0,queued:0};for(const request of requests){const key=request.displayStatus||request.status||'waiting';counts[key]=(counts[key]||0)+1;}const activeDownloads=downloads.rows.filter(x=>!['seeding','paused'].includes(x.state)),failedDownloads=downloads.rows.filter(x=>x.state==='failed'||x.trackedStatus==='error'||x.unsafeRejected);const total=Number(system.disk.total||0),used=Number(system.disk.used||0);return {checkedAt:new Date().toISOString(),status:system.alerts.length||system.disk.low?'attention':'healthy',plainStatus:system.alerts.length?`${system.alerts.length} item${system.alerts.length===1?' needs':'s need'} attention.`:'Everything is working normally.',alerts:system.alerts.slice(0,12),requestCounts:counts,totalRequests:requests.length,library:{connected:library.connected,total:library.total||library.items?.length||0,server:library.server||null},storage:{total,used,free:Number(system.disk.free||0),usedPercent:total?Math.round(used/total*100):null,freeGb:system.disk.freeGb,freePercent:system.disk.freePercent,low:system.disk.low,path:system.disk.path||null},services:system.services.map(x=>({id:x.id,label:x.label,ok:x.ok,version:x.version||null})),downloads:{connected:downloads.connected,checkedAt:downloads.checkedAt,total:downloads.rows.length,active:activeDownloads.length,failed:failedDownloads.length,rows:publicDownloads(downloads).rows.slice(0,8)},recentAudit:auditEntries(10)}; }
function diagnostics() { let version='development';try{version=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version||version}catch{}const memory=process.memoryUsage();return {checkedAt:new Date().toISOString(),startedAt:APP_STARTED_AT,uptimeSeconds:Math.round(process.uptime()),version,node:process.version,platform:`${process.platform}/${process.arch}`,memory:{rss:memory.rss,heapUsed:memory.heapUsed,heapTotal:memory.heapTotal},state:{sessions:sessions.size,pendingConfirmations:pendingActions.size,cachedMediaResults:mediaRefs.size,rateLimitSubjects:rateLimits.size},paths:{dataWritable:fs.existsSync(DATA_ROOT),mediaMounted:!diskStatus().error},configuration:{secureCookies:SECURE_COOKIES,trustProxy:TRUST_PROXY,listenHost:LISTEN_HOST}}; }
function loadRequests() { try { return JSON.parse(fs.readFileSync(requestLog,'utf8')); } catch { return []; } }
function writeRequests(items) { atomicWriteJson(requestLog,items.slice(0,500)); }
function saveRequest(item) { const items=loadRequests(); items.unshift({id:item.id||crypto.randomUUID(),createdAt:item.createdAt||new Date().toISOString(),...item}); writeRequests(items); }
async function requestPolicyFor(user) { if(user?.role==='owner')return {startNow:true};const disk=diskStatus();if(runtimeSettings.pauseRequestsWhenStorageLow!==false&&disk.low)return {startNow:false,reason:'storage_low',message:'Storage is currently limited, so your request is waiting for the system administrator.'};if(runtimeSettings.userAutoApprove===false)return {startNow:false,reason:'approval_required',message:'Your request is waiting for the system administrator.'};const limit=Math.max(1,Math.min(20,Number(runtimeSettings.userActiveRequestLimit)||3)),history=await requestHistory(),active=history.filter(x=>x.requestedBy===user.id&&!['available','failed','error'].includes(String(x.displayStatus||x.status))).length;if(active>=limit)return {startNow:false,reason:'allotment_reached',message:`You already have ${active} active request${active===1?'':'s'}. This request is waiting for the system administrator.`};return {startNow:true,remaining:Math.max(0,limit-active-1)}; }
function queuePendingRequest(item,user,policy) { const record={id:crypto.randomUUID(),title:item.title,service:services[item.serviceId]?.label||item.service,createdAt:new Date().toISOString(),status:'pending_approval',displayStatus:'pending_approval',requestedSeason:item.seasonNumber||null,requestedBy:user.id,requestedByName:user.displayName||user.username,holdReason:policy.reason,requestItem:{title:item.title,kind:item.kind,serviceId:item.serviceId,year:item.year,tvdbId:item.tvdbId,tmdbId:item.tmdbId,seasons:item.seasons||[],seasonNumber:item.seasonNumber||null,seasonTitle:item.seasonTitle||null,arrId:item.arrId||null}};saveRequest(record);return {ok:true,accepted:false,pendingApproval:true,requestId:record.id,title:item.title,message:policy.message}; }
async function withRequestAdmission(user,operation) { if(user?.role==='owner')return operation();const key=String(user?.id||'unknown'),previous=requestAdmissionLocks.get(key)||Promise.resolve();let release;const gate=new Promise(resolve=>{release=resolve}),tail=previous.then(()=>gate);requestAdmissionLocks.set(key,tail);await previous;try{return await operation();}finally{release();if(requestAdmissionLocks.get(key)===tail)requestAdmissionLocks.delete(key);} }
async function submitRequest(req,item,user,auditAction='request_submitted') { return withRequestAdmission(user,async()=>{const policy=await requestPolicyFor(user);if(!policy.startNow){const pending=queuePendingRequest(item,user,policy);audit(req,'request_held',{title:item.title,userId:user.id,reason:policy.reason});return pending;}const result=await createRequest(item,user);audit(req,auditAction,{title:item.title,service:item.serviceId,userId:user.id});return result;}); }

function arrError(data) {
  return Array.isArray(data) ? data.map(x=>x.errorMessage||x.message||x.propertyName).filter(Boolean).join('; ') : (data?.message||data?.error||'Unknown ARR API error');
}

async function findExistingSeries(item) {
  const s=services.sonarr;
  try {
    const r=await api(s,s.library);
    const rows=Array.isArray(r.data)?r.data:[];
    return rows.find(x => (item.tvdbId && Number(x.tvdbId)===Number(item.tvdbId)) || titleKey(canonicalTitle(x.title))===titleKey(canonicalTitle(item.title))) || null;
  } catch { return null; }
}

function seasonList(seasons, target, preserveOthers) {
  const list=Array.isArray(seasons)?seasons.map(x=>({...x})):[];
  const found=list.some(x=>Number(x.seasonNumber)===Number(target));
  const result=list.map(x=>Number(x.seasonNumber)===Number(target)?{...x,monitored:true}:preserveOthers?x:{...x,monitored:false});
  if(!found)result.push({seasonNumber:Number(target),monitored:true});
  return result;
}

async function createRequest(item,requester=null,ignoreRequestId=null) {
  const s=services[item.serviceId]; if (!s) throw new Error('Unknown ARR service');
  const requestedSeason=item.kind==='series' && item.seasonNumber!==null && item.seasonNumber!==undefined ? Number(item.seasonNumber) : null;
  const duplicate=loadRequests().find(record=>record.id!==ignoreRequestId&&record.requestedBy===(requester?.id||null)&&record.service===s.label&&titleKey(record.title)===titleKey(item.title)&&Number(record.requestedSeason??-1)===Number(requestedSeason??-1)&&!['failed','error'].includes(String(record.displayStatus||record.status)));
  if(duplicate)return {ok:true,accepted:true,alreadyRequested:true,title:item.title,service:s.label,requestId:duplicate.id,message:'This title is already in your requests.'};
  let arrId=item.arrId||null;

  if (requestedSeason!==null && s.type==='series') {
    const existing=await findExistingSeries(item);
    if (existing) {
      const updated={...existing,monitored:true,seasons:seasonList(existing.seasons,requestedSeason,true)};
      const update=await api(s,`/api/v3/series/${encodeURIComponent(existing.id)}`,'PUT',updated);
      if(update.status<200||update.status>=300)throw new Error(`Sonarr could not monitor Season ${requestedSeason}: ${arrError(update.data)}`);
      arrId=existing.id;
    } else {
      const cfg=await settings(s); if(!cfg.rootFolderPath) throw new Error(`No root folder configured in ${s.label}`);
      const body={title:item.title,tvdbId:item.tvdbId,year:item.year,qualityProfileId:cfg.qualityProfileId,rootFolderPath:cfg.rootFolderPath,monitored:true,seasons:seasonList(item.seasons,requestedSeason,false),seasonFolder:true,addOptions:{searchForMissingEpisodes:false}};
      const added=await api(s,'/api/v3/series','POST',body);
      if(added.status<200||added.status>=300){console.error(`ARR request rejected by ${s.label} (${added.status}): ${arrError(added.data)}`);throw new Error(`${s.label} rejected the request: ${arrError(added.data)}`);}
      arrId=added.data?.id||null;
    }
    const command=await api(s,'/api/v3/command','POST',{name:'SeasonSearch',seriesId:arrId,seasonNumber:requestedSeason});
    if(command.status<200||command.status>=300)throw new Error(`Sonarr is monitoring Season ${requestedSeason}, but could not start its missing-episode search: ${arrError(command.data)}`);
    saveRequest({title:item.title,service:s.label,createdAt:new Date().toISOString(),status:'accepted',arrId,requestedSeason,seasonNumber:requestedSeason,requestedBy:requester?.id||null,requestedByName:requester?.displayName||requester?.username||null});
    return {ok:true,accepted:true,title:item.title,service:s.label,arrId,seasonNumber:requestedSeason,seasonSearchStarted:true,message:`Season ${requestedSeason} is being monitored and Sonarr is searching for its missing episodes.`};
  }

  const cfg=await settings(s); if(!cfg.rootFolderPath) throw new Error(`No root folder configured in ${s.label}`);
  const body=s.type==='series' ? {title:item.title,tvdbId:item.tvdbId,year:item.year,qualityProfileId:cfg.qualityProfileId,rootFolderPath:cfg.rootFolderPath,monitored:true,seasonFolder:true,addOptions:{searchForMissingEpisodes:runtimeSettings.autoSearch!==false}} : {title:item.title,tmdbId:item.tmdbId,year:item.year,qualityProfileId:cfg.qualityProfileId,rootFolderPath:cfg.rootFolderPath,monitored:true,addOptions:{searchForMovie:runtimeSettings.autoSearch!==false}};
  const r=await api(s, `/api/v3/${s.type}`, 'POST', body); if(r.status<200||r.status>=300) { const detail=arrError(r.data); console.error(`ARR request rejected by ${s.label} (${r.status}): ${detail}`); throw new Error(`${s.label} rejected the request: ${detail}`); }
  saveRequest({title:item.title,service:s.label,createdAt:new Date().toISOString(),status:'accepted',arrId:r.data?.id||null,requestedBy:requester?.id||null,requestedByName:requester?.displayName||requester?.username||null}); return {ok:true,accepted:true,title:item.title,service:s.label,arrId:r.data?.id||null,profile:cfg.qualityProfileName};
}
async function downloadAction(id, action, expected=null) {
  const snap=await downloadSnapshot(); const item=snap.rows.find(x=>x.id===id); if(!item) throw new Error('Download no longer exists');
  if(expected&&(item.serviceId!==expected.serviceId||String(item.arrId)!==String(expected.arrId)||String(item.hash)!==String(expected.hash)||item.title!==expected.title))throw new Error('The download changed after confirmation. Refresh before trying again.');
  if(!item.hash) throw new Error('The download client has not reported this release yet. Refresh and try again.');
  if(action==='recheck') { const r=await qbit('/api/v2/torrents/recheck','POST',formEncode({hashes:item.hash})); if(r.status<200||r.status>=300) throw new Error('qBittorrent could not recheck this download.'); return {ok:true,message:'Recheck started.'}; }
  if(action==='remove') { const r=await qbit('/api/v2/torrents/delete','POST',formEncode({hashes:item.hash,deleteFiles:'false'})); if(r.status<200||r.status>=300) throw new Error('qBittorrent could not remove this release.'); return {ok:true,message:'Release removed from the queue.'}; }
  if(action==='refetch') {
    if(item.serviceId==='qbit') { const r=await qbit('/api/v2/torrents/delete','POST',formEncode({hashes:item.hash,deleteFiles:'false'})); if(r.status<200||r.status>=300) throw new Error('qBittorrent could not remove this release.'); return {ok:true,message:'Release removed. Use the request page to search again.'}; }
    const s=services[item.serviceId]; const del=await api(s,`/api/v3/queue/${encodeURIComponent(item.arrId||item.id.split('-').pop())}?removeFromClient=true&blocklist=true&skipRedownload=false`,'DELETE'); if(del.status<200||del.status>=300) throw new Error('ARR could not remove this release from its queue.');
    const command=s.type==='series'?{name:'MissingEpisodeSearch',episodeIds:item.episodeId?[item.episodeId]:[]}:{name:'MoviesSearch',movieIds:item.movieId?[item.movieId]:[]}; const c=await api(s,'/api/v3/command','POST',command); if(c.status<200||c.status>=300) throw new Error('Release removed, but ARR could not start a replacement search.'); return {ok:true,message:'Removed and searching for another release.'};
  }
  throw new Error('Unknown download action');
}
function authorized(req) { if(!ACCESS_CODE) return true; return req.headers['x-provisionarr-code'] === ACCESS_CODE || req.headers['x-arr-home-code'] === ACCESS_CODE || (req.headers.cookie||'').includes(`provisionarr_access=${encodeURIComponent(ACCESS_CODE)}`) || (req.headers.cookie||'').includes(`arr_home=${encodeURIComponent(ACCESS_CODE)}`); }
async function route(req,res,pathname,query) {
  if(!authorized(req)) return json(res,401,{error:'Access code required'});
  const rateBucket=pathname.startsWith('/api/images/')?'images':req.method==='GET'?'read':'write',rateLimit=rateBucket==='images'?1200:rateBucket==='read'?600:120;
  if(limited(req,rateBucket,rateLimit)) return json(res,429,{error:'Provisionarr is busy. Please wait a moment and try again.',code:'RATE_LIMITED'},{'retry-after':'60'});
  if(pathname==='/api/bootstrap'&&req.method==='GET'){const s=sessionFor(req),users=loadUsers();return json(res,200,{appName:runtimeSettings.appName,adminConfigured:users.some(x=>x.role==='owner'),authenticated:Boolean(s),ownerAuthenticated:s?.role==='owner',...(s?.role==='owner'?{setupMode:runtimeSettings.setupMode||''}:{}),user:safeUser(s?.user),csrf:s?.csrf||null});}
  if(pathname==='/api/admin/setup'&&req.method==='POST'){if(loadUsers().some(x=>x.role==='owner'))return json(res,409,{error:'Owner account is already configured.'});if(limited(req,'owner-setup',5,15*60*1000))return json(res,429,{error:'Too many setup attempts.'});const body=await readBody(req),provided=String(body.setupToken||''),expected=OWNER_SETUP_TOKEN;const ok=provided.length===expected.length&&crypto.timingSafeEqual(Buffer.from(provided),Buffer.from(expected));if(!ok)return json(res,403,{error:'Setup token is incorrect.'});if(String(body.password||'').length<10)return json(res,400,{error:'Use at least 10 characters.'});const username=String(body.username||'owner').toLowerCase().replace(/[^a-z0-9._-]/g,'').slice(0,32)||'owner',record=passwordHash(String(body.password)),owner={id:crypto.randomUUID(),username,displayName:String(body.displayName||'Owner').slice(0,60),email:String(body.email||'').slice(0,160),role:'owner',...record,createdAt:new Date().toISOString(),preferences:{}};saveUsers([owner]);atomicWriteJson(ADMIN_FILE,record);try{fs.unlinkSync(SETUP_TOKEN_FILE)}catch{}const session=newSession(res,owner);audit(req,'owner_setup',{userId:owner.id});return json(res,201,{ok:true,user:safeUser(owner),csrf:session.csrf},{'set-cookie':session.cookie});}
  if((pathname==='/api/auth/login'||pathname==='/api/admin/login')&&req.method==='POST'){if(limited(req,'login',8,15*60*1000))return json(res,429,{error:'Too many login attempts. Try again later.'});const body=await readBody(req),username=String(body.username||'owner').toLowerCase();if(limitedKey(`account:login:${username}`,12,15*60*1000))return json(res,429,{error:'Too many login attempts. Try again later.'});const user=loadUsers().find(x=>x.username.toLowerCase()===username);if(!user||!passwordValid(String(body.password||''),user)){audit(req,'login_failed',{username});return json(res,401,{error:'Username or password is incorrect.'});}const session=newSession(res,user);audit(req,'login',{userId:user.id});return json(res,200,{ok:true,user:safeUser(user),csrf:session.csrf},{'set-cookie':session.cookie});}
  if((pathname==='/api/auth/logout'||pathname==='/api/admin/logout')&&req.method==='POST'){const s=requireUser(req,res,true);if(!s)return;sessions.delete(s.key);saveSessions();audit(req,'logout',{userId:s.user.id});return json(res,200,{ok:true},{'set-cookie':sessionCookie('',0)});}
  if(pathname==='/api/admin/settings'&&req.method==='GET'){if(!requireAdmin(req,res))return;const [tv,movies,mediaUsers]=await Promise.all([api(services.sonarr,'/api/v3/qualityprofile'),api(services.radarr,'/api/v3/qualityprofile'),embyUsers().catch(()=>[])]);return json(res,200,{settings:publicSettings(),profiles:{tv:(tv.data||[]).map(x=>({id:x.id,name:x.name})),movies:(movies.data||[]).map(x=>({id:x.id,name:x.name}))},embyUsers:mediaUsers});}
  if(pathname==='/api/admin/settings'&&req.method==='PUT'){if(!requireAdmin(req,res,true))return;const body=await readBody(req),allowed=['appName','minFreeGb','minFreePercent','movieQualityProfileId','tvQualityProfileId','autoSearch','allowUserRefetch','userAutoApprove','userActiveRequestLimit','pauseRequestsWhenStorageLow','discoveryLimit','notificationsEnabled','notifyAvailable','notifyFailed','notifyDiskLow','smtpHost','smtpPort','smtpSecure','smtpUser','smtpPass','smtpFrom'];const next={...runtimeSettings};for(const key of allowed)if(Object.prototype.hasOwnProperty.call(body,key)&&!(key==='smtpPass'&&body[key]===''))next[key]=body[key];next.appName=String(next.appName||'Provisionarr').slice(0,40);next.minFreeGb=Math.max(1,Math.min(5000,Number(next.minFreeGb)||50));next.minFreePercent=Math.max(1,Math.min(95,Number(next.minFreePercent)||15));next.userActiveRequestLimit=Math.max(1,Math.min(20,Number(next.userActiveRequestLimit)||3));next.discoveryLimit=Math.max(4,Math.min(24,Number(next.discoveryLimit)||12));next.smtpHost=String(next.smtpHost||'').slice(0,253);next.smtpPort=Math.max(1,Math.min(65535,Number(next.smtpPort)||587));next.smtpUser=String(next.smtpUser||'').slice(0,253);next.smtpPass=String(next.smtpPass||'').slice(0,1024);next.smtpFrom=String(next.smtpFrom||'').slice(0,253);saveSettings(next);audit(req,'settings_updated',{fields:Object.keys(body).filter(key=>allowed.includes(key)&&key!=='smtpPass')});return json(res,200,{ok:true,settings:publicSettings()});}
  if(pathname==='/api/admin/orchestration/inventory'&&req.method==='GET'){if(!requireAdmin(req,res))return;return json(res,200,await orchestrationInventory());}
  if(pathname==='/api/admin/orchestration/mode'&&req.method==='PUT'){const s=requireAdmin(req,res,true);if(!s)return;const body=await readBody(req,1024),mode=String(body.mode||'');if(!['existing','managed'].includes(mode))return json(res,400,{error:'Choose an existing stack or a managed stack.'});saveSettings({...runtimeSettings,setupMode:mode});audit(req,'orchestration_mode_selected',{userId:s.user.id,mode});return json(res,200,{ok:true,mode});}
  if(pathname==='/api/admin/installer/compose'&&req.method==='POST'){const s=requireAdmin(req,res,true);if(!s)return;const body=await readBody(req,8192),bundle=stackBundle(body);audit(req,'stack_bundle_generated',{userId:s.user.id,services:['sonarr','radarr','prowlarr','qbittorrent']});return json(res,200,{generatedAt:new Date().toISOString(),bundle});}
  if(/^\/api\/admin\/orchestration\/connections\/(sonarr|radarr|prowlarr)$/.test(pathname)&&req.method==='PUT'){const s=requireAdmin(req,res,true);if(!s)return;const body=await readBody(req,8192);return json(res,200,await updateOrchestrationConnection(req,pathname.split('/').pop(),body,s));}
  if(pathname==='/api/admin/orchestration/connections/qbittorrent'&&req.method==='PUT'){const s=requireAdmin(req,res,true);if(!s)return;const body=await readBody(req,8192);return json(res,200,await updateQbittorrentConnection(req,body,s));}
  if(pathname==='/api/admin/orchestration/bootstrap/plan'&&req.method==='POST'){const s=requireAdmin(req,res,true);if(!s)return;const body=await readBody(req,16384);return json(res,200,await previewBootstrapPlan(body,s));}
  if(/^\/api\/admin\/orchestration\/bootstrap\/plans\/[a-f0-9-]{36}\/apply$/.test(pathname)&&req.method==='POST'){const s=requireAdmin(req,res,true);if(!s)return;return json(res,200,await applyBootstrapPlan(req,pathname.split('/')[6],s));}
  if(pathname==='/api/admin/orchestration/plan'&&req.method==='POST'){const s=requireAdmin(req,res,true);if(!s)return;const body=await readBody(req,32768),snapshot=await currentOrchestrationSnapshot(),plan=arrOrchestrator.preview(body.desired||{},snapshot.current),planId=crypto.randomUUID();setBounded(orchestrationPlans,planId,{plan,resources:snapshot.resources,userId:s.user.id,createdAt:Date.now(),expires:Date.now()+10*60*1000,used:false},MAP_LIMITS.orchestrationPlans);return json(res,200,{generatedAt:new Date().toISOString(),planId,expiresAt:new Date(Date.now()+10*60*1000).toISOString(),canApply:ORCHESTRATION_WRITES_ENABLED,plan});}
  if(/^\/api\/admin\/orchestration\/plans\/[a-f0-9-]{36}\/apply$/.test(pathname)&&req.method==='POST'){const s=requireAdmin(req,res,true);if(!s)return;return json(res,200,await applyOrchestrationPlan(req,pathname.split('/')[5],s));}
  if(pathname==='/api/admin/orchestration/prowlarr/plan'&&req.method==='POST'){const s=requireAdmin(req,res,true);if(!s)return;const body=await readBody(req,8192);return json(res,200,await previewProwlarrLinks(body,s));}
  if(/^\/api\/admin\/orchestration\/prowlarr\/plans\/[a-f0-9-]{36}\/apply$/.test(pathname)&&req.method==='POST'){const s=requireAdmin(req,res,true);if(!s)return;return json(res,200,await applyProwlarrPlan(req,pathname.split('/')[6],s));}
  if(pathname==='/api/admin/orchestration/backups'&&req.method==='GET'){if(!requireAdmin(req,res))return;return json(res,200,{writesEnabled:ORCHESTRATION_WRITES_ENABLED,backups:orchestrationBackups()});}
  if(/^\/api\/admin\/orchestration\/backups\/[a-f0-9-]{36}\/rollback$/.test(pathname)&&req.method==='POST'){const s=requireAdmin(req,res,true);if(!s)return;return json(res,200,await rollbackOrchestrationBackup(req,pathname.split('/')[5],s));}
  if(pathname==='/api/admin/notifications/test'&&req.method==='POST'){const s=requireAdmin(req,res,true);if(!s)return;const target=s.user.email;if(!target)return json(res,400,{error:'Add an email address to the owner account first.'});const result=await sendEmail([target],`${runtimeSettings.appName} test notification`,'Email notifications are configured correctly.');if(!result.sent)return json(res,400,{error:result.reason});audit(req,'notification_test_sent',{userId:s.user.id});return json(res,200,{ok:true,message:`Test email sent to ${target}.`});}
  if(pathname==='/api/admin/overview'&&req.method==='GET'){if(!requireAdmin(req,res))return;return json(res,200,await adminOverview());}
  if(pathname==='/api/admin/diagnostics'&&req.method==='GET'){if(!requireAdmin(req,res))return;return json(res,200,diagnostics());}
  if(pathname==='/api/admin/logs'&&req.method==='GET'){if(!requireAdmin(req,res))return;return json(res,200,{entries:auditEntries(Number(query.limit)||100)});}
  if(pathname==='/api/admin/users'&&req.method==='GET'){if(!requireAdmin(req,res))return;return json(res,200,{users:loadUsers().map(safeUser)});}
  if(pathname==='/api/admin/users'&&req.method==='POST'){if(!requireAdmin(req,res,true))return;const body=await readBody(req),users=loadUsers(),username=String(body.username||'').toLowerCase().replace(/[^a-z0-9._-]/g,'').slice(0,32);if(username.length<2)return json(res,400,{error:'Username must be at least 2 characters.'});if(users.some(x=>x.username===username))return json(res,409,{error:'That username already exists.'});if(String(body.password||'').length<10)return json(res,400,{error:'Use at least 10 characters.'});const user={id:crypto.randomUUID(),username,displayName:String(body.displayName||username).slice(0,60),email:String(body.email||'').slice(0,160),role:'user',...passwordHash(String(body.password)),createdAt:new Date().toISOString(),preferences:{notifications:true}};users.push(user);saveUsers(users);audit(req,'user_created',{userId:user.id});return json(res,201,{user:safeUser(user)});}
  if(/^\/api\/admin\/users\/[^/]+$/.test(pathname)&&req.method==='PATCH'){const s=requireAdmin(req,res,true);if(!s)return;const id=pathname.split('/').pop(),body=await readBody(req),users=loadUsers(),target=users.find(x=>x.id===id);if(!target)return json(res,404,{error:'User not found.'});const embyUserId=String(body.embyUserId||'');if(embyUserId){const available=await embyUsers();if(!available.some(user=>user.id===embyUserId))return json(res,400,{error:'That Emby profile is no longer available.'});}target.preferences={...(target.preferences||{}),embyUserId};saveUsers(users);for(const key of responseCache.keys())if(key.startsWith(`discover:${target.id}:`))responseCache.delete(key);audit(req,'user_emby_mapping_updated',{userId:target.id,linked:Boolean(embyUserId),changedBy:s.user.id});return json(res,200,{user:safeUser(target)});}
  if(/^\/api\/admin\/users\/[^/]+$/.test(pathname)&&req.method==='DELETE'){if(!requireAdmin(req,res,true))return;const id=pathname.split('/').pop(),users=loadUsers(),target=users.find(x=>x.id===id);if(!target)return json(res,404,{error:'User not found.'});if(target.role==='owner')return json(res,400,{error:'The owner account cannot be deleted.'});saveUsers(users.filter(x=>x.id!==id));for(const [key,s] of sessions)if(s.userId===id)sessions.delete(key);saveSessions();audit(req,'user_deleted',{userId:id});return json(res,200,{ok:true});}
  if(/^\/api\/admin\/requests\/[^/]+\/approve$/.test(pathname)&&req.method==='POST'){const s=requireAdmin(req,res,true);if(!s)return;const id=pathname.split('/')[4],records=loadRequests(),pending=records.find(x=>x.id===id&&x.status==='pending_approval');if(!pending||!pending.requestItem)return json(res,404,{error:'Pending request not found.'});const requester=loadUsers().find(x=>x.id===pending.requestedBy)||s.user;const result=await createRequest(pending.requestItem,requester,id);writeRequests(loadRequests().filter(x=>x.id!==id));audit(req,'pending_request_approved',{requestId:id,title:pending.title,userId:requester.id});return json(res,200,result);}
  if(pathname==='/api/account'&&req.method==='PUT'){const s=requireUser(req,res,true);if(!s)return;const body=await readBody(req,400*1024),users=loadUsers(),user=users.find(x=>x.id===s.user.id),preferences=body.preferences&&typeof body.preferences==='object'?body.preferences:{};user.displayName=String(body.displayName??user.displayName).slice(0,60);user.email=String(body.email??user.email??'').slice(0,160);user.avatar=sanitizeAvatar(body.avatar,user.avatar||'');user.preferences={...(user.preferences||{}),notifications:preferences.notifications!==false};saveUsers(users);audit(req,'account_updated',{userId:user.id});return json(res,200,{user:safeUser(user)});}
  if((pathname==='/api/account/password'||pathname==='/api/admin/password')&&req.method==='PUT'){const s=requireUser(req,res,true);if(!s)return;const body=await readBody(req),users=loadUsers(),user=users.find(x=>x.id===s.user.id);if(!passwordValid(String(body.currentPassword||''),user))return json(res,403,{error:'Current password is incorrect.'});if(String(body.newPassword||'').length<10)return json(res,400,{error:'Use at least 10 characters.'});Object.assign(user,passwordHash(String(body.newPassword)));saveUsers(users);if(user.role==='owner')atomicWriteJson(ADMIN_FILE,{salt:user.salt,hash:user.hash});for(const [key,session] of sessions)if(session.userId===user.id)sessions.delete(key);saveSessions();audit(req,'password_changed',{userId:user.id});return json(res,200,{ok:true},{'set-cookie':sessionCookie('',0)});}
  if(pathname==='/api/discover'&&req.method==='GET'){const s=requireUser(req,res);if(!s)return;return json(res,200,await discover(s.user));}
  if(pathname==='/api/search'&&req.method==='GET'){if(!requireUser(req,res))return;return json(res,200,{results:query.q?(await search(query.q.trim().slice(0,200))).map(mediaCard):[]});}
  if(pathname==='/api/library'&&req.method==='GET'){if(!requireUser(req,res))return;return json(res,200,await embyLibrary());}
  if(/^\/api\/images\/emby\/[^/]+$/.test(pathname)&&req.method==='GET'){if(!requireUser(req,res))return;return proxyEmbyImage(req,res,decodeURIComponent(pathname.split('/').pop()));}
  if(pathname==='/api/downloads' && req.method==='GET'){if(!requireAdmin(req,res))return;return json(res,200,publicDownloads(await downloadSnapshot()));}
  if(pathname.startsWith('/api/downloads/') && req.method==='POST') { const parts=pathname.split('/').filter(Boolean),s=requireAdmin(req,res,true);if(!s)return;if(parts[3]!=='recheck')return json(res,400,{error:'This action requires a fresh confirmation.'});const result=await downloadAction(parts[2],parts[3]);audit(req,`download_${parts[3]}`,{id:parts[2],userId:s.user.id});return json(res,200,result); }
  if(pathname==='/api/activity' && req.method==='GET'){if(!requireAdmin(req,res))return;return json(res,200,await activity());}
  if(pathname==='/api/proposals'&&req.method==='POST'){const s=requireUser(req,res,true);if(!s)return;const body=await readBody(req);if(body.downloadId){if(s.role!=='owner')return json(res,403,{error:'Owner access required.'});return json(res,201,{proposal:await rejectionProposal(String(body.downloadId),s.user.id)});}return json(res,201,{proposal:proposalFor(req,String(body.mediaRef||''),s.user.id)});}
  if(/^\/api\/proposals\/[^/]+\/confirm$/.test(pathname)&&req.method==='POST'){const s=requireUser(req,res,true);if(!s)return;const id=pathname.split('/')[3];return json(res,201,await confirmProposal(req,id,s.user));}
  if(/^\/api\/proposals\/[^/]+\/cancel$/.test(pathname)&&req.method==='POST'){const s=requireUser(req,res,true);if(!s)return;const id=pathname.split('/')[3],p=pendingActions.get(id);if(p&&p.userId===s.user.id){p.used=true;audit(req,'proposal_cancelled',{title:p.item.title,userId:s.user.id});}return json(res,200,{ok:true});}
  if(pathname==='/api/health'&&req.method==='GET'){const s=requireUser(req,res);if(!s)return;const full=await health();if(s.role==='owner')return json(res,200,full);const needsAttention=Boolean(full.alerts.length||full.disk.low);return json(res,200,{checkedAt:full.checkedAt,needsAttention,message:needsAttention?USER_ATTENTION_MESSAGE:'Everything is working normally.'});}
  if(pathname==='/api/integration'&&req.method==='GET'){if(!requireAdmin(req,res))return;return json(res,200,await integrationStatus());}
  if(/^\/api\/requests\/[^/]+$/.test(pathname)&&req.method==='DELETE'){const s=requireUser(req,res,true);if(!s)return;const id=pathname.split('/').pop(),records=loadRequests(),target=records.find(x=>x.id===id);if(!target)return json(res,404,{error:'Request not found.'});if(s.role!=='owner'&&target.requestedBy!==s.user.id)return json(res,403,{error:'You can only manage your own requests.'});if(target.status!=='pending_approval')return json(res,409,{error:'Only requests that are still waiting can be cancelled.'});writeRequests(records.filter(x=>x.id!==id));audit(req,'pending_request_cancelled',{requestId:id,title:target.title,userId:s.user.id});return json(res,200,{ok:true});}
  if(pathname==='/api/requests') { const s=requireUser(req,res,req.method==='POST');if(!s)return;if(req.method==='POST'){const body=await readBody(req),ref=mediaRefs.get(String(body.mediaRef||''));if(!ref||ref.expires<Date.now())return json(res,400,{error:'That search result expired. Search again.'});const result=await submitRequest(req,ref.item,s.user);return json(res,result.pendingApproval?202:201,result);}const requests=await requestHistory(),visible=s.role==='owner'?requests:requests.filter(x=>x.requestedBy===s.user.id),limit=Math.max(1,Number(runtimeSettings.userActiveRequestLimit)||3),active=visible.filter(x=>!['available','failed','error'].includes(String(x.displayStatus||x.status))).length;return json(res,200,{requests:visible,summary:{total:visible.length,active,ready:visible.filter(x=>x.displayStatus==='available').length,needsAttention:visible.filter(x=>x.displayStatus==='failed').length,limit:s.role==='owner'?null:limit,remaining:s.role==='owner'?null:Math.max(0,limit-active),storagePaused:Boolean(runtimeSettings.pauseRequestsWhenStorageLow!==false&&diskStatus().low)}}); }
  if(pathname==='/api/notifications'&&req.method==='GET'){const s=requireUser(req,res);if(!s)return;const items=notificationInbox(s.user.id,query.limit);return json(res,200,{supported:true,notifications:items,unread:items.filter(x=>!x.read).length});}
  if(pathname==='/api/notifications/read'&&req.method==='POST'){const s=requireUser(req,res,true);if(!s)return;const body=await readBody(req),ids=new Set(Array.isArray(body.ids)?body.ids.map(String):[]),all=body.all===true,state=loadJson(NOTIFICATION_STATE_FILE,{items:{},diskLow:false,notifications:[]});for(const item of state.notifications||[])if(item.userId===s.user.id&&(all||ids.has(String(item.id))))item.read=true;saveNotificationState(state);return json(res,200,{ok:true,unread:notificationInbox(s.user.id).filter(x=>!x.read).length});}
  if(pathname.startsWith('/api/'))return json(res,405,{error:'Method not allowed'});
  res.writeHead(404); res.end('Not found');
}
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
function routeError(req,res,error) { if(res.headersSent||res.writableEnded)return;const status=Number(error.statusCode)||(error.code==='BODY_TOO_LARGE'?413:error.code==='BODY_TIMEOUT'?408:400),s=sessionFor(req),extra=error.closeConnection?{'connection':'close'}:{};if(error.closeConnection)res.once('finish',()=>req.destroy());json(res,status,{error:s&&s.role!=='owner'?USER_ATTENTION_MESSAGE:error.message,...(error.code?{code:error.code}:{})},extra); }
function resolvePublicFile(pathname) { const requested=pathname==='/'?'index.html':String(pathname||'').replace(/^\/+/,''),file=path.resolve(PUBLIC_ROOT,requested),relative=path.relative(PUBLIC_ROOT,file);return relative.startsWith('..')||path.isAbsolute(relative)?null:file; }
const server=http.createServer((req,res)=>{const parsed=url.parse(req.url,true);if(parsed.pathname.startsWith('/api/'))return route(req,res,parsed.pathname,parsed.query).catch(e=>routeError(req,res,e));const file=resolvePublicFile(parsed.pathname);if(!file)return json(res,403,{error:'Forbidden'});fs.readFile(file,(err,data)=>{if(err){res.writeHead(404,securityHeaders);return res.end('Not found');}res.writeHead(200,{...securityHeaders,'content-security-policy':"default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",'cache-control':'no-cache','content-type':mime[path.extname(file)]||'application/octet-stream'});res.end(data);});});
server.headersTimeout=Math.min(REQUEST_TIMEOUT_MS,10000);
server.requestTimeout=REQUEST_TIMEOUT_MS;
server.keepAliveTimeout=5000;
if (require.main === module) {
  server.listen(PORT,LISTEN_HOST,()=>{console.log(`Provisionarr listening on http://${LISTEN_HOST}:${PORT}`);const first=setTimeout(checkNotifications,30000);first.unref();const monitor=setInterval(checkNotifications,5*60*1000);monitor.unref();const cleanup=setInterval(cleanupTransientState,60*1000);cleanup.unref();});
}

module.exports = {parseMediaQuery, normalizeTitle, canonicalTitle, mediaMatchScore, rankMediaResults, seasonDetails, seasonList, search, sanitizeAvatar, resolvePublicFile, upstreamTransport};
