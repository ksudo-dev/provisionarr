import assert from 'node:assert/strict';

const [baseURL, setupToken, sonarrURL, sonarrKey, radarrURL, radarrKey] = process.argv.slice(2);
if (![baseURL, setupToken, sonarrURL, sonarrKey, radarrURL, radarrKey].every(Boolean)) {
  throw new Error('Usage: disposable-arr-smoke.mjs APP_URL SETUP_TOKEN SONARR_URL SONARR_KEY RADARR_URL RADARR_KEY');
}

async function request(url, {method='GET', cookie='', csrf='', body}={}) {
  const headers = {'accept':'application/json'};
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(url, {method, headers, body:body === undefined ? undefined : JSON.stringify(body)});
  let payload = {};
  try { payload = await response.json(); } catch {}
  return {response, payload};
}

async function app(path, options) {
  return request(`${baseURL}${path}`, options);
}

async function arr(base, key, path) {
  const response = await fetch(`${base}${path}`, {headers:{'X-Api-Key':key, accept:'application/json'}});
  assert.equal(response.ok, true, `${path} returned ${response.status}`);
  return response.json();
}

async function proposal(session, mediaRef) {
  const created = await app('/api/proposals', {
    method:'POST', cookie:session.cookie, csrf:session.csrf, body:{mediaRef}
  });
  assert.equal(created.response.status, 201);
  return created.payload.proposal;
}

async function confirm(session, proposalId) {
  return app(`/api/proposals/${proposalId}/confirm`, {
    method:'POST', cookie:session.cookie, csrf:session.csrf, body:{}
  });
}

const setup = await app('/api/admin/setup', {
  method:'POST',
  body:{
    setupToken,
    username:'releaseowner',
    displayName:'Release Owner',
    password:'disposable-owner-password'
  }
});
assert.equal(setup.response.status, 201, JSON.stringify(setup.payload));
const owner = {
  cookie:setup.response.headers.get('set-cookie').split(';')[0],
  csrf:setup.payload.csrf
};

const userCreated = await app('/api/admin/users', {
  method:'POST', cookie:owner.cookie, csrf:owner.csrf,
  body:{username:'releaseuser', displayName:'Release User', password:'disposable-user-password'}
});
assert.equal(userCreated.response.status, 201, JSON.stringify(userCreated.payload));

const settings = await app('/api/admin/settings', {
  method:'PUT', cookie:owner.cookie, csrf:owner.csrf,
  body:{userAutoApprove:false, pauseRequestsWhenStorageLow:false, minFreeGb:1, minFreePercent:1}
});
assert.equal(settings.response.status, 200, JSON.stringify(settings.payload));

const seriesSearch = await app('/api/search?q=Southpark%20season%201', {cookie:owner.cookie});
assert.equal(seriesSearch.response.status, 200);
const southPark = seriesSearch.payload.results.find(item => item.title === 'South Park' && item.seasonNumber === 1);
assert.ok(southPark, 'Native Sonarr lookup did not return South Park Season 1');
const seriesProposal = await proposal(owner, southPark.mediaRef);
const seriesConfirmation = await confirm(owner, seriesProposal.id);
assert.equal(seriesConfirmation.response.status, 201, JSON.stringify(seriesConfirmation.payload));
assert.equal(seriesConfirmation.payload.accepted, true);
assert.equal(seriesConfirmation.payload.seasonSearchStarted, true);
const series = await arr(sonarrURL, sonarrKey, '/api/v3/series');
const addedSeries = series.find(item => item.title === 'South Park');
assert.ok(addedSeries, 'South Park was not added to Sonarr');
assert.equal(addedSeries.seasons.find(season => season.seasonNumber === 1)?.monitored, true);

const login = await app('/api/auth/login', {
  method:'POST', body:{username:'releaseuser', password:'disposable-user-password'}
});
assert.equal(login.response.status, 200, JSON.stringify(login.payload));
const user = {
  cookie:login.response.headers.get('set-cookie').split(';')[0],
  csrf:login.payload.csrf
};
const forbidden = await app('/api/admin/overview', {cookie:user.cookie});
assert.equal(forbidden.response.status, 403);

const movieSearch = await app('/api/search?q=Inception', {cookie:user.cookie});
assert.equal(movieSearch.response.status, 200);
const inception = movieSearch.payload.results.find(item => item.title === 'Inception');
assert.ok(inception, 'Native Radarr lookup did not return Inception');
const movieProposal = await proposal(user, inception.mediaRef);
const held = await confirm(user, movieProposal.id);
assert.equal(held.response.status, 201, JSON.stringify(held.payload));
assert.equal(held.payload.accepted, false);
assert.equal(held.payload.pendingApproval, true);

const userRequests = await app('/api/requests', {cookie:user.cookie});
assert.equal(userRequests.response.status, 200);
assert.equal(userRequests.payload.requests.length, 1);
assert.equal(userRequests.payload.requests[0].title, 'Inception');
assert.equal(userRequests.payload.requests[0].status, 'pending_approval');

const approved = await app(`/api/admin/requests/${held.payload.requestId}/approve`, {
  method:'POST', cookie:owner.cookie, csrf:owner.csrf, body:{}
});
assert.equal(approved.response.status, 200, JSON.stringify(approved.payload));
assert.equal(approved.payload.accepted, true);
const movies = await arr(radarrURL, radarrKey, '/api/v3/movie');
assert.ok(movies.some(item => item.title === 'Inception'), 'Inception was not added to Radarr');

console.log('Disposable ARR smoke passed: owner season request, user hold, owner approval, and role isolation.');
