'use strict';

function connectionError(message, code) {
  return Object.assign(new Error(message), {statusCode:400, code});
}

function assertSafeConnectionHost(hostname) {
  const host=String(hostname||'').trim().toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
  if(!host)throw connectionError('Enter a valid service host.','CONNECTION_HOST_INVALID');
  if(host==='metadata.google.internal'||host.endsWith('.metadata.google.internal'))throw connectionError('That service host is reserved and cannot be used.','CONNECTION_HOST_BLOCKED');
  if(/^\d+\.\d+\.\d+\.\d+$/.test(host)){
    const parts=host.split('.').map(Number);
    if(parts.some(part=>part<0||part>255)||parts[0]===0||(parts[0]===169&&parts[1]===254)||parts[0]>=224)throw connectionError('That service host is reserved and cannot be used.','CONNECTION_HOST_BLOCKED');
  }
  if(host==='::'||/^fe[89ab][0-9a-f]:/i.test(host)||host.startsWith('ff'))throw connectionError('That service host is reserved and cannot be used.','CONNECTION_HOST_BLOCKED');
  return host;
}

function normalizeOrchestrationUrl(value) {
  const raw=String(value||'').trim();
  if(!raw||raw.length>2048)throw connectionError('Enter a valid service URL.','CONNECTION_URL_INVALID');
  let target;
  try{target=new URL(raw);}catch{throw connectionError('Enter a complete HTTP or HTTPS URL.','CONNECTION_URL_INVALID');}
  if(!['http:','https:'].includes(target.protocol)||!target.hostname)throw connectionError('The service URL must use HTTP or HTTPS.','CONNECTION_URL_INVALID');
  if(target.username||target.password||target.search||target.hash)throw connectionError('The service URL cannot contain credentials, query text, or a fragment.','CONNECTION_URL_INVALID');
  assertSafeConnectionHost(target.hostname);
  const pathname=target.pathname.replace(/\/+$/,'');
  return `${target.origin}${pathname==='/'?'':pathname}`;
}

function normalizeOrchestrationKey(value) {
  const key=String(value||'').trim();
  if(key.length<8||key.length>256||/[\s\x00-\x1f\x7f]/.test(key))throw connectionError('Enter the API key shown by the service.','CONNECTION_KEY_INVALID');
  return key;
}

function normalizeQbittorrentUsername(value) {
  const username=String(value||'').trim();
  if(!username||username.length>128||/[\x00-\x1f\x7f]/.test(username))throw connectionError('Enter the qBittorrent username.','CONNECTION_USERNAME_INVALID');
  return username;
}

function normalizeQbittorrentPassword(value) {
  const password=String(value??'');
  if(!password.trim()||password.length>512||/[\x00-\x1f\x7f]/.test(password))throw connectionError('Enter the qBittorrent password.','CONNECTION_PASSWORD_INVALID');
  return password;
}

function orchestrationTarget(base, endpoint) {
  const target=new URL(base), relative=new URL(endpoint,'http://provisionarr.invalid');
  const prefix=target.pathname.replace(/\/+$/,'');
  target.pathname=`${prefix}${relative.pathname.startsWith('/')?relative.pathname:`/${relative.pathname}`}`;
  target.search=relative.search;
  target.hash='';
  return target;
}

module.exports=Object.freeze({assertSafeConnectionHost,normalizeOrchestrationUrl,normalizeOrchestrationKey,normalizeQbittorrentUsername,normalizeQbittorrentPassword,orchestrationTarget});
