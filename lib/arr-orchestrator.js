'use strict';

// Pure planning primitives for a deliberately small, allowlisted ARR settings surface.

const SERVICES = Object.freeze(['sonarr', 'radarr']);

const SERVICE_SCHEMA = Object.freeze({
  sonarr: Object.freeze({
    mediaManagement: Object.freeze({
      renameFiles: 'renameEpisodes',
      replaceIllegalCharacters: 'replaceIllegalCharacters',
      importExtraFiles: 'importExtraFiles'
    }),
    downloadHandling: Object.freeze({
      completedDownloadHandling: 'enableCompletedDownloadHandling',
      removeCompletedDownloads: 'removeCompletedDownloads'
    })
  }),
  radarr: Object.freeze({
    mediaManagement: Object.freeze({
      renameFiles: 'renameMovies',
      replaceIllegalCharacters: 'replaceIllegalCharacters',
      importExtraFiles: 'importExtraFiles'
    }),
    downloadHandling: Object.freeze({
      completedDownloadHandling: 'enableCompletedDownloadHandling',
      removeCompletedDownloads: 'removeCompletedDownloads'
    })
  })
});

// Kept separate so endpoint paths cannot be supplied by callers.
const ENDPOINTS = Object.freeze({
  mediaManagement: '/api/v3/config/mediamanagement',
  downloadHandling: '/api/v3/config/downloadclient'
});

const SECRET_NAME = /(?:api.?key|token|secret|password|passwd|authorization|cookie|credential|private.?key|access.?key|client.?secret)/i;
const SAFE_KEY = /^[A-Za-z][A-Za-z0-9]*$/;
const VALID_SERVICES = new Set(SERVICES);
const VALID_GROUPS = new Set(['mediaManagement', 'downloadHandling']);

function nativeField(service, group, key) {
  return SERVICE_SCHEMA[service][group][key];
}

function fail(message, path) {
  throw new TypeError(path ? `${path}: ${message}` : message);
}

function assertPlainObject(value, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('expected a plain object', path);
  }
}

function assertSafeKey(key, path) {
  if (typeof key !== 'string' || !SAFE_KEY.test(key) || SECRET_NAME.test(key)) {
    fail('unknown or sensitive field is not allowed', path);
  }
}

function assertBoolean(value, path) {
  if (typeof value !== 'boolean') fail('expected a boolean', path);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateDesired(desired) {
  assertPlainObject(desired, 'desired');
  for (const service of Object.keys(desired)) {
    assertSafeKey(service, `desired.${service}`);
    if (!VALID_SERVICES.has(service)) fail('service is not supported', `desired.${service}`);
    assertPlainObject(desired[service], `desired.${service}`);
    for (const group of Object.keys(desired[service])) {
      assertSafeKey(group, `desired.${service}.${group}`);
      if (!VALID_GROUPS.has(group)) fail('setting group is not supported', `desired.${service}.${group}`);
      assertPlainObject(desired[service][group], `desired.${service}.${group}`);
      for (const key of Object.keys(desired[service][group])) {
        const path = `desired.${service}.${group}.${key}`;
        assertSafeKey(key, path);
        if (!Object.hasOwn(SERVICE_SCHEMA[service][group], key)) fail('setting is not supported', path);
        assertBoolean(desired[service][group][key], path);
      }
    }
  }
  return desired;
}

function validateCurrent(current) {
  if (current === undefined) return {};
  assertPlainObject(current, 'current');
  for (const service of Object.keys(current)) {
    if (!VALID_SERVICES.has(service)) fail('service is not supported', `current.${service}`);
    assertPlainObject(current[service], `current.${service}`);
    for (const group of Object.keys(current[service])) {
      if (!VALID_GROUPS.has(group)) fail('setting group is not supported', `current.${service}.${group}`);
      assertPlainObject(current[service][group], `current.${service}.${group}`);
      for (const key of Object.keys(current[service][group])) {
        if (SECRET_NAME.test(key)) fail('sensitive fields cannot be supplied or echoed', `current.${service}.${group}.${key}`);
        if (!Object.hasOwn(SERVICE_SCHEMA[service][group], key)) fail('setting is not supported', `current.${service}.${group}.${key}`);
        assertBoolean(current[service][group][key], `current.${service}.${group}.${key}`);
      }
    }
  }
  return current;
}

function buildPlan(desired, current, mode) {
  validateDesired(desired);
  validateCurrent(current);
  const changes = [];
  for (const service of SERVICES) {
    const desiredService = desired[service];
    if (!desiredService) continue;
    const currentService = current[service] || {};
    for (const group of VALID_GROUPS) {
      const desiredGroup = desiredService[group];
      if (!desiredGroup) continue;
      const currentGroup = currentService[group] || {};
      for (const key of Object.keys(desiredGroup).sort()) {
        if (currentGroup[key] !== desiredGroup[key]) {
          changes.push(Object.freeze({
            service,
            group,
            setting: key,
            nativeField: nativeField(service, group, key),
            before: Object.hasOwn(currentGroup, key) ? currentGroup[key] : undefined,
            after: desiredGroup[key]
          }));
        }
      }
    }
  }
  const requests = [];
  for (const service of SERVICES) {
    const grouped = new Map();
    for (const change of changes.filter((item) => item.service === service)) {
      if (!grouped.has(change.group)) grouped.set(change.group, {});
      grouped.get(change.group)[change.nativeField] = change.after;
    }
    for (const group of ['mediaManagement', 'downloadHandling']) {
      if (grouped.has(group)) requests.push(Object.freeze({
        service,
        method: 'PUT',
        path: ENDPOINTS[group],
        body: Object.freeze(grouped.get(group))
      }));
    }
  }
  return Object.freeze({
    version: 1,
    mode,
    changes: Object.freeze(changes),
    requests: Object.freeze(requests),
    isEmpty: changes.length === 0
  });
}

function preview(desired, current = {}) {
  return buildPlan(desired, current, 'preview');
}

function diff(desired, current = {}) {
  return buildPlan(desired, current, 'diff');
}

function isSafePlan(plan) {
  if (!plan || plan.version !== 1 || !Array.isArray(plan.changes) || !Array.isArray(plan.requests)) return false;
  return plan.requests.every((request) =>
    request.method === 'PUT' &&
    VALID_SERVICES.has(request.service) &&
    Object.values(ENDPOINTS).includes(request.path) &&
    request.body && typeof request.body === 'object' &&
    Object.keys(request.body).every((field) => {
      const group = request.path === ENDPOINTS.mediaManagement ? 'mediaManagement' : 'downloadHandling';
      const allowed = new Set(Object.values(SERVICE_SCHEMA[request.service][group]));
      return allowed.has(field) && typeof request.body[field] === 'boolean' && !SECRET_NAME.test(field);
    })
  );
}

function applicationRequests(plan) {
  if (!isSafePlan(plan)) fail('plan is invalid or contains an unsafe request', 'plan');
  return clone(plan.requests);
}

module.exports = Object.freeze({
  SERVICES,
  ENDPOINTS,
  preview,
  diff,
  isSafePlan,
  applicationRequests
});
