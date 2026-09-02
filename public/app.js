const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

let bootstrap = {authenticated:false, ownerAuthenticated:false, adminConfigured:false, csrf:null, user:null, appName:'Provisionarr', setupMode:''};
let healthCache = null;
let activeItem = null;
let lastAlertIds = new Set();
let routeGeneration = 0;
let routeTimer = null;
let guidedSetupState = {step:1, values:{}, inventory:null};
const guidedSetupCompletionKey = 'provisionarr-guided-setup-complete';

async function api(path, options = {}) {
  const headers = {...(options.body ? {'content-type':'application/json'} : {}), ...(options.headers || {})};
  if (options.method && options.method !== 'GET' && bootstrap.csrf) headers['x-csrf-token'] = bootstrap.csrf;
  const response = await fetch(path, {...options, headers});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) showToast('Sign in to continue.');
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = data.code || '';
    error.retryAfter = Number(response.headers.get('retry-after')) || 0;
    throw error;
  }
  return data;
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3800);
}

function friendlyFailure() {
  return 'Something needs attention. Please contact your system administrator.';
}

function errorPanel(message, retry = '') {
  return `<section class="error-panel"><small>COULDN’T LOAD THIS</small><h2>Let’s try that again.</h2><p>${esc(message)}</p>${retry ? `<button class="secondary" data-retry="${esc(retry)}" type="button">Try again</button>` : ''}</section>`;
}

function bindRetry() { $$('[data-retry]').forEach(button => button.onclick = () => { location.hash = button.dataset.retry; route(); }); }

function friendlyStatus(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'available') return 'Ready to watch';
  if (value === 'downloading') return 'Getting it ready';
  if (value === 'importing' || value === 'queued') return 'Getting it ready';
  if (value === 'failed' || value === 'error') return 'Needs attention';
  if (value === 'pending_approval') return 'Waiting for approval';
  if (value === 'waiting' || value === 'requested') return 'Requested';
  return 'Requested';
}

function ownerOnly(path) {
  if (bootstrap.ownerAuthenticated) return true;
  $('#page').innerHTML = `<section class="page-heading"><div><small>OWNER ACCESS</small><h1>Admin area</h1><p>${bootstrap.authenticated ? 'This area is reserved for the system administrator.' : 'Sign in with the administrator account to continue.'}</p></div></section>${bootstrap.authenticated ? '<section class="auth-card"><h2>System administrator access required</h2><p>Please contact your system administrator for help.</p></section>' : loginPanel('Sign in with your account to continue.')}`;
  if (!bootstrap.authenticated) bindLogin();
  return false;
}

async function loadBootstrap() {
  bootstrap = await api('/api/bootstrap');
  bootstrap.ownerAuthenticated = Boolean(bootstrap.authenticated && bootstrap.user?.role === 'owner');
  document.title = bootstrap.appName || 'Provisionarr';
  $('#brand-name').textContent = bootstrap.appName || 'Provisionarr';
  const accountLabel = bootstrap.authenticated ? (bootstrap.user.displayName || bootstrap.user.username) : 'Sign in';
  $('#account').textContent = accountLabel;
  $('#account').title = accountLabel;
  setNavVisibility();
  if (bootstrap.authenticated) refreshNotificationCount();
  return bootstrap;
}

async function refreshNotificationCount() {
  const badge = $('#notification-count');
  if (!badge || !bootstrap.authenticated) return;
  try { const data = await api('/api/notifications?limit=200'); const count = Number(data.unread || 0); badge.textContent = count > 99 ? '99+' : String(count); badge.hidden = count === 0; } catch { badge.hidden = true; }
}

function setNavVisibility() {
  $$('[data-audience]').forEach(element => {
    const visible = element.dataset.audience === 'all' || bootstrap.ownerAuthenticated || (!bootstrap.adminConfigured && element.dataset.route === 'settings');
    element.hidden = !visible;
  });
  const current = (location.hash.match(/^#\/([^?]+)/) || [,'home'])[1];
  $$('[data-route]').forEach(link => link.classList.toggle('active', link.dataset.route === current));
}

function poster(item, className = '') {
  const availability=item.availability==='library_or_monitored'?'In library':item.availability==='can_request'?'Request':'View';
  return `<button class="poster ${className}" type="button" data-item='${esc(JSON.stringify(item))}' aria-label="View ${esc(item.title)}">
    ${item.poster ? `<img src="${esc(item.poster)}" alt="${esc(item.title)} poster" loading="lazy">` : '<div class="poster-empty" aria-hidden="true">No artwork</div>'}
    <span class="poster-badge">${esc(availability)}</span><div class="poster-copy"><h3>${esc(item.title)}</h3><p>${esc(item.year || '')}${item.mediaType ? ` · ${esc(item.mediaType)}` : ''}</p></div>
  </button>`;
}

function bindPosters() {
  $$('.poster').forEach(card => {
    const open = () => openDetails(JSON.parse(card.dataset.item));
    card.onclick = open;
  });
}

function renderRail(items, className = '') {
  return items?.length ? items.map(item => poster(item, className)).join('') : '<div class="empty">Nothing here yet.</div>';
}

function mediaCategory(item) {
  const type=String(item?.mediaType || '').toLowerCase();
  if(type==='movie' || item?.serviceId==='radarr')return 'movie';
  if(['series','show','tv'].includes(type) || item?.serviceId==='sonarr')return 'series';
  return '';
}

function splitMedia(items) {
  return (items || []).reduce((groups,item)=>{
    const category=mediaCategory(item);
    if(category)groups[category].push(item);
    return groups;
  },{movie:[],series:[]});
}

function discoveryCategory(title, type, sources) {
  const rows=sources.map(source=>{
    const items=splitMedia(source.items)[type];
    if(!items.length)return '';
    return `<section class="media-category-row"><div class="section-title"><h3>${esc(source.label)}</h3><span class="section-icon">${esc(source.icon)}</span></div><div class="poster-rail">${renderRail(items)}</div></section>`;
  }).filter(Boolean).join('');
  return `<section class="media-category"><div class="media-category-heading"><small>DISCOVER</small><h2>${esc(title)}</h2></div>${rows || '<div class="empty">Nothing here yet.</div>'}</section>`;
}

function searchCategory(title, items) {
  return `<section class="media-category search-category"><div class="media-category-heading"><h2>${esc(title)}</h2><span>${items.length} ${items.length===1?'match':'matches'}</span></div><div class="poster-grid">${renderRail(items)}</div></section>`;
}

function uniqueItems(items) {
  return [...new Map((items || []).filter(item => item && item.title).map(item => [`${item.serviceId || ''}-${item.arrId || item.id || item.title}`, item])).values()];
}

function normalizeTitle(value) {
  return String(value || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

function searchIntent(raw) {
  const match = String(raw || '').match(/\bseason\s*(\d+)\b|\bs(\d+)\b/i);
  const season = match ? Number(match[1] || match[2]) : null;
  const title = String(raw || '').replace(/\bseason\s*\d+\b|\bs\d+\b/ig, '').replace(/\b(movie|movies|show|series|tv)\b/ig, '').replace(/[?!.,]+/g, ' ').replace(/\s+/g, ' ').trim();
  return {title, season};
}

function searchQueries(intent) {
  return [intent.title].filter(Boolean);
}

function rankSearchResults(results, raw) {
  const intent = searchIntent(raw);
  const wanted = normalizeTitle(intent.title);
  if (!wanted) return [];
  const tokens = intent.title.toLowerCase().split(/\s+/).filter(Boolean);
  const ranked=(results || []).map(item => {
    const title = normalizeTitle(item.title);
    const rawTitle = String(item.title || '').toLowerCase();
    let score = 0;
    if (title === wanted) score += 100;
    if (title.includes(wanted) || wanted.includes(title)) score += 60;
    if (tokens.every(token => rawTitle.includes(token))) score += 35;
    score += tokens.filter(token => rawTitle.includes(token)).length * 8;
    if (item.serviceId === 'sonarr' && intent.season) score += 5;
    return {...item, searchScore:score, exactTitle:title===wanted, requestedSeason:intent.season};
  }).filter(item => item.searchScore >= Math.max(18, tokens.length * 8)).sort((a,b) => b.searchScore - a.searchScore);
  return (ranked.some(item=>item.exactTitle)?ranked.filter(item=>item.exactTitle):ranked).slice(0,24);
}

function openDetails(item) {
  activeItem = item;
  const requestable = Boolean(item.mediaRef || item.canRequest);
  const seasonNumber = item.seasonNumber || item.requestedSeason;
  const season = seasonNumber ? ` · Season ${seasonNumber}` : '';
  $('#details-body').innerHTML = `<div class="details">
    ${item.poster ? `<img src="${esc(item.poster)}" alt="${esc(item.title)} poster">` : '<div class="poster-placeholder">No artwork</div>'}
    <div><small>${esc(item.mediaType || (item.serviceId === 'sonarr' ? 'Series' : 'Movie'))}${item.year ? ` · ${esc(item.year)}` : ''}${season}</small>
      <h2>${esc(item.title)}</h2><p>${esc(item.overview || 'No description available.')}</p>
      ${requestable ? `<button class="request-button" id="request-now">${bootstrap.ownerAuthenticated ? 'Download now' : 'Request download'}</button>` : '<p class="safe-note">This title is already in the media plan or library.</p>'}
    </div></div>`;
  $('#details').showModal();
  if (requestable) $('#request-now').onclick = () => item.mediaRef ? prepareMediaProposal(item.mediaRef, item) : findRequestOptions(item);
}

async function findRequestOptions(item) {
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(item.title)}`);
    const result = rankSearchResults(data.results, item.title)[0];
    if (!result?.mediaRef) throw new Error('That title is not available to request right now.');
    $('#details').close();
    prepareMediaProposal(result.mediaRef, result);
  } catch (error) { showToast(error.message); }
}

async function prepareMediaProposal(mediaRef, item = activeItem) {
  if (!bootstrap.authenticated) return goSignIn('Sign in before requesting a title.');
  $('#details').close();
  showProposal({mediaRef, title:item?.title || 'this title'});
}

function showProposal(proposal) {
  $('#confirm-body').innerHTML = `<section class="confirm-card">
    <small>REQUEST CONFIRMATION</small>
    <h2>${bootstrap.ownerAuthenticated ? 'Download' : 'Request'} “${esc(proposal.title)}”?</h2>
    <p>${bootstrap.ownerAuthenticated ? 'Provisionarr will apply your saved Sonarr or Radarr defaults and start searching.' : 'Your request will start automatically while storage and your request allotment allow it. If capacity is tight, it will wait for the system administrator.'}</p>
    <div class="storage-guidance">Provisionarr is a privately operated library with finite storage. Some titles or releases may be unavailable.</div>
    <div class="confirm-actions"><button class="request-button" id="confirm-action">${bootstrap.ownerAuthenticated ? 'Download now' : 'Request download'}</button><button class="secondary" id="cancel-action">Cancel</button></div>
  </section>`;
  $('#confirm-dialog').showModal();
  $('#confirm-action').onclick = async () => {
    $('#confirm-action').disabled = true;
    try {
      const result = await api('/api/requests', {method:'POST', body:JSON.stringify({mediaRef:proposal.mediaRef})});
      $('#confirm-dialog').close();
      showToast(result.message || `${result.title} was requested.`);
      if (location.hash.startsWith('#/requests')) setTimeout(renderRequests, 500);
    } catch (error) { $('#confirm-action').disabled = false; showToast(error.message); }
  };
  $('#cancel-action').onclick = async () => {
    $('#confirm-dialog').close();
  };
}

function searchBox() {
  return '<div class="searchbox"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m21 21-4.3-4.3m2.3-5.2a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z"/></svg><label class="sr-only" for="query">Search movies and shows</label><input id="query" placeholder="Search movies and shows" autocomplete="off"><button id="go" type="button">Search</button></div>';
}

function bindSearch() {
  const go = () => { const query = $('#query').value.trim(); if (query) location.hash = `#/search?query=${encodeURIComponent(query)}`; };
  $('#go').onclick = go;
  $('#query').onkeydown = event => { if (event.key === 'Enter') go(); };
}

async function renderHome() {
  const displayName = bootstrap.user?.displayName || bootstrap.user?.username || '';
  const generation=routeGeneration;
  $('#page').innerHTML = `<section class="hero"><div class="intro">${displayName ? `<small class="welcome">Welcome, ${esc(displayName)}</small>` : ''}<h1>What do you want to watch?</h1>${searchBox()}<p>Search once. Provisionarr handles the complicated parts.</p></div><div class="featured"><div class="feature-copy"><small>CURATED FOR YOUR LIBRARY</small><h2>Your next favorite is waiting.</h2><p>Browse personal recommendations, current favorites, and new releases. Request a title in two clicks.</p><a class="primary" href="#/search">Explore everything <b>›</b></a></div></div></section><div id="discover-catalog" class="discover-catalog"><div class="empty">Loading recommendations…</div></div>`;
  bindSearch();
  try {
    const data = await api('/api/discover');
    if(generation!==routeGeneration)return;
    const sources=[
      {label:'Inspired by your library',icon:'✦',items:data.inspired || []},
      {label:'Trending now',icon:'↗',items:data.trending || []},
      {label:'Popular',icon:'★',items:data.popular || []},
      {label:'New releases',icon:'＋',items:data.newReleases || []}
    ];
    $('#discover-catalog').innerHTML=discoveryCategory('Movies','movie',sources)+discoveryCategory('TV shows','series',sources);
    bindPosters();
  } catch (error) {
    if(generation!==routeGeneration)return;
    $('#discover-catalog').innerHTML = errorPanel(error.message, '#/home');
    bindRetry();
  }
}

async function renderSearch(query = '') {
  const generation=routeGeneration;
  const intent = searchIntent(query);
  $('#page').innerHTML = `<section class="page-heading"><div><small>DISCOVER</small><h1>Find something to watch</h1><p>Search by title. Add a season when you want a specific season of a show.</p></div>${searchBox()}</section><section class="section"><div class="section-title"><h2>${query ? `Closest matches for “${esc(query)}”` : 'Search results'}</h2></div><p class="search-note">${intent.season ? `Season ${intent.season} is used to find the show. The connected service applies its normal request defaults.` : 'Only close title matches are shown so unrelated results stay out of the way.'}</p><div id="search-categories"><div class="empty">Type a title above to begin.</div></div></section>`;
  bindSearch();
  if (!query) return;
  $('#query').value = query;
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
    if(generation!==routeGeneration)return;
    const results = rankSearchResults(data.results || [], query);
    const categories=splitMedia(results);
    $('#search-categories').innerHTML = results.length ? searchCategory('Movies',categories.movie)+searchCategory('TV shows',categories.series) : `<div class="empty search-empty"><strong>No close match found.</strong><span>Try the title without extra words, or check the spelling.</span></div>`;
    bindPosters();
  } catch (error) { if(generation!==routeGeneration)return;$('#search-categories').innerHTML = errorPanel(error.message, `#/search?query=${encodeURIComponent(query)}`);bindRetry(); }
}

function loginPanel(message = 'Use the account created by the system administrator.') {
  return `<section class="auth-card"><small>PRIVATE ACCESS</small><h2>Sign in</h2><p>${esc(message)}</p><form id="login-form" class="form-grid"><label>Username<input name="username" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="request-button" type="submit">Sign in</button></form></section>`;
}

async function ownerLandingHash() {
  if (!bootstrap.ownerAuthenticated) return '#/home';
  try {
    const inventory=await api('/api/admin/orchestration/inventory');
    const acknowledged=localStorage.getItem(guidedSetupCompletionKey)==='true';
    return guidedReadiness(inventory).ready && acknowledged ? '#/home' : '#/guided-setup';
  } catch {
    return '#/guided-setup';
  }
}

function bindLogin() {
  const form = $('#login-form');
  if (!form) return;
  form.onsubmit = async event => {
    event.preventDefault();
    try { await api('/api/auth/login', {method:'POST', body:JSON.stringify(Object.fromEntries(new FormData(form)))}); await loadBootstrap(); const displayName=bootstrap.user?.displayName||bootstrap.user?.username||'there',landing=await ownerLandingHash(),alreadyLanding=location.hash===landing; location.hash=landing; showToast(`Welcome, ${displayName}.`); if(alreadyLanding)route();loadHealth(); }
    catch (error) { showToast(error.message); }
  };
}

function goSignIn(message) {
  location.hash = '#/account';
  setTimeout(() => { showToast(message); $('#login-form input')?.focus(); }, 50);
}

async function renderRequests() {
  const generation=routeGeneration;
  $('#page').innerHTML = `<section class="page-heading"><div><small>YOUR REQUESTS</small><h1>From request to ready.</h1><p>A simple view of what is waiting, downloading, importing, and ready to watch.</p></div><a class="primary" href="#/search">Request something</a></section><section id="request-summary" class="request-summary"></section><section id="request-list" class="request-list"><div class="empty">Loading…</div></section>`;
  if (!bootstrap.authenticated) { $('#request-list').innerHTML = loginPanel('Sign in to see your requests.'); bindLogin(); return; }
  try {
    const data = await api('/api/requests');
    if(generation!==routeGeneration)return;
    const summary=data.summary||{};
    $('#request-summary').innerHTML=`<article><strong>${esc(summary.active||0)}</strong><span>Active</span></article><article><strong>${esc(summary.ready||0)}</strong><span>Ready</span></article><article><strong>${esc(summary.limit ? (summary.remaining ?? 0) : 'Unlimited')}</strong><span>${summary.limit?'Requests available':'Owner access'}</span></article>${summary.storagePaused?'<p>New requests may wait because storage is below the administrator’s threshold.</p>':''}`;
    $('#request-list').innerHTML = data.requests?.length ? data.requests.map(item => {
      const failed = ['failed','error'].includes(String(item.displayStatus || '').toLowerCase());
      const pending = item.displayStatus === 'pending_approval' || item.status === 'pending_approval';
      const stage=Math.max(0,Number(item.stage||0));
      return `<article class="request-row ${failed ? 'needs-attention' : ''}"><div class="request-copy"><strong>${esc(item.title)}${item.requestedSeason ? ` · Season ${esc(item.requestedSeason)}` : ''}</strong><span>${new Date(item.createdAt).toLocaleString()}${bootstrap.ownerAuthenticated && item.service ? ` · ${esc(item.service)}` : ''}${bootstrap.ownerAuthenticated && item.requestedByName ? ` · ${esc(item.requestedByName)}` : ''}</span><div class="request-steps" aria-label="Request progress"><i class="${stage>=1?'done':''}">Requested</i><i class="${stage>=2?'done':''}">Searching</i><i class="${stage>=3?'done':''}">Downloading</i><i class="${stage>=4?'done':''}">Importing</i><i class="${stage>=5?'done':''}">Ready</i></div>${item.progress>0&&item.progress<100?`<div class="progress"><i style="width:${Number(item.progress)}%"></i></div>`:''}${failed ? `<p class="request-help">${friendlyFailure()}</p>` : ''}${pending && !bootstrap.ownerAuthenticated ? '<p class="request-help">Storage or your request allotment requires system administrator approval.</p>' : ''}</div><div class="request-row-actions"><b class="request-status ${esc(item.displayStatus || 'requested')}">${esc(friendlyStatus(item.displayStatus))}</b>${pending && bootstrap.ownerAuthenticated ? `<button class="request-button compact-button" data-approve-request="${esc(item.id)}" type="button">Download now</button>` : ''}${pending?`<button class="text-button" data-cancel-request="${esc(item.id)}" type="button">Cancel request</button>`:''}</div></article>`;
    }).join('') : '<div class="empty">No requests yet. Search for something you want to watch.</div>';
    $$('[data-approve-request]').forEach(button => button.onclick = async () => { button.disabled=true;try{const result=await api(`/api/admin/requests/${encodeURIComponent(button.dataset.approveRequest)}/approve`,{method:'POST',body:'{}'});showToast(result.message||'Request approved.');renderRequests();}catch(error){button.disabled=false;showToast(error.message);}});
    $$('[data-cancel-request]').forEach(button => button.onclick = async () => { if(!confirm('Cancel this waiting request?'))return;button.disabled=true;try{await api(`/api/requests/${encodeURIComponent(button.dataset.cancelRequest)}`,{method:'DELETE',body:'{}'});showToast('Request cancelled.');renderRequests();}catch(error){button.disabled=false;showToast(error.message);}});
  } catch (error) { if(generation!==routeGeneration)return;$('#request-list').innerHTML = errorPanel(error.message,'#/requests');bindRetry(); }
}

function accountForm() {
  const user = bootstrap.user || {};
  const initials=(user.displayName||user.username||'?').trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
  return `<section class="auth-card account-card"><small>YOUR ACCOUNT</small><h2>${esc(user.displayName || user.username || 'Account')}</h2><p>Your requests and notification preferences are separate from other users.</p><form id="account-form" class="form-grid"><div class="avatar-editor"><div id="avatar-preview" class="avatar-preview">${user.avatar ? `<img src="${esc(user.avatar)}" alt="Current profile picture">` : `<span aria-hidden="true">${esc(initials)}</span>`}</div><div><label class="secondary avatar-upload" for="avatar-input">Choose profile picture</label><input id="avatar-input" type="file" accept="image/png,image/jpeg,image/webp" hidden><button id="avatar-remove" class="text-button" type="button" ${user.avatar?'':'hidden'}>Remove picture</button><p>JPEG, PNG, or WebP. Provisionarr crops and stores a small copy.</p></div></div><label>Display name<input name="displayName" value="${esc(user.displayName || '')}" required></label><label>Email for notifications<input name="email" type="email" value="${esc(user.email || '')}" placeholder="you@example.com"></label><label class="toggle-row"><span>Email me about request updates</span><input type="checkbox" name="notifications" ${(user.preferences?.notifications !== false) ? 'checked' : ''}></label><button class="request-button" type="submit">Save account</button></form><div class="compact account-actions"><button class="secondary" id="logout" type="button">Sign out</button>${bootstrap.ownerAuthenticated ? '<a class="secondary" href="#/admin">Open Admin</a>' : ''}</div></section>`;
}

function profileImage(file) {
  return new Promise((resolve,reject) => {
    if(!file?.type?.match(/^image\/(png|jpeg|webp)$/))return reject(new Error('Choose a JPEG, PNG, or WebP image.'));
    if(file.size>8*1024*1024)return reject(new Error('Choose an image smaller than 8 MB.'));
    const image=new Image(),objectUrl=URL.createObjectURL(file);
    image.onload=()=>{try{const size=256,side=Math.min(image.naturalWidth,image.naturalHeight),x=(image.naturalWidth-side)/2,y=(image.naturalHeight-side)/2,canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;canvas.getContext('2d').drawImage(image,x,y,side,side,0,0,size,size);resolve(canvas.toDataURL('image/jpeg',.82));}catch(error){reject(error)}finally{URL.revokeObjectURL(objectUrl)}};
    image.onerror=()=>{URL.revokeObjectURL(objectUrl);reject(new Error('That image could not be read.'))};
    image.src=objectUrl;
  });
}

function renderAccount() {
  if (!bootstrap.authenticated) { $('#page').innerHTML = `<section class="page-heading"><div><small>PRIVATE ACCESS</small><h1>Account</h1><p>Sign in to request media and keep your own request history.</p></div></section>${loginPanel()}`; bindLogin(); return; }
  $('#page').innerHTML = `<section class="page-heading"><div><small>ACCOUNT</small><h1>Your account</h1><p>Manage your name, email, and notifications.</p></div></section>${accountForm()}`;
  let avatar=bootstrap.user.avatar||'';
  const initials=(bootstrap.user.displayName||bootstrap.user.username||'?').trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
  const preview=$('#avatar-preview'),remove=$('#avatar-remove');
  $('#avatar-input').onchange=async event=>{try{avatar=await profileImage(event.target.files[0]);preview.innerHTML=`<img src="${avatar}" alt="New profile picture preview">`;remove.hidden=false;}catch(error){event.target.value='';showToast(error.message)}};
  remove.onclick=()=>{avatar='';remove.hidden=true;preview.innerHTML=`<span aria-hidden="true">${esc(initials)}</span>`;$('#avatar-input').value='';};
  $('#account-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    values.avatar = avatar;
    values.preferences = {notifications: form.elements.notifications.checked};
    try { const result = await api('/api/account', {method:'PUT', body:JSON.stringify(values)}); bootstrap.user = result.user; $('#account').textContent = result.user.displayName; showToast('Account saved.'); }
    catch (error) { showToast(error.message); }
  };
  $('#logout').onclick = logout;
}

async function renderLibrary() {
  const generation=routeGeneration;
  $('#page').innerHTML = `<section class="page-heading"><div><small>EMBY LIBRARY</small><h1>Existing in your library</h1><p>These titles are ready from your Emby server. Search Discover when you want something new.</p></div></section><section class="section"><div id="library-grid" class="poster-grid"><div class="empty">Synchronizing with Emby…</div></div></section>`;
  try {
    const data = await api('/api/library');
    if(generation!==routeGeneration)return;
    $('#library-grid').innerHTML = renderRail(data.items || [], 'library-poster');
    bindPosters();
  } catch (error) { if(generation!==routeGeneration)return;$('#library-grid').innerHTML = errorPanel(error.message,'#/library');bindRetry(); }
}

async function renderNotifications() {
  const generation=routeGeneration;
  $('#page').innerHTML = `<section class="page-heading"><div><small>NOTIFICATIONS</small><h1>Stay in the loop.</h1><p>Important updates about your requests, downloads, and library are kept here for you.</p></div><button class="secondary" id="mark-notifications-read" type="button">Mark all read</button></section><section id="notification-list" class="notification-list"><div class="empty">Loading notifications…</div></section>`;
  if (!bootstrap.authenticated) { $('#notification-list').innerHTML = loginPanel('Sign in to see your notifications.'); bindLogin(); return; }
  try {
    const data=await api('/api/notifications?limit=100');
    if(generation!==routeGeneration)return;
    $('#notification-list').innerHTML=data.notifications?.length?data.notifications.map(item=>`<a class="notification-row ${item.read?'read':'unread'}" href="${esc(item.href||'#/requests')}" data-notification-id="${esc(item.id)}"><i class="notification-dot ${esc(item.type||'update')}" aria-hidden="true"></i><span><strong>${esc(item.title)}</strong><small>${esc(item.message)}</small><time>${new Date(item.createdAt).toLocaleString()}</time></span></a>`).join(''):'<div class="empty">You’re all caught up.</div>';
    $('#mark-notifications-read').onclick=async()=>{try{await api('/api/notifications/read',{method:'POST',body:JSON.stringify({all:true})});await refreshNotificationCount();renderNotifications();}catch(error){showToast(error.message)}};
    $$('[data-notification-id]').forEach(link=>link.onclick=async()=>{if(link.classList.contains('unread')){try{await api('/api/notifications/read',{method:'POST',body:JSON.stringify({ids:[link.dataset.notificationId]})});await refreshNotificationCount();}catch{}}});
  } catch (error) { if(generation!==routeGeneration)return;$('#notification-list').innerHTML=errorPanel(error.message,'#/notifications');bindRetry(); }
}

const bytes = value => { let n = Number(value || 0), unit = 0; const units = ['B','KB','MB','GB','TB']; if (!n) return 'Not available'; while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit++; } return `${n.toFixed(unit ? 1 : 0)} ${units[unit]}`; };
const eta = value => { const seconds = Number(value || 0); if (!seconds || seconds > 315360000) return 'Not available'; const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60); return h ? `${h}h ${m}m` : m ? `${m}m` : '<1m'; };
const metric = (value, suffix = '') => value == null ? 'Not reported' : `${value}${suffix}`;

function adminNavigation(active) {
  const links = [
    ['admin','Overview'],
    ['guided-setup','Guided setup'],
    ['downloads','Downloads'],
    ['requests','Requests'],
    ['activity','History'],
    ['status','Services'],
    ['logs','Audit log'],
    ['settings','Settings']
  ];
  return `<aside class="admin-side"><small>MANAGEMENT PLANE</small>${links.map(([route,label])=>`<a class="${active===route?'active':''}" href="#/${route}">${label}</a>`).join('')}</aside>`;
}

async function renderAdmin() {
  if (!ownerOnly()) return;
  const generation=routeGeneration;
  $('#page').innerHTML = `<div class="admin-shell">${adminNavigation('admin')}<div class="admin-main"><section class="page-heading admin-heading"><div><small>SYSTEM ADMINISTRATOR</small><h1>Your media stack, at a glance.</h1><p>Start with what needs attention. Everything else is translated into plain language.</p></div><button class="secondary" id="admin-refresh" type="button">Refresh</button></section><section id="admin-summary" class="admin-summary"><div class="empty">Checking services…</div></section></div></div>`;
  $('#admin-refresh').onclick = renderAdmin;
  try {
    const overview = await api('/api/admin/overview');
    if(generation!==routeGeneration)return;
    const attention = overview.status === 'attention';
    const serviceCards=(overview.services||[]).map(service=>`<article class="service-pill"><i class="status-light ${service.ok?'good':''}"></i><div><strong>${esc(service.label)}</strong><span>${service.ok?'Connected':'Unavailable'}${service.version?` · ${esc(service.version)}`:''}</span></div></article>`).join('');
    const alerts=(overview.alerts||[]).length?(overview.alerts||[]).map(alert=>`<article class="attention-row"><span class="severity ${esc(alert.level||'warning')}"></span><div><strong>${esc(alert.service)}</strong><p>${esc(alert.message)}</p></div><a href="#/status">Review</a></article>`).join(''):'<div class="all-clear"><strong>No action needed.</strong><span>Provisionarr and its connected services are reporting normally.</span></div>';
    const downloads=(overview.downloads?.rows||[]).length?overview.downloads.rows.map(item=>`<article class="mini-download"><div><strong>${esc(item.title)}</strong><span>${esc(item.service)} · ${esc(item.importing?'Importing':item.state)}</span></div><div class="progress"><i style="width:${Number(item.progress||0)}%"></i></div><b>${Number(item.progress||0)}%</b></article>`).join(''):'<div class="empty compact-empty">Nothing is downloading right now.</div>';
    $('#admin-summary').innerHTML = `<article class="admin-callout ${attention ? 'attention' : 'good'}"><span class="admin-icon">${attention ? '!' : '✓'}</span><div><h2>${attention ? 'Needs attention' : 'Everything looks good'}</h2><p>${esc(overview.plainStatus)}</p></div><a class="secondary" href="#/status">${attention ? 'Review' : 'Full status'}</a></article><div class="admin-metrics"><article><strong>${esc(overview.library.total)}</strong><span>Library titles</span></article><article><strong>${esc(overview.requestCounts.pending_approval || 0)}</strong><span>Awaiting approval</span></article><article><strong>${esc(overview.downloads?.active||0)}</strong><span>Active downloads</span></article><article><strong>${esc(metric(overview.storage.freeGb, ' GB'))}</strong><span>Storage free</span></article></div><div class="admin-grid"><section class="admin-panel attention-panel"><header><div><small>PRIORITY</small><h2>Needs attention</h2></div><a href="#/status">View all</a></header>${alerts}</section><section class="admin-panel"><header><div><small>LIVE</small><h2>Downloads</h2></div><a href="#/downloads">Manage</a></header>${downloads}</section><section class="admin-panel storage-panel"><header><div><small>CAPACITY</small><h2>Storage</h2></div><span>${esc(metric(overview.storage.usedPercent, '% used'))}</span></header><div class="storage-ring" style="--used:${Number(overview.storage.usedPercent||0)}"><strong>${esc(metric(overview.storage.freeGb, ' GB'))}</strong><span>free</span></div><p>${overview.storage.low?'Requests are being held at the configured safety threshold.':'Storage is above the configured safety threshold.'}</p><a class="secondary" href="#/settings?section=general">Adjust threshold</a></section><section class="admin-panel"><header><div><small>CONNECTIONS</small><h2>Services</h2></div><a href="#/status">Details</a></header><div class="service-grid">${serviceCards}</div></section></div>`;
  } catch (error) { if(generation!==routeGeneration)return;$('#admin-summary').innerHTML = errorPanel(error.message,'#/admin');bindRetry(); }
}

const orchestrationLabels = {
  renameFiles:'Rename media files consistently',
  replaceIllegalCharacters:'Replace characters that storage systems reject',
  importExtraFiles:'Import approved companion files',
  completedDownloadHandling:'Import downloads when they finish',
  removeCompletedDownloads:'Remove completed jobs from the download client'
};

function orchestrationToggle(service, group, setting, checked) {
  const id=`orchestration-${service}-${group}-${setting}`;
  return `<label class="orchestration-toggle" for="${id}"><span><strong>${esc(orchestrationLabels[setting])}</strong><small>${esc(setting==='importExtraFiles'?'Keeps supported extras with the media item. Executables, scripts, and archives remain excluded by policy.':'Provisionarr translates this into the correct native ARR setting.')}</small></span><input id="${id}" data-service="${service}" data-group="${group}" data-setting="${setting}" type="checkbox" ${checked?'checked':''}></label>`;
}

function orchestrationConnectionCard(connection, service={}) {
  const stored=connection.apiKeySet||(connection.usernameSet&&connection.passwordSet);
  const state=service.connected?'Connected':stored?'Connection failed':'Not connected';
  const kinds={sonarr:'TELEVISION',radarr:'MOVIES',prowlarr:'INDEXERS',qbittorrent:'DOWNLOADS'},ports={sonarr:'8989',radarr:'7878',prowlarr:'9696',qbittorrent:'8080'};
  const credentials=connection.id==='qbittorrent'
    ? `<div class="form-grid two"><label>Username<input name="username" value="" placeholder="${connection.usernameSet?'Saved. Leave blank to keep it.':'qBittorrent username'}" ${connection.usernameSet?'':'required'} autocomplete="username" spellcheck="false"></label><label>Password<input name="password" type="password" value="" placeholder="${connection.passwordSet?'Saved. Leave blank to keep it.':'qBittorrent password'}" ${connection.passwordSet?'':'required'} autocomplete="new-password"></label></div>`
    : `<label>API key<input name="apiKey" type="password" value="" placeholder="${connection.apiKeySet?'Saved. Leave blank to keep it.':'Paste the API key'}" ${connection.apiKeySet?'':'required'} autocomplete="new-password" spellcheck="false"></label>`;
  const credentialSet=connection.id==='qbittorrent'?connection.usernameSet&&connection.passwordSet:connection.apiKeySet;
  return `<form class="orchestration-connection" data-connection-service="${esc(connection.id)}"><header><div><small>${esc(kinds[connection.id]||'SERVICE')}</small><h2>${esc(connection.label)}</h2></div><span class="service-state"><i class="status-light ${service.connected?'good':''}"></i>${esc(state)}</span></header><label>Service URL<input name="url" type="url" value="${esc(connection.url||'')}" placeholder="http://server:${ports[connection.id]||''}" required autocomplete="url" spellcheck="false"></label>${credentials}<div class="connection-save"><span>${credentialSet?'Credentials are stored on the server and never returned to this page.':'Enter the credentials from this service.'}</span><button class="secondary" type="submit">Test and save</button></div><p class="connection-feedback" role="status" aria-live="polite" hidden></p></form>`;
}

function orchestrationCompatibility(service) {
  const checkLabels={authenticated:'Service connection',health:'Service health',enabled_indexer:'Enabled indexer',sonarr_link:'Sonarr link',radarr_link:'Radarr link',authenticated_version:'Service connection',default_save_path:'Default save location',queue_visibility:'Queue visibility'};
  const checks=(service.compatibility?.checks||[]).map(check=>{const pass=check.ok===true||check.state==='pass',unknown=check.state==='unknown';return `<li class="${pass?'pass':unknown?'unknown':'fail'}"><i>${pass?'✓':unknown?'?':'!'}</i><span><strong>${esc(check.label||checkLabels[check.id]||check.id)}</strong><small>${esc(check.message||check.summary||'No detail available.')}</small></span></li>`;}).join('');
  const summary=service.compatibility?.summary||(service.compatibility?.state==='ready'?'Ready for guided management.':service.compatibility?.state==='needs_configuration'?'Connected, but setup needs attention.':'Connection report unavailable.');
  return `<section class="compatibility-report"><header><div><small>COMPATIBILITY</small><h3>${esc(summary)}</h3></div><span>${esc(service.version||'No version')}</span></header><ul>${checks}</ul></section>`;
}

function orchestrationSupportCard(service) {
  const ready=service.compatibility?.state==='ready';
  return `<article class="orchestration-service support-service ${service.connected?'connected':''}"><header><div><small>${service.id==='prowlarr'?'INDEXERS':'DOWNLOAD CLIENT'}</small><h2>${esc(service.label)}</h2></div><span class="service-state"><i class="status-light ${ready?'good':service.connected?'warning':''}"></i>${ready?'Ready':service.connected?'Needs setup':'Unavailable'}</span></header>${service.warnings?.length?`<div class="orchestration-warning">${service.warnings.map(esc).join(' ')}</div>`:''}${orchestrationCompatibility(service)}</article>`;
}

function orchestrationServiceCard(service, current={}) {
  const root=service.rootFolders?.[0], profile=service.qualityProfiles?.[0], client=service.downloadClients?.find(item=>item.enabled)||service.downloadClients?.[0];
  const warning=service.warnings?.length?`<div class="orchestration-warning">${service.warnings.map(esc).join(' ')}</div>`:'';
  return `<article class="orchestration-service ${service.connected?'connected':''}"><header><div><small>${service.id==='sonarr'?'TELEVISION':'MOVIES'}</small><h2>${esc(service.label)}</h2></div><span class="service-state"><i class="status-light ${service.compatibility?.ready?'good':''}"></i>${service.compatibility?.ready?'Ready':service.connected?'Needs setup':'Unavailable'}</span></header><dl><div><dt>Version</dt><dd>${esc(service.version||'Unavailable')}</dd></div><div><dt>Library location</dt><dd>${esc(root?.path||'Not configured')}</dd></div><div><dt>Default quality</dt><dd>${esc(profile?.name||'Not configured')}</dd></div><div><dt>Download client</dt><dd>${esc(client?.name||'Not configured')}</dd></div></dl>${warning}${orchestrationCompatibility(service)}<fieldset ${service.connected?'':'disabled'}><legend>Sensible media handling</legend>${orchestrationToggle(service.id,'mediaManagement','renameFiles',current.mediaManagement?.renameFiles)}${orchestrationToggle(service.id,'mediaManagement','replaceIllegalCharacters',current.mediaManagement?.replaceIllegalCharacters)}${orchestrationToggle(service.id,'mediaManagement','importExtraFiles',current.mediaManagement?.importExtraFiles)}${orchestrationToggle(service.id,'downloadHandling','completedDownloadHandling',current.downloadHandling?.completedDownloadHandling)}${orchestrationToggle(service.id,'downloadHandling','removeCompletedDownloads',current.downloadHandling?.removeCompletedDownloads)}</fieldset></article>`;
}

async function saveOrchestrationConnection(form) {
  const service=form.dataset.connectionService,button=form.querySelector('button[type="submit"]'),fields=new FormData(form);
  button.disabled=true;button.textContent='Testing…';
  try {
    const body=service==='qbittorrent'?{url:fields.get('url'),username:fields.get('username'),password:fields.get('password')}:{url:fields.get('url'),apiKey:fields.get('apiKey')};
    const result=await api(`/api/admin/orchestration/connections/${encodeURIComponent(service)}`,{method:'PUT',body:JSON.stringify(body)});
    const inventory=guidedSetupState.inventory;
    if(inventory){
      inventory.connections=(inventory.connections||[]).map(connection=>connection.id===service?result.connection:connection);
      for(const group of ['services','supportServices'])inventory[group]=(inventory[group]||[]).map(item=>item.id===service?result.service:item);
    }
    const template=document.createElement('template');
    template.innerHTML=orchestrationConnectionCard(result.connection,result.service);
    const replacement=template.content.firstElementChild;
    form.replaceWith(replacement);
    replacement.onsubmit=event=>{event.preventDefault();saveOrchestrationConnection(replacement);};
    const feedback=replacement.querySelector('.connection-feedback');
    feedback.textContent=result.message;feedback.hidden=false;
    if(inventory){
      const readiness=guidedReadiness(inventory),next=$('#guided-next-step'),stepStatus=$('.guided-step-copy>span');
      if(next)next.disabled=!readiness.connected;
      if(stepStatus)stepStatus.textContent=guidedStepStatus(readiness,1);
      $('#orchestration-steps').innerHTML=guidedStepIndicator(readiness);
      bindGuidedStepControls(inventory);
    }
  } catch(error){
    const feedback=form.querySelector('.connection-feedback');
    if(feedback){feedback.textContent=error.message;feedback.hidden=false;feedback.classList.add('error');}
    button.disabled=false;button.textContent='Test and save';
  }
}

function orchestrationDesired() {
  const desired={};
  $$('[data-service][data-group][data-setting]').forEach(input=>{
    desired[input.dataset.service]??={};
    desired[input.dataset.service][input.dataset.group]??={};
    desired[input.dataset.service][input.dataset.group][input.dataset.setting]=input.checked;
  });
  return desired;
}

function orchestrationValue(value) { return value===true?'On':value===false?'Off':'Not set'; }

function maskedServiceUrl(value) {
  try { const parsed=new URL(value); return `${parsed.protocol}//••••${parsed.port?`:${parsed.port}`:''}`; } catch { return 'Private service URL'; }
}

function prowlarrLinkForm(connections) {
  const byId=Object.fromEntries((connections||[]).map(connection=>[connection.id,connection])),value=id=>byId[id]?.url||'';
  return `<section class="orchestration-intro orchestration-defaults"><div><small>PROWLARR APPLICATION LINKS</small><h2>Connect Prowlarr to Sonarr and Radarr</h2><p>Review the callback and service addresses Prowlarr will use. Private HTTP addresses are supported. API keys stay on the server and never enter this page.</p></div></section><form id="prowlarr-links-form" class="prowlarr-links-card"><div class="form-grid two"><label>Prowlarr callback URL<input name="prowlarrUrl" type="url" value="${esc(value('prowlarr'))}" placeholder="http://prowlarr:9696" required autocomplete="url" spellcheck="false"><small>Address Prowlarr uses to send indexer results.</small></label><label>Sonarr URL<input name="sonarrUrl" type="url" value="${esc(value('sonarr'))}" placeholder="http://sonarr:8989" required autocomplete="url" spellcheck="false"><small>Private HTTP is fine on your home network.</small></label><label>Radarr URL<input name="radarrUrl" type="url" value="${esc(value('radarr'))}" placeholder="http://radarr:7878" required autocomplete="url" spellcheck="false"><small>Use the address reachable from Prowlarr.</small></label><fieldset class="sync-choice"><legend>Indexer synchronization</legend><label><input type="radio" name="syncLevel" value="fullSync" checked> Full sync <small>Prowlarr manages the linked indexers.</small></label><label><input type="radio" name="syncLevel" value="addOnly"> Add-only <small>New indexers are added without changing existing ones.</small></label></fieldset></div><div class="orchestration-actions"><div><strong>Preview before saving links.</strong><span>Prowlarr will be changed only after you review and confirm its redacted plan.</span></div><button class="request-button" id="review-prowlarr-links" type="submit">Review Prowlarr links</button></div></form><section id="prowlarr-links-plan" class="orchestration-plan"><div class="empty">Your Prowlarr link preview will appear here.</div></section>`;
}

async function reviewProwlarrLinks(form) {
  const button=form.querySelector('button[type="submit"]'),output=$('#prowlarr-links-plan'),fields=new FormData(form);
  button.disabled=true;button.textContent='Reviewing…';output.innerHTML='<div class="empty">Checking Prowlarr application links…</div>';
  try {
    const result=await api('/api/admin/orchestration/prowlarr/plan',{method:'POST',body:JSON.stringify({prowlarrUrl:fields.get('prowlarrUrl'),sonarrUrl:fields.get('sonarrUrl'),radarrUrl:fields.get('radarrUrl'),syncLevel:fields.get('syncLevel')||'fullSync'})});
    const changes=result.plan?.changes||[];
    if(!changes.length){output.innerHTML='<div class="all-clear"><strong>No Prowlarr changes needed.</strong><span>Both application links already match these choices.</span></div>';return;}
    const rows=changes.map(change=>`<article class="orchestration-change"><div><small>${esc(String(change.service||'service').toUpperCase())} · PROWLARR LINK</small><strong>${esc(change.action==='create'?'Create application link':'Update application link')}</strong></div><span>${esc(change.action==='create'?'Not linked':'Existing link')}</span><b>→</b><span class="proposed">${esc(maskedServiceUrl(change.applicationUrl))}</span></article>`).join('');
    output.innerHTML=`<header><div><small>REDACTED PREVIEW</small><h2>${changes.length} Prowlarr ${changes.length===1?'link':'links'} proposed</h2></div><time>${new Date(result.generatedAt).toLocaleTimeString()}</time></header>${rows}<div class="orchestration-safety"><strong>Nothing has been changed.</strong><span>URLs are masked in this preview. API keys are held by Provisionarr on the server and are never returned to the browser.</span></div><div class="orchestration-apply"><div><strong>${result.canApply?'Ready to apply after confirmation.':'Apply is locked on this development instance.'}</strong><span>${result.canApply?`This plan expires at ${new Date(result.expiresAt).toLocaleTimeString()}.`:'The preview is available for review; enable the write workflow only on the instance intended to manage Prowlarr.'}</span></div><button class="request-button" id="apply-prowlarr-links" type="button" ${result.canApply?'':'disabled'}>${result.canApply?'Apply Prowlarr links':'Apply locked'}</button></div>`;
    if(result.canApply)$('#apply-prowlarr-links').onclick=()=>applyProwlarrLinks(result.planId);
  } catch(error) { output.innerHTML=errorPanel(error.message,'#/guided-setup');bindRetry(); }
  finally { button.disabled=false;button.textContent='Review Prowlarr links'; }
}

async function applyProwlarrLinks(planId) {
  if(!confirm('Apply the reviewed Prowlarr application links? Provisionarr will test each link first and keep a rollback backup.'))return;
  const button=$('#apply-prowlarr-links');button.disabled=true;button.textContent='Applying…';
  try { const result=await api(`/api/admin/orchestration/prowlarr/plans/${encodeURIComponent(planId)}/apply`,{method:'POST',body:'{}'});showToast(result.message);guidedSetupState.step=5;await renderOrchestrationBackups();setTimeout(renderGuidedSetup,700); }
  catch(error) { showToast(error.message);button.disabled=false;button.textContent='Try again'; }
}

async function reviewOrchestrationPlan() {
  const button=$('#review-orchestration'), output=$('#orchestration-plan');
  button.disabled=true;button.textContent='Reviewing…';output.innerHTML='<div class="empty">Comparing your choices with Sonarr and Radarr…</div>';
  try {
    const {plan,planId,canApply,expiresAt,generatedAt}=await api('/api/admin/orchestration/plan',{method:'POST',body:JSON.stringify({desired:orchestrationDesired()})});
    if(plan.isEmpty){output.innerHTML='<div class="all-clear"><strong>No changes needed.</strong><span>Sonarr and Radarr already match these choices.</span></div>';return;}
    const rows=plan.changes.map(change=>`<article class="orchestration-change"><div><small>${esc(change.service.toUpperCase())} · ${esc(change.group==='mediaManagement'?'MEDIA HANDLING':'DOWNLOAD HANDLING')}</small><strong>${esc(orchestrationLabels[change.setting]||change.setting)}</strong></div><span>${esc(orchestrationValue(change.before))}</span><b>→</b><span class="proposed">${esc(orchestrationValue(change.after))}</span></article>`).join('');
    output.innerHTML=`<header><div><small>SAFE PREVIEW</small><h2>${plan.changes.length} proposed ${plan.changes.length===1?'change':'changes'}</h2></div><time>${new Date(generatedAt).toLocaleTimeString()}</time></header>${rows}<div class="orchestration-safety"><strong>Nothing has been changed.</strong><span>Only the settings shown above are allowlisted. Passwords, API keys, paths, indexers, and destructive controls are outside this workflow.</span></div><div class="orchestration-apply"><div><strong>${canApply?'Backup and rollback are ready.':'Live changes are locked on this development instance.'}</strong><span>${canApply?`This reviewed plan expires at ${new Date(expiresAt).toLocaleTimeString()}. A private backup is created before the first change.`:'Preview is fully functional. Enable orchestration writes only on an instance intended to manage its connected ARR services.'}</span></div><button class="request-button" id="apply-orchestration" type="button" ${canApply?'':'disabled'}>${canApply?`Apply ${plan.changes.length} ${plan.changes.length===1?'change':'changes'}`:'Apply locked'}</button></div>`;
    if(canApply)$('#apply-orchestration').onclick=()=>applyReviewedOrchestration(planId);
  } catch(error){output.innerHTML=errorPanel(error.message,'#/guided-setup');bindRetry();}
  finally{button.disabled=false;button.textContent='Review changes';}
}

async function applyReviewedOrchestration(planId){
  if(!confirm('Apply only the reviewed settings? Provisionarr will create a private backup first and automatically restore completed steps if a later step fails.'))return;
  const button=$('#apply-orchestration');button.disabled=true;button.textContent='Applying safely…';
  try{const result=await api(`/api/admin/orchestration/plans/${encodeURIComponent(planId)}/apply`,{method:'POST',body:'{}'});showToast(result.message);await renderOrchestrationBackups();setTimeout(renderGuidedSetup,700);}
  catch(error){showToast(error.message);button.disabled=false;button.textContent='Try again';}
}

async function rollbackOrchestration(id){
  if(!confirm('Restore this complete Sonarr and Radarr settings backup? Provisionarr will only restore the allowlisted configuration resources captured before the change.'))return;
  try{const result=await api(`/api/admin/orchestration/backups/${encodeURIComponent(id)}/rollback`,{method:'POST',body:'{}'});showToast(result.message);await renderOrchestrationBackups();setTimeout(renderGuidedSetup,700);}
  catch(error){showToast(error.message);}
}

async function renderOrchestrationBackups(){
  const target=$('#orchestration-backups');if(!target)return;
  try{const data=await api('/api/admin/orchestration/backups');const rows=(data.backups||[]).map(backup=>`<article class="orchestration-backup"><div><strong>${new Date(backup.createdAt).toLocaleString()}</strong><span>${esc(String(backup.status||'created').replaceAll('_',' '))} · ${Number(backup.resourceCount||0)} protected resources</span></div>${data.writesEnabled&&backup.status==='applied'?`<button class="secondary" data-rollback="${esc(backup.id)}" type="button">Roll back</button>`:''}</article>`).join('');target.innerHTML=`<header><div><small>RECOVERY</small><h2>Configuration backups</h2></div><span>${data.writesEnabled?'Rollback ready':'Writes locked'}</span></header>${rows||'<div class="empty compact-empty">No orchestration backups yet.</div>'}`;$$('[data-rollback]').forEach(button=>button.onclick=()=>rollbackOrchestration(button.dataset.rollback));}
  catch(error){target.innerHTML=`<div class="empty">${esc(error.message)}</div>`;}
}

async function generateStackBundle(form) {
  const output=$('#stack-bundle-output'),button=form.querySelector('button[type="submit"]'),fields=new FormData(form);
  button.disabled=true;button.textContent='Generating…';
  try{
    const body={mode:fields.get('mode')||bootstrap.setupMode||'managed',configRoot:fields.get('configRoot'),mediaRoot:fields.get('mediaRoot'),downloadRoot:fields.get('downloadRoot'),puid:Number(fields.get('puid')),pgid:Number(fields.get('pgid')),timezone:fields.get('timezone')};
    const result=await api('/api/admin/installer/compose',{method:'POST',body:JSON.stringify(body)}),files=result.bundle.files||{};
    output.innerHTML=Object.entries(files).map(([name,content])=>`<article class="bundle-file"><header><strong>${esc(name)}</strong><button class="secondary" data-bundle-file="${esc(name)}" type="button">Download</button></header><pre>${esc(content)}</pre></article>`).join('');
    $$('[data-bundle-file]').forEach(download=>download.onclick=()=>{const name=download.dataset.bundleFile,blob=new Blob([files[name]],{type:'text/plain;charset=utf-8'}),link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);});
    showToast('Reviewable stack files generated. Nothing was executed.');
  }catch(error){output.innerHTML=errorPanel(error.message,'#/guided-setup');bindRetry();}
  finally{button.disabled=false;button.textContent='Generate files';}
}

const guidedSetupSteps = [
  {number:1,label:'Connect services'},
  {number:2,label:'Library paths'},
  {number:3,label:'qBittorrent'},
  {number:4,label:'Prowlarr'},
  {number:5,label:'Verify ready'}
];

function guidedModePicker() {
  return `<section class="setup-mode-picker"><header><h2>How do you want to set up Provisionarr?</h2><p>Choose the path that matches the media services on this server. You can change this choice before applying a reviewed setup.</p></header><div class="setup-mode-options"><button class="setup-mode-option" data-setup-mode="existing" type="button"><span>Connect an existing stack</span><strong>I already run Sonarr, Radarr, Prowlarr, and qBittorrent.</strong><small>Provisionarr will test and save the private addresses and credentials you provide.</small></button><button class="setup-mode-option" data-setup-mode="managed" type="button"><span>Create a managed stack</span><strong>Install and configure the four services with Provisionarr.</strong><small>Provisionarr will prepare the containers, connect them, and guide each reviewed setting.</small></button></div><p class="setup-mode-boundary">VPN installation and provider configuration remain outside this setup.</p></section>`;
}

async function saveGuidedSetupMode(mode) {
  const buttons=$$('[data-setup-mode]');buttons.forEach(button=>button.disabled=true);
  try {
    const result=await api('/api/admin/orchestration/mode',{method:'PUT',body:JSON.stringify({mode})});
    bootstrap.setupMode=result.mode;guidedSetupState.step=1;guidedSetupState.values={};
    await renderGuidedSetup();
  } catch(error) {
    buttons.forEach(button=>button.disabled=false);
    showToast(error.message);
  }
}

function guidedManagedServicesSection(inventory) {
  const readiness=guidedReadiness(inventory),services=[...(inventory.services||[]),...(inventory.supportServices||[])];
  const cards=services.map(service=>`<article class="managed-service-row"><div><strong>${esc(service.label)}</strong><span>${service.connected?'Service detected and authenticated.':'Waiting for the managed service.'}</span></div><b class="service-state"><i class="status-light ${service.connected?'good':''}"></i>${service.connected?'Connected':'Not running'}</b></article>`).join('');
  return `<section class="guided-step-copy"><div><small>STEP 1 OF 5</small><h2>Install the managed services</h2><p>Provisionarr prepares Sonarr, Radarr, Prowlarr, and qBittorrent, then stores their generated connections on the server.</p></div><span>${readiness.connected?'Services available':'Installation needed'}</span></section><section class="managed-service-list">${cards}</section>${readiness.connected?'<div class="guided-step-actions"><button class="request-button" id="guided-next-step" type="button">Continue to library paths</button></div>':`<section class="bundle-builder managed-bundle"><header><div><h2>Prepare the managed stack</h2><p>Choose host folders and identity values. Provisionarr will show the generated files before any installation action.</p></div></header><form id="stack-bundle-form" class="form-grid two"><input type="hidden" name="mode" value="managed"><label>Configuration root<input name="configRoot" value="/srv/provisionarr/config" required></label><label>Media root<input name="mediaRoot" value="/srv/provisionarr/media" required></label><label>Download root<input name="downloadRoot" value="/srv/provisionarr/downloads" required></label><label>Timezone<input name="timezone" value="Etc/UTC" required></label><label>User ID<input name="puid" type="number" min="1" value="1000" required></label><label>Group ID<input name="pgid" type="number" min="1" value="1000" required></label><button class="request-button" type="submit">Review managed stack</button></form><div id="stack-bundle-output" class="bundle-files"><div class="empty compact-empty">No managed stack has been prepared.</div></div></section>`}`;
}

function guidedService(inventory, id) {
  return [...(inventory?.services || []), ...(inventory?.supportServices || [])].find(service => service.id === id) || {};
}

function guidedConnection(inventory, id) {
  return (inventory?.connections || []).find(connection => connection.id === id) || {};
}

function guidedHasConnected(inventory, id) {
  return guidedService(inventory, id).connected === true;
}

function guidedHasRoot(service) {
  return Array.isArray(service?.rootFolders) && service.rootFolders.some(root => root?.path && root.accessible !== false);
}

function guidedHasDownloadClient(service) {
  return Array.isArray(service?.downloadClients) && service.downloadClients.some(client => client?.enabled !== false && client?.enable !== false);
}

function guidedHasProwlarrLinks(service) {
  if (service?.compatibility?.state === 'ready' || service?.compatibility?.ready === true) return true;
  const checks = service?.compatibility?.checks || [];
  return ['sonarr_link','radarr_link'].every(id => checks.some(check => check.id === id && (check.ok === true || check.state === 'pass')));
}

function guidedReadiness(inventory) {
  const sonarr=guidedService(inventory,'sonarr'),radarr=guidedService(inventory,'radarr'),qbit=guidedService(inventory,'qbittorrent'),prowlarr=guidedService(inventory,'prowlarr');
  const connected=['sonarr','radarr','qbittorrent','prowlarr'].every(id => guidedHasConnected(inventory,id));
  const paths=guidedHasRoot(sonarr) && guidedHasRoot(radarr);
  const clients=guidedHasDownloadClient(sonarr) && guidedHasDownloadClient(radarr);
  const links=guidedHasProwlarrLinks(prowlarr);
  const qbitReady=qbit.compatibility?.state === 'ready' || qbit.compatibility?.ready === true || (qbit.connected === true && (qbit.compatibility?.checks || []).every(check => check.ok === true || check.state === 'pass'));
  return {connected,paths,clients,qbitReady,links,ready:connected && paths && clients && links && qbitReady};
}

function guidedFirstIncomplete(readiness) {
  if (!readiness.connected) return 1;
  if (!readiness.paths) return 2;
  if (!readiness.clients || !readiness.qbitReady) return 3;
  if (!readiness.links) return 4;
  return 5;
}

function guidedDefaultValues(inventory) {
  const sonarr=guidedService(inventory,'sonarr'),radarr=guidedService(inventory,'radarr'),qbit=guidedConnection(inventory,'qbittorrent');
  return {
    sonarrRoot:guidedSetupState.values.sonarrRoot || sonarr.rootFolders?.find(root => root.path)?.path || '/tv',
    radarrRoot:guidedSetupState.values.radarrRoot || radarr.rootFolders?.find(root => root.path)?.path || '/movies',
    qbittorrentUrl:guidedSetupState.values.qbittorrentUrl || qbit.url || 'http://qbittorrent:8080',
    qbittorrentUsername:guidedSetupState.values.qbittorrentUsername || '',
    qbittorrentPassword:guidedSetupState.values.qbittorrentPassword || '',
    sonarrCategory:guidedSetupState.values.sonarrCategory || 'tv-sonarr',
    radarrCategory:guidedSetupState.values.radarrCategory || 'radarr'
  };
}

function guidedValueFields() {
  $$('[data-guided-field]').forEach(field => { guidedSetupState.values[field.dataset.guidedField] = field.value; });
}

function guidedStepIndicator(readiness) {
  const firstIncomplete=guidedFirstIncomplete(readiness);
  return guidedSetupSteps.map(step => {
    const complete = step.number < firstIncomplete || (step.number === 5 && readiness.ready);
    const active = guidedSetupState.step === step.number;
    const label=step.number===1&&bootstrap.setupMode==='managed'?'Install services':step.label;
    return `<li class="${complete?'done ':''}${active?'active':''}" data-setup-step="${step.number}" tabindex="0" role="button" aria-current="${active?'step':'false'}"><span class="step-number">${complete?'✓':step.number}</span><span>${esc(label)}</span></li>`;
  }).join('');
}

function guidedStepStatus(readiness, step) {
  const statuses={1:readiness.connected,2:readiness.paths,3:readiness.clients && readiness.qbitReady,4:readiness.links,5:readiness.ready};
  return statuses[step] ? 'Ready' : step < guidedFirstIncomplete(readiness) ? 'Ready' : 'Needs setup';
}

function guidedSetupConnectionSection(inventory) {
  const byId=Object.fromEntries([...(inventory.services || []),...(inventory.supportServices || [])].map(service => [service.id,service]));
  const readiness=guidedReadiness(inventory);
  return `<section class="guided-step-copy"><div><small>STEP 1 OF 5</small><h2>Connect the services you already run</h2><p>Provisionarr tests each address before it saves the connection. Credentials stay on the server and are never returned to this page.</p></div><span>${guidedStepStatus(readiness,1)}</span></section><div class="orchestration-connections">${(inventory.connections || []).map(connection=>orchestrationConnectionCard(connection,byId[connection.id])).join('')}</div><div class="guided-step-actions"><button class="request-button" id="guided-next-step" type="button" ${readiness.connected?'':'disabled'}>Continue to library paths</button></div>`;
}

function guidedPathsSection(inventory) {
  const values=guidedDefaultValues(inventory),readiness=guidedReadiness(inventory);
  return `<section class="guided-step-copy"><div><small>STEP 2 OF 5</small><h2>Set library paths</h2><p>These are the library locations Sonarr and Radarr will use. Enter paths as they appear inside those services.</p></div><span>${guidedStepStatus(readiness,2)}</span></section><form id="guided-paths-form" class="guided-form"><div class="form-grid two"><label for="guided-sonarr-root">Sonarr library path<input id="guided-sonarr-root" data-guided-field="sonarrRoot" name="sonarrRoot" value="${esc(values.sonarrRoot)}" required autocomplete="off" spellcheck="false"><small>Default: /tv</small></label><label for="guided-radarr-root">Radarr library path<input id="guided-radarr-root" data-guided-field="radarrRoot" name="radarrRoot" value="${esc(values.radarrRoot)}" required autocomplete="off" spellcheck="false"><small>Default: /movies</small></label></div><div class="guided-note"><strong>Paths are service-specific.</strong><span>Use the path that Sonarr or Radarr can access. Provisionarr does not inspect or move files while applying this setup.</span></div><div class="guided-step-actions"><button class="secondary" id="guided-back-step" type="button">Back</button><button class="request-button" type="submit">Continue to qBittorrent</button></div></form>`;
}

function guidedQbitSection(inventory) {
  const values=guidedDefaultValues(inventory),readiness=guidedReadiness(inventory),connection=guidedConnection(inventory,'qbittorrent'),saved=Boolean(connection.usernameSet && connection.passwordSet);
  return `<section class="guided-step-copy"><div><small>STEP 3 OF 5</small><h2>Link qBittorrent</h2><p>Provisionarr will add qBittorrent to both ARR services, using the categories below. Leave saved credentials blank to keep them server-side.</p></div><span>${guidedStepStatus(readiness,3)}</span></section><form id="guided-qbit-form" class="guided-form"><div class="form-grid two"><label for="guided-qbit-url">qBittorrent address<input id="guided-qbit-url" data-guided-field="qbittorrentUrl" name="qbittorrentUrl" type="url" value="${esc(values.qbittorrentUrl)}" required autocomplete="url" spellcheck="false"><small>Address reachable from Sonarr and Radarr.</small></label><label for="guided-qbit-user">qBittorrent username<input id="guided-qbit-user" data-guided-field="qbittorrentUsername" name="qbittorrentUsername" value="${esc(values.qbittorrentUsername)}" placeholder="${saved?'Saved on server. Leave blank to keep it.':'Username'}" autocomplete="username" spellcheck="false"></label><label for="guided-qbit-password">qBittorrent password<input id="guided-qbit-password" data-guided-field="qbittorrentPassword" name="qbittorrentPassword" type="password" value="" placeholder="${saved?'Saved on server. Leave blank to keep it.':'Password'}" autocomplete="current-password"></label><label for="guided-sonarr-category">Sonarr category<input id="guided-sonarr-category" data-guided-field="sonarrCategory" name="sonarrCategory" value="${esc(values.sonarrCategory)}" required autocomplete="off" spellcheck="false"><small>Default: tv-sonarr</small></label><label for="guided-radarr-category">Radarr category<input id="guided-radarr-category" data-guided-field="radarrCategory" name="radarrCategory" value="${esc(values.radarrCategory)}" required autocomplete="off" spellcheck="false"><small>Default: radarr</small></label></div><div class="guided-note"><strong>Passwords are never shown in the review.</strong><span>The plan only displays redacted connection status. qBittorrent credentials remain in Provisionarr’s private server configuration.</span></div><div class="guided-step-actions"><button class="secondary" id="guided-back-step" type="button">Back</button><button class="request-button" type="submit">Review qBittorrent setup</button></div></form><section id="guided-bootstrap-plan" class="orchestration-plan"><div class="empty">Your redacted setup review will appear here.</div></section>`;
}

function guidedProwlarrSection(inventory) {
  const readiness=guidedReadiness(inventory);
  return `<section class="guided-step-copy"><div><small>STEP 4 OF 5</small><h2>Link Prowlarr</h2><p>Prowlarr sends indexer results to Sonarr and Radarr. Review the two application links, then apply them only after confirmation.</p></div><span>${guidedStepStatus(readiness,4)}</span></section>${prowlarrLinkForm(inventory.connections)}<div class="guided-step-actions"><button class="secondary" id="guided-back-step" type="button">Back</button></div>`;
}

function guidedVerificationSection(inventory) {
  const readiness=guidedReadiness(inventory),checks=[
    ['Services connected',readiness.connected,'Sonarr, Radarr, qBittorrent, and Prowlarr respond to their saved connections.'],
    ['Library paths',readiness.paths,'Sonarr and Radarr report an accessible library root.'],
    ['qBittorrent linked',readiness.clients && readiness.qbitReady,'Both ARR services report an enabled qBittorrent download client.'],
    ['Prowlarr linked',readiness.links,'Prowlarr reports application links for Sonarr and Radarr. Indexer providers can be added separately.']
  ];
  const rows=checks.map(([label,pass,message])=>`<li class="${pass?'pass':'fail'}"><i aria-hidden="true">${pass?'✓':'!'}</i><span><strong>${esc(label)}</strong><small>${esc(pass?message:`${message} Open the matching setup step to correct it.`)}</small></span></li>`).join('');
  return `<section class="guided-step-copy"><div><small>STEP 5 OF 5</small><h2>Verify the stack</h2><p>These results come from the current inventory response. Refresh after any change to confirm the live services agree.</p></div><span>${readiness.ready?'Ready':'Needs setup'}</span></section><section class="guided-verification ${readiness.ready?'ready':''}"><ul>${rows}</ul><div class="guided-step-actions"><button class="secondary" id="guided-refresh-inventory" type="button">Refresh inventory</button>${readiness.ready?'<span class="guided-ready-message">Provisionarr is ready to manage requests through the connected ARR stack.</span><button class="request-button" id="guided-finish-setup" type="button">Finish setup</button>':`<button class="request-button" id="guided-fix-step" type="button">Open ${esc(guidedSetupSteps[guidedFirstIncomplete(readiness)-1].label)}</button>`}</div></section>`;
}

function guidedChangeLabel(change) {
  const service=String(change.service || '').toLowerCase(),name=service === 'sonarr' ? 'Sonarr' : service === 'radarr' ? 'Radarr' : service === 'qbittorrent' ? 'qBittorrent' : 'ARR service',kind=String(change.kind || '').toLowerCase();
  if (kind.includes('root') || kind.includes('path')) return `${name} library path`;
  if (kind.includes('download') || kind.includes('client')) return `${name} download client`;
  if (kind.includes('categor')) return `${name} download category`;
  if (kind.includes('credential') || kind.includes('connection')) return `${name} connection`;
  return `${name} setup setting`;
}

function guidedPlanValue(change, side) {
  const kind=String(change.kind || '').toLowerCase(),value=change?.[side];
  if (kind.includes('root') || kind.includes('path')) {
    if (side === 'after') {
      const service=String(change.service || '').toLowerCase();
      return service === 'sonarr' ? guidedSetupState.values.sonarrRoot : service === 'radarr' ? guidedSetupState.values.radarrRoot : 'Selected path';
    }
    return value ? 'Existing path hidden' : 'Not configured';
  }
  if (kind.includes('download') || kind.includes('client') || kind.includes('credential') || kind.includes('connection') || kind.includes('categor')) return value ? (side === 'after' ? 'Configured' : 'Existing configuration') : 'Not configured';
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (value == null || value === '') return 'Not configured';
  return side === 'after' ? 'Configured' : 'Existing configuration';
}

function guidedPlanMarkup(result) {
  const plan=result.plan || {},changes=plan.changes || [];
  if (plan.isEmpty || !changes.length) return `<div class="all-clear"><strong>No bootstrap changes are needed.</strong><span>Sonarr, Radarr, and qBittorrent already match the reviewed setup values.</span><div class="guided-step-actions"><button class="request-button" id="guided-after-bootstrap" type="button">Continue to Prowlarr</button></div></div>`;
  const rows=changes.map(change=>`<article class="orchestration-change"><div><small>${esc(String(change.service || 'ARR').toUpperCase())} · SETUP</small><strong>${esc(guidedChangeLabel(change))}</strong></div><span>${esc(guidedPlanValue(change,'before'))}</span><b aria-hidden="true">→</b><span class="proposed">${esc(guidedPlanValue(change,'after'))}</span></article>`).join('');
  const explanation=result.canApply ? `This plan expires at ${new Date(result.expiresAt).toLocaleTimeString()}. Provisionarr creates a private recovery backup before writing.` : 'This development instance is preview-only. The review is available, but live writes are disabled.';
  return `<header><div><small>REDACTED REVIEW</small><h2>${changes.length} setup ${changes.length===1?'change':'changes'} proposed</h2></div><time>${new Date(result.generatedAt).toLocaleTimeString()}</time></header>${rows}<div class="orchestration-safety"><strong>Nothing has been changed.</strong><span>Paths are limited to the library roots you entered. Service addresses, usernames, passwords, and API keys stay hidden.</span></div><div class="orchestration-apply"><div><strong>${result.canApply?'Ready after confirmation.':'Preview only.'}</strong><span>${explanation}</span></div><button class="request-button" id="apply-guided-bootstrap" type="button" ${result.canApply?'':'disabled'}>${result.canApply?'Apply reviewed setup':'Apply locked'}</button></div>`;
}

async function reviewGuidedBootstrap() {
  guidedValueFields();
  const output=$('#guided-bootstrap-plan'),button=$('#guided-qbit-form button[type="submit"]');
  if (!output || !button) return;
  button.disabled=true;button.textContent='Reviewing…';output.innerHTML='<div class="empty">Checking Sonarr, Radarr, and qBittorrent…</div>';
  try {
    const result=await api('/api/admin/orchestration/bootstrap/plan',{method:'POST',body:JSON.stringify({sonarrRoot:guidedSetupState.values.sonarrRoot,radarrRoot:guidedSetupState.values.radarrRoot,qbittorrentUrl:guidedSetupState.values.qbittorrentUrl,qbittorrentUsername:guidedSetupState.values.qbittorrentUsername,qbittorrentPassword:guidedSetupState.values.qbittorrentPassword,sonarrCategory:guidedSetupState.values.sonarrCategory,radarrCategory:guidedSetupState.values.radarrCategory})});
    output.innerHTML=guidedPlanMarkup(result);
    if (result.plan?.isEmpty || !(result.plan?.changes || []).length) $('#guided-after-bootstrap').onclick=()=>{guidedSetupState.step=4;renderGuidedSetup();};
    if (result.canApply && result.plan?.changes?.length) $('#apply-guided-bootstrap').onclick=()=>applyGuidedBootstrap(result.planId);
  } catch(error) { output.innerHTML=errorPanel(error.message,'#/guided-setup');bindRetry(); }
  finally { button.disabled=false;button.textContent='Review qBittorrent setup'; }
}

async function applyGuidedBootstrap(planId) {
  if(!confirm('Apply the reviewed Sonarr, Radarr, and qBittorrent setup? Provisionarr will test the changes and keep a rollback backup.')) return;
  const button=$('#apply-guided-bootstrap');if(!button)return;button.disabled=true;button.textContent='Applying…';
  try { const result=await api(`/api/admin/orchestration/bootstrap/plans/${encodeURIComponent(planId)}/apply`,{method:'POST',body:'{}'});guidedSetupState.values.qbittorrentPassword='';guidedSetupState.step=4;showToast(result.message || 'ARR setup applied.');await renderGuidedSetup(); }
  catch(error) { showToast(error.message);button.disabled=false;button.textContent='Try again'; }
}

function bindGuidedStepControls(inventory) {
  const readiness=guidedReadiness(inventory);
  $$('[data-setup-step]').forEach(item=>{const activate=()=>{guidedSetupState.step=Number(item.dataset.setupStep);renderGuidedSetup();};item.onclick=activate;item.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate();}};});
  const next=$('#guided-next-step');if(next)next.onclick=()=>{guidedSetupState.step=2;renderGuidedSetup();};
  const back=$('#guided-back-step');if(back)back.onclick=()=>{guidedValueFields();guidedSetupState.step=Math.max(1,guidedSetupState.step-1);renderGuidedSetup();};
  const paths=$('#guided-paths-form');if(paths)paths.onsubmit=event=>{event.preventDefault();guidedValueFields();guidedSetupState.step=3;renderGuidedSetup();};
  const qbit=$('#guided-qbit-form');if(qbit)qbit.onsubmit=event=>{event.preventDefault();reviewGuidedBootstrap();};
  $$('[data-guided-field]').forEach(field=>field.addEventListener('input',()=>{guidedSetupState.values[field.dataset.guidedField]=field.value;}));
  const refresh=$('#refresh-orchestration');if(refresh)refresh.onclick=()=>renderGuidedSetup();
  const inventoryRefresh=$('#guided-refresh-inventory');if(inventoryRefresh)inventoryRefresh.onclick=()=>renderGuidedSetup();
  const fix=$('#guided-fix-step');if(fix)fix.onclick=()=>{guidedSetupState.step=guidedFirstIncomplete(readiness);renderGuidedSetup();};
  const finish=$('#guided-finish-setup');if(finish)finish.onclick=()=>{localStorage.setItem(guidedSetupCompletionKey,'true');location.hash='#/home';showToast('Setup walkthrough completed.');};
  const prowlarr=$('#prowlarr-links-form');if(prowlarr)prowlarr.onsubmit=event=>{event.preventDefault();reviewProwlarrLinks(event.currentTarget);};
}

async function renderGuidedSetup() {
  if (!ownerOnly()) return;
  const generation=routeGeneration;
  const modeLabel=bootstrap.setupMode==='managed'?'Managed stack':bootstrap.setupMode==='existing'?'Existing stack':'';
  $('#page').innerHTML=`<div class="admin-shell">${adminNavigation('guided-setup')}<div class="admin-main guided-main"><section class="page-heading admin-heading"><div><small>GUIDED ARR SETUP</small><h1>Set up the media stack.</h1><p>Connect Sonarr, Radarr, qBittorrent, and Prowlarr with plain-language steps and a review before every write.</p></div><div class="guided-heading-actions">${modeLabel?`<span>${esc(modeLabel)}</span><button class="secondary" id="guided-change-mode" type="button">Change setup mode</button>`:''}<button class="secondary" id="refresh-orchestration" type="button">Refresh</button></div></section><ol id="orchestration-steps" class="orchestration-steps guided-steps" aria-label="Setup progress"><li class="active"><span class="step-number">1</span><span>Connect services</span></li></ol><section id="orchestration-content" class="orchestration-content"><div class="empty">Reading the media stack safely…</div></section></div></div>`;
  $('#refresh-orchestration').onclick=renderGuidedSetup;
  const changeMode=$('#guided-change-mode');if(changeMode)changeMode.onclick=()=>{bootstrap.setupMode='';renderGuidedSetup();};
  if(!bootstrap.setupMode){
    $('#orchestration-steps').hidden=true;
    $('#refresh-orchestration').hidden=true;
    $('#orchestration-content').innerHTML=guidedModePicker();
    $$('[data-setup-mode]').forEach(button=>button.onclick=()=>saveGuidedSetupMode(button.dataset.setupMode));
    return;
  }
  try {
    const inventory=await api('/api/admin/orchestration/inventory');
    if(generation!==routeGeneration)return;
    guidedSetupState.inventory=inventory;
    guidedSetupState.values=guidedDefaultValues(inventory);
    const readiness=guidedReadiness(inventory),currentStep=Math.min(5,Math.max(1,Number(guidedSetupState.step)||1));
    $('#orchestration-steps').innerHTML=guidedStepIndicator(readiness);
    const core=currentStep===1?(bootstrap.setupMode==='managed'?guidedManagedServicesSection(inventory):guidedSetupConnectionSection(inventory)):currentStep===2?guidedPathsSection(inventory):currentStep===3?guidedQbitSection(inventory):currentStep===4?guidedProwlarrSection(inventory):guidedVerificationSection(inventory);
    const current=inventory.current||{},cards=(inventory.services||[]).map(service=>orchestrationServiceCard(service,current[service.id]||{})).join('');
    $('#orchestration-content').innerHTML=`<section class="guided-inventory-line"><span>Live inventory checked ${new Date(inventory.checkedAt).toLocaleTimeString()}</span><span>${readiness.ready?'All setup checks pass':'First incomplete step: '+esc(guidedSetupSteps[guidedFirstIncomplete(readiness)-1].label)}</span></section><section class="guided-core-flow">${core}</section><details class="onboarding-secondary"><summary>Media handling and backups</summary><section class="orchestration-intro orchestration-defaults"><div><small>MEDIA HANDLING</small><h2>Keep the ARR defaults understandable</h2><p>These existing settings remain available below the onboarding flow. Review changes before applying them.</p></div></section><form id="orchestration-form"><div class="orchestration-grid">${cards}</div><div class="orchestration-actions"><div><strong>Preview first, every time.</strong><span>Only the allowlisted media-handling settings will be included.</span></div><button class="request-button" id="review-orchestration" type="submit">Review settings</button></div></form><section id="orchestration-plan" class="orchestration-plan"><div class="empty">Your proposed settings will appear here.</div></section><section id="orchestration-backups" class="orchestration-plan"><div class="empty">Loading recovery history…</div></section></details>`;
    $$('[data-connection-service]').forEach(form=>form.onsubmit=event=>{event.preventDefault();saveOrchestrationConnection(form);});
    bindGuidedStepControls(inventory);
    $('#orchestration-form').onsubmit=event=>{event.preventDefault();reviewOrchestrationPlan();};
    const stackBundleForm=$('#stack-bundle-form');if(stackBundleForm)stackBundleForm.onsubmit=event=>{event.preventDefault();generateStackBundle(event.currentTarget);};
    renderOrchestrationBackups();
  } catch(error){if(generation!==routeGeneration)return;$('#orchestration-content').innerHTML=errorPanel(error.message,'#/guided-setup');bindRetry();}
}

async function directDownloadAction(id, action) {
  try {
    let result;
    if (action === 'refetch') {
      const {proposal} = await api('/api/proposals', {method:'POST', body:JSON.stringify({downloadId:id})});
      if (!confirm(`${proposal.warning}\n\nContinue?`)) {
        await api(`/api/proposals/${encodeURIComponent(proposal.id)}/cancel`, {method:'POST', body:'{}'});
        return;
      }
      result = await api(`/api/proposals/${encodeURIComponent(proposal.id)}/confirm`, {method:'POST', body:'{}'});
    } else {
      result = await api(`/api/downloads/${encodeURIComponent(id)}/${action}`, {method:'POST', body:'{}'});
    }
    showToast(result.message);
    setTimeout(renderDownloads, 600);
  }
  catch (error) { showToast(error.message); }
}

async function renderDownloads() {
  if (!ownerOnly()) return;
  const generation=routeGeneration;
  $('#page').innerHTML = `<section class="page-heading"><div><small>ADMIN OPERATIONS</small><h1>Downloads</h1><p>Detailed progress and recovery controls for the system administrator.</p></div><button class="secondary" id="refresh-downloads" type="button">Refresh</button></section><section class="download-toolbar"><span id="download-updated">Checking…</span><span>Progress · import state · recovery</span></section><section id="download-list" class="download-list"><div class="empty">Loading downloads…</div></section>`;
  $('#refresh-downloads').onclick = renderDownloads;
  try {
    const data = await api('/api/downloads');
    if(generation!==routeGeneration)return;
    $('#download-updated').textContent = `${data.connected ? 'Download client connected' : 'ARR queue connected'} · ${new Date(data.checkedAt).toLocaleTimeString()}`;
    $('#download-list').innerHTML = data.rows?.length ? data.rows.map(item => `<article class="download-row ${item.unsafeRejected ? 'unsafe-row' : ''}"><div class="download-main"><div class="download-title"><strong>${esc(item.title)}</strong><span>${esc(item.service)}</span></div><div class="progress"><i style="width:${Number(item.progress || 0)}%"></i></div><div class="download-meta"><span>${item.progress}% · ${item.state === 'downloading' ? `${bytes(item.speed)}/s` : esc(item.state)}${item.eta ? ` · ${eta(item.eta)} left` : ''}</span><span>${bytes(item.amountLeft)} remaining</span></div>${item.error ? `<p class="download-error">${esc(item.error)}</p>` : ''}${item.unsafeRejected ? '<p class="unsafe-policy">This app never opens or moves this file. The owning ARR service removes it, blocklists it, and searches for a replacement.</p>' : ''}</div><div class="download-actions"><b class="request-status ${esc(item.importing ? 'importing' : item.state)}">${esc(item.importing ? 'Importing' : item.state)}</b><button class="text-button" data-recheck="${esc(item.id)}" type="button">Recheck</button>${item.canRejectThroughArr && (item.unsafeRejected || item.state === 'failed' || item.trackedStatus === 'error') ? `<button class="text-button danger" data-refetch="${esc(item.id)}" type="button">Remove, blocklist & replace</button>` : ''}</div></article>`).join('') : '<div class="empty">Nothing is downloading right now.</div>';
    $$('[data-recheck]').forEach(button => button.onclick = () => directDownloadAction(button.dataset.recheck, 'recheck'));
    $$('[data-refetch]').forEach(button => button.onclick = () => directDownloadAction(button.dataset.refetch, 'refetch'));
    clearTimeout(routeTimer);routeTimer=setTimeout(()=>{if(location.hash.startsWith('#/downloads'))renderDownloads();},15000);
  } catch (error) { if(generation!==routeGeneration)return;$('#download-list').innerHTML = errorPanel(error.message,'#/downloads');bindRetry(); }
}

function auditLabel(action) {
  return ({login:'Signed in',login_failed:'Failed sign-in',logout:'Signed out',owner_setup:'Administrator account created',settings_updated:'Settings changed',user_created:'User added',user_deleted:'User removed',user_emby_mapping_updated:'Emby profile link changed',account_updated:'Account updated',password_changed:'Password changed',request_confirmed:'Request confirmed',request_held:'Request held for approval',pending_request_approved:'Waiting request approved',pending_request_cancelled:'Waiting request cancelled',proposal_cancelled:'Confirmation cancelled',download_recheck:'Download recheck started',release_rejection_confirmed:'Unsafe release removal confirmed',release_rejected:'Release removed and replacement started',notification_test_sent:'Test email sent',orchestration_connection_saved:'ARR service connection saved',stack_bundle_generated:'Stack bundle generated',orchestration_applied:'Guided ARR settings applied',orchestration_apply_failed:'Guided ARR settings failed',orchestration_rolled_back:'ARR settings backup restored',orchestration_rollback_failed:'ARR settings rollback failed'})[action] || String(action || 'System event').replaceAll('_',' ');
}

function auditDescription(entry) {
  const details=[];
  if(entry.title)details.push(entry.title);
  if(entry.service)details.push(entry.service);
  if(entry.targetUser)details.push(`User: ${entry.targetUser}`);
  if(entry.reason)details.push(`Reason: ${String(entry.reason).replaceAll('_',' ')}`);
  if(entry.linked!==null&&entry.linked!==undefined)details.push(entry.linked?'Profile linked':'Profile unlinked');
  if(entry.fields?.length)details.push(`Changed: ${entry.fields.join(', ')}`);
  if(entry.unsafeRejected)details.push('Blocked unsafe content');
  return details.join(' · ') || 'No additional details';
}

async function renderLogs() {
  if (!ownerOnly()) return;
  $('#page').innerHTML = `<section class="page-heading"><div><small>SYSTEM ADMINISTRATOR</small><h1>Audit log</h1><p>See who acted, when it happened, and which service changed. Passwords and service keys stay hidden.</p></div><button class="secondary" id="refresh-logs" type="button">Refresh</button></section><div class="log-toolbar"><label for="log-filter">Find an event</label><input id="log-filter" type="search" placeholder="Search event, user, title, or service"><span id="log-count" aria-live="polite"></span></div><section id="log-list" class="log-list"><div class="empty">Loading audit records…</div></section>`;
  $('#refresh-logs').onclick = renderLogs;
  try {
    const data = await api('/api/admin/logs?limit=150');
    const entries=data.entries||[],draw=filter=>{const wanted=String(filter||'').toLowerCase(),visible=entries.filter(entry=>!wanted||JSON.stringify(entry).toLowerCase().includes(wanted)||auditLabel(entry.action).toLowerCase().includes(wanted));$('#log-count').textContent=`${visible.length} of ${entries.length} events`;$('#log-list').innerHTML=visible.length?visible.map(entry=>`<article class="log-row"><div class="log-event"><strong>${esc(auditLabel(entry.action))}</strong><span>${esc(auditDescription(entry))}</span></div><div class="log-actor"><strong>${esc(entry.actor||'System')}</strong><span>${esc(entry.source||'Local service')}</span></div><time datetime="${esc(entry.at)}">${new Date(entry.at).toLocaleString()}</time></article>`).join(''):'<div class="empty">No matching audit events.</div>';};
    draw('');$('#log-filter').oninput=event=>draw(event.currentTarget.value);
  } catch (error) { $('#log-list').innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
}

async function renderActivity() {
  if (!ownerOnly()) return;
  $('#page').innerHTML = `<section class="page-heading"><div><small>ADMIN OPERATIONS</small><h1>Activity</h1><p>Detailed history of requests, downloads, and imports.</p></div></section><section id="activity-list" class="activity-list"><div class="empty">Loading…</div></section>`;
  try { const data = await api('/api/activity'); $('#activity-list').innerHTML = data.events?.length ? data.events.map(item => `<article class="activity-row"><i class="activity-dot ${item.status === 'available' ? 'good' : ''}"></i><div><strong>${esc(item.title)}</strong><span>${esc(item.service)} · ${esc(item.event.replace('downloadFolderImported','Imported'))}${item.quality ? ` · ${esc(item.quality)}` : ''}</span></div><time>${new Date(item.date).toLocaleString()}</time></article>`).join('') : '<div class="empty">No activity yet.</div>'; }
  catch (error) { $('#activity-list').innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
}

async function renderStatus() {
  if (!ownerOnly()) return;
  $('#page').innerHTML = `<section class="page-heading"><div><small>ADMIN OPERATIONS</small><h1>Status</h1><p>Detailed service, storage, and application health for the system administrator.</p></div><button class="secondary" id="refresh-status" type="button">Refresh</button></section><section id="status-cards" class="status-cards"><div class="empty">Checking…</div></section><section class="section"><div class="section-title"><h2>Needs attention</h2></div><div id="status-alerts" class="alerts"><div class="empty">Checking…</div></div></section><section class="section"><div class="section-title"><h2>Provisionarr diagnostics</h2></div><div id="diagnostics" class="status-cards"><div class="empty">Checking…</div></div></section>`;
  $('#refresh-status').onclick = renderStatus;
  try {
    const [health, integration, diagnostics] = await Promise.all([api('/api/health'), api('/api/integration'), api('/api/admin/diagnostics')]);
    healthCache = health;
    $('#status-cards').innerHTML = [...integration.services.map(service => `<article class="status-card"><div class="status-card-top"><strong>${esc(service.label)}</strong><i class="status-light ${service.ok ? 'good' : ''}"></i></div><span>${service.ok ? 'Connected' : 'Unavailable'}${service.version ? ` · v${esc(service.version)}` : ''}</span></article>`), `<article class="status-card"><div class="status-card-top"><strong>Media disk</strong><i class="status-light ${health.disk.low ? '' : 'good'}"></i></div><span>${esc(health.disk.error || `${health.disk.freeGb} GB free (${health.disk.freePercent}%)`)}</span></article>`].join('');
    $('#status-alerts').innerHTML = health.alerts?.length ? health.alerts.map(alert => `<div class="alert-line"><strong>${esc(alert.service)}:</strong> ${esc(alert.message)}</div>`).join('') : '<div class="empty">All clear.</div>';
    $('#diagnostics').innerHTML = `<article class="status-card"><div class="status-card-top"><strong>Provisionarr</strong><i class="status-light good"></i></div><span>v${esc(diagnostics.version)} · ${esc(diagnostics.platform)}</span><small>Running ${Math.floor(Number(diagnostics.uptimeSeconds||0)/60)} minutes</small></article><article class="status-card"><div class="status-card-top"><strong>Memory</strong><i class="status-light good"></i></div><span>${bytes(diagnostics.memory.rss)} resident</span><small>${bytes(diagnostics.memory.heapUsed)} JavaScript heap</small></article><article class="status-card"><div class="status-card-top"><strong>Runtime state</strong><i class="status-light good"></i></div><span>${esc(diagnostics.state.sessions)} active sessions</span><small>${esc(diagnostics.state.pendingConfirmations)} pending confirmations</small></article>`;
  } catch (error) { $('#status-cards').innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
}

function setupPanel() {
  return `<section class="auth-card owner-setup"><small>ONE-TIME OWNER SETUP</small><h2>Choose your administrator password</h2><p>Enter the one-time setup token stored on this server, then choose your own password.</p><form id="setup-form" class="form-grid"><label>Setup token<input name="setupToken" required autocomplete="off"></label><label>Username<input name="username" value="owner" required autocomplete="username"></label><label>Display name<input name="displayName" value="System Administrator" required></label><label>Email (optional)<input name="email" type="email" autocomplete="email"></label><label>New password<input name="password" type="password" minlength="10" required autocomplete="new-password"></label><button class="request-button" type="submit">Create administrator account</button></form></section>`;
}

function settingToggle(name, label, checked) {
  return `<label class="toggle-row"><span>${esc(label)}</span><input type="checkbox" name="${esc(name)}" ${checked ? 'checked' : ''}></label>`;
}

async function renderSettings(section = 'general') {
  if (!ownerOnly()) return;
  try {
    const [{settings, profiles, embyUsers = []}, {users}] = await Promise.all([api('/api/admin/settings'), api('/api/admin/users')]);
    const embyOptions = user => `<option value="">Use the shared library</option>${embyUsers.map(profile => `<option value="${esc(profile.id)}" ${user.preferences?.embyUserId === profile.id ? 'selected' : ''}>${esc(profile.name)}</option>`).join('')}`;
    $('#page').innerHTML = `<section class="page-heading"><div><small>OWNER-ONLY</small><h1>Settings</h1><p>Control request limits, storage warnings, notifications, users, and account security.</p></div></section><div class="settings-layout"><nav class="settings-nav" aria-label="Settings sections"><a href="#/settings?section=general">General</a><a href="#/settings?section=requests">Requests</a><a href="#/settings?section=notifications">Notifications</a><a href="#/settings?section=users">Users</a><a href="#/settings?section=security">Security</a></nav><div><form id="settings-form"><section class="settings-group" id="general"><h2>General</h2><p class="settings-copy">Provisionarr applies these choices through the connected ARR services.</p><div class="form-grid two"><label>Application name<input name="appName" value="${esc(settings.appName)}"></label><label>Discovery items per rail<input name="discoveryLimit" type="number" min="4" max="24" value="${esc(settings.discoveryLimit)}"></label><label>Storage warning (GB free)<input name="minFreeGb" type="number" value="${esc(settings.minFreeGb)}"></label><label>Storage warning (% free)<input name="minFreePercent" type="number" value="${esc(settings.minFreePercent)}"></label></div></section><section class="settings-group" id="requests-settings"><h2>Requests</h2><div class="form-grid two"><label>Movie quality profile<select name="movieQualityProfileId">${profiles.movies.map(p => `<option value="${p.id}" ${Number(settings.movieQualityProfileId) === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label><label>TV quality profile<select name="tvQualityProfileId">${profiles.tv.map(p => `<option value="${p.id}" ${Number(settings.tvQualityProfileId) === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label></div>${settingToggle('autoSearch','Start searching after a request',settings.autoSearch)}${settingToggle('allowUserRefetch','Allow users to retry ordinary failed requests',settings.allowUserRefetch)}</section><section class="settings-group" id="notifications-settings"><h2>Email notifications</h2><p class="settings-copy">Provisionarr stores SMTP credentials on this server and never returns them to the browser.</p><div class="form-grid two"><label>SMTP host<input name="smtpHost" value="${esc(settings.smtpHost || '')}" placeholder="smtp.example.com"></label><label>Port<input name="smtpPort" type="number" value="${esc(settings.smtpPort || 587)}"></label><label>Username<input name="smtpUser" value="${esc(settings.smtpUser || '')}" autocomplete="off"></label><label>Password<input name="smtpPass" type="password" placeholder="${settings.smtpPasswordSet ? 'Saved; leave blank to keep' : 'SMTP password'}" autocomplete="new-password"></label><label>From address<input name="smtpFrom" value="${esc(settings.smtpFrom || '')}" placeholder="Provisionarr &lt;arr@example.com&gt;"></label></div>${settingToggle('smtpSecure','Use implicit TLS',settings.smtpSecure)}${settingToggle('notificationsEnabled','Enable notifications',settings.notificationsEnabled)}${settingToggle('notifyAvailable','When a request is ready',settings.notifyAvailable)}${settingToggle('notifyFailed','When a request needs attention',settings.notifyFailed)}${settingToggle('notifyDiskLow','When storage is low',settings.notifyDiskLow)}<button type="button" class="secondary" id="test-email">Send test email</button></section><button class="request-button save-settings" type="submit">Save settings</button></form><section class="settings-group" id="users-settings"><h2>Users</h2><p class="settings-copy">Each person has a separate account and request history. Link an Emby profile to use that person's watch history for recommendations.</p><div id="user-list" class="request-list">${users.map(user => `<article class="request-row user-admin-row"><div class="user-identity"><strong>${esc(user.displayName)}</strong><span>@${esc(user.username)}${user.email ? ` · ${esc(user.email)}` : ''}</span></div><label class="emby-link">Emby recommendation profile<select data-emby-user="${esc(user.id)}">${embyOptions(user)}</select></label><div class="user-actions"><button class="text-button" data-save-emby-user="${esc(user.id)}" type="button">Save profile</button>${user.role !== 'owner' ? `<button class="text-button danger" data-delete-user="${esc(user.id)}" type="button">Remove</button>` : '<b class="request-status">ADMIN</b>'}</div></article>`).join('')}</div><form id="user-form" class="form-grid two compact"><label>Username<input name="username" required></label><label>Display name<input name="displayName" required></label><label>Email<input name="email" type="email"></label><label>Temporary password<input name="password" type="password" minlength="10" required></label><button class="secondary" type="submit">Add user</button></form></section><section class="settings-group" id="security-settings"><h2>Security</h2><p class="settings-copy">Changing the administrator password signs out every active session for that account.</p><form id="password-form" class="form-grid two"><label>Current password<input name="currentPassword" type="password" required autocomplete="current-password"></label><label>New password<input name="newPassword" type="password" minlength="10" required autocomplete="new-password"></label><button class="secondary" type="submit">Change password</button></form></section></div></div>`;
    $('#requests-settings .form-grid').insertAdjacentHTML('beforeend', `<label>Active requests per user<input name="userActiveRequestLimit" type="number" min="1" max="20" value="${esc(settings.userActiveRequestLimit || 3)}"></label>`);
    $('#requests-settings').insertAdjacentHTML('beforeend', `${settingToggle('userAutoApprove','Automatically approve requests within each user allotment',settings.userAutoApprove)}${settingToggle('pauseRequestsWhenStorageLow','Pause user requests when storage is low',settings.pauseRequestsWhenStorageLow)}`);
    bindSettings(settings);
    const sectionIds = {general:'general',requests:'requests-settings',notifications:'notifications-settings',users:'users-settings',security:'security-settings'};
    const target = document.getElementById(sectionIds[section] || sectionIds.general);
    const activeSection = sectionIds[section] ? section : 'general';
    document.querySelector(`.settings-nav a[href$="section=${activeSection}"]`)?.setAttribute('aria-current','page');
    requestAnimationFrame(() => target?.scrollIntoView({block:'start'}));
  } catch (error) { $('#page').innerHTML = `<div class="empty">${esc(error.message)}</div>`; }
}

function bindSettings(settings) {
  $('#settings-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
    ['autoSearch','allowUserRefetch','userAutoApprove','pauseRequestsWhenStorageLow','smtpSecure','notificationsEnabled','notifyAvailable','notifyFailed','notifyDiskLow'].forEach(name => data[name] = form.elements[name].checked);
    ['minFreeGb','minFreePercent','userActiveRequestLimit','discoveryLimit','movieQualityProfileId','tvQualityProfileId','smtpPort'].forEach(name => data[name] = Number(data[name]));
    try { await api('/api/admin/settings', {method:'PUT', body:JSON.stringify(data)}); await loadBootstrap(); showToast('Settings saved.'); }
    catch (error) { showToast(error.message); }
  };
  $('#user-form').onsubmit = async event => { event.preventDefault(); try { await api('/api/admin/users', {method:'POST', body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))}); showToast('User created.'); renderSettings('users'); } catch (error) { showToast(error.message); } };
  $('#test-email').onclick = async () => { try { const result = await api('/api/admin/notifications/test', {method:'POST', body:'{}'}); showToast(result.message); } catch (error) { showToast(error.message); } };
  $$('[data-save-emby-user]').forEach(button => button.onclick = async () => { const id=button.dataset.saveEmbyUser,select=document.querySelector(`[data-emby-user="${CSS.escape(id)}"]`);button.disabled=true;try{await api(`/api/admin/users/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({embyUserId:select.value})});showToast(select.value?'Recommendation profile linked.':'Using shared-library recommendations.');renderSettings('users');}catch(error){button.disabled=false;showToast(error.message);}});
  $$('[data-delete-user]').forEach(button => button.onclick = async () => { if (!confirm('Remove this user and end their sessions?')) return; try { await api(`/api/admin/users/${encodeURIComponent(button.dataset.deleteUser)}`, {method:'DELETE', body:'{}'}); renderSettings('users'); } catch (error) { showToast(error.message); } });
  $('#password-form').onsubmit = async event => { event.preventDefault(); try { await api('/api/account/password', {method:'PUT', body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))}); bootstrap = {...bootstrap, authenticated:false, ownerAuthenticated:false, csrf:null, user:null}; showToast('Password changed. Sign in again.'); renderAccount(); } catch (error) { showToast(error.message); } };
}

async function renderSetup() {
    $('#page').innerHTML = `<section class="page-heading"><div><small>SECURE FIRST RUN</small><h1>Set up Provisionarr</h1><p>Create the system administrator account before inviting anyone else.</p></div></section>${setupPanel()}`;
  $('#setup-form').onsubmit = async event => { event.preventDefault(); try { await api('/api/admin/setup', {method:'POST', body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))}); await loadBootstrap(); showToast('Administrator account created.'); location.hash = '#/admin'; } catch (error) { showToast(error.message); } };
}

async function logout() {
  try { await api('/api/auth/logout', {method:'POST', body:'{}'}); } catch {}
  bootstrap = {...bootstrap, authenticated:false, ownerAuthenticated:false, csrf:null, user:null};
  await loadBootstrap(); location.hash = '#/home'; showToast('Signed out.');
}

function setNav(name) {
  setNavVisibility();
  const attention = Boolean(healthCache?.needsAttention || healthCache?.alerts?.length || healthCache?.disk?.low);
  $('#health-dot').classList.toggle('bad', attention);
  $('#health-label').textContent = bootstrap.ownerAuthenticated ? (attention ? 'Needs attention' : healthCache ? 'All clear' : 'Checking') : (attention ? 'Needs attention' : '');
}

async function route() {
  routeGeneration += 1;
  clearTimeout(routeTimer);
  const legacy = location.hash.match(/^#(general|requests-settings|notifications-settings|users-settings|security-settings)$/);
  if (legacy) { location.replace(`#\/settings?section=${legacy[1].replace('-settings','')}`); return; }
  const raw = location.hash.replace(/^#\//, '') || 'home';
  const [name, queryString] = raw.split('?');
  setNav(name);
  if (bootstrap.adminConfigured && !bootstrap.authenticated && !['account','settings'].includes(name)) { location.hash = '#/account'; return renderAccount(); }
  const params = new URLSearchParams(queryString || '');
  if (name === 'search') return renderSearch(params.get('query') || '');
  if (name === 'library') return renderLibrary();
  if (name === 'requests') return renderRequests();
  if (name === 'notifications') return renderNotifications();
  if (name === 'account') return renderAccount();
  if (name === 'admin') return renderAdmin();
  if (name === 'guided-setup') return renderGuidedSetup();
  if (name === 'downloads') return renderDownloads();
  if (name === 'activity') return renderActivity();
  if (name === 'status') return renderStatus();
  if (name === 'logs') return renderLogs();
  if (name === 'settings') return bootstrap.adminConfigured ? renderSettings(params.get('section') || 'general') : renderSetup();
  return renderHome();
}

async function loadHealth() {
  if(!bootstrap.authenticated)return;
  try {
    healthCache = await api('/api/health');
    setNav((location.hash.match(/^#\/([^?]+)/) || [,'home'])[1]);
    const fresh = (healthCache.alerts || []).filter(alert => !lastAlertIds.has(alert.id));
    if (fresh.length && 'Notification' in window && Notification.permission === 'granted') new Notification(`${bootstrap.appName} needs attention`, {body:bootstrap.ownerAuthenticated ? fresh[0].message : friendlyFailure()});
    lastAlertIds = new Set((healthCache.alerts || []).map(alert => alert.id));
  } catch { if (bootstrap.ownerAuthenticated) $('#health-label').textContent = 'Status unavailable'; }
}

$('#account').onclick = () => { location.hash = '#/account'; };
$('#mobile-menu').onclick = () => { const button = $('#mobile-menu'), expanded = button.getAttribute('aria-expanded') === 'true'; button.setAttribute('aria-expanded', String(!expanded)); $('#primary-nav').classList.toggle('open', !expanded); };
document.addEventListener('keydown',event=>{if(event.key==='Escape'){const menu=$('#primary-nav');if(menu.classList.contains('open')){$('#mobile-menu').setAttribute('aria-expanded','false');menu.classList.remove('open');$('#mobile-menu').focus();}}});
document.addEventListener('click',event=>{const menu=$('#primary-nav'),button=$('#mobile-menu');if(menu.classList.contains('open')&&!menu.contains(event.target)&&event.target!==button){button.setAttribute('aria-expanded','false');menu.classList.remove('open');}});
$('#close-details').onclick = () => $('#details').close();
$('#close-confirm').onclick = () => $('#confirm-dialog').close();
$$('#primary-nav a').forEach(link => link.addEventListener('click', () => { $('#mobile-menu').setAttribute('aria-expanded', 'false'); $('#primary-nav').classList.remove('open'); }));
window.addEventListener('hashchange', route);

(async () => {
  try { await loadBootstrap(); } catch (error) {
    $('#page').innerHTML = `<section class="page-heading"><div><small>CONNECTION ISSUE</small><h1>Provisionarr is temporarily unavailable</h1><p>${esc(error.message)}</p></div></section><section class="auth-card"><button class="request-button" id="retry-startup" type="button">Try again</button></section>`;
    $('#retry-startup').onclick = () => location.reload();
    showToast(error.message);
    return;
  }
  await route();
  loadHealth();
  setInterval(loadHealth, 60000);
})();
