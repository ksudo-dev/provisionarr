'use strict';

// Pure planning primitives for connecting fresh Sonarr and Radarr instances
// to qBittorrent without allowing callers to choose arbitrary ARR endpoints.

const crypto = require('node:crypto');

const SERVICES = Object.freeze(['sonarr', 'radarr']);
const INPUT_FIELDS = Object.freeze([
  'sonarrRoot',
  'radarrRoot',
  'qbittorrentUrl',
  'qbittorrentUsername',
  'qbittorrentPassword',
  'sonarrCategory',
  'radarrCategory'
]);

const ROOT_ENDPOINT = '/api/v3/rootfolder';
const DOWNLOAD_CLIENT_ENDPOINT = '/api/v3/downloadclient';
const MANAGED_CLIENT_NAME = 'Provisionarr qBittorrent';
const DOWNLOAD_CLIENT_CONTRACT = 'QBittorrentSettings';
const DOWNLOAD_CLIENT_IMPLEMENTATION = 'QBittorrent';

const QBIT_FIELD_NAMES = new Set([
  'host',
  'port',
  'useSsl',
  'urlBase',
  'username',
  'password',
  'tvCategory',
  'movieCategory'
]);
const SAFE_SCHEMA_TOP_LEVEL_FIELDS = new Set([
  'name',
  'enable',
  'priority',
  'implementationName',
  'implementation',
  'configContract',
  'infoLink',
  'tags',
  'presets',
  'fields',
  'protocol',
  'removeCompletedDownloads',
  'removeFailedDownloads',
  'id'
]);
const SECRET_NAME = /(?:api.?key|token|secret|authorization|cookie|credential|private.?key|access.?key|client.?secret)/i;
const SAFE_FIELD_NAME = /^[A-Za-z][A-Za-z0-9.]{0,79}$/;
const MASKED_SECRET = /^\*{4,}$/;
const SENSITIVE_ROOTS = Object.freeze([
  '/',
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/lib',
  '/lib32',
  '/lib64',
  '/lost+found',
  '/proc',
  '/root',
  '/run',
  '/sbin',
  '/sys',
  '/tmp',
  '/usr',
  '/var'
]);
const URL_LIMIT = 2048;
const PATH_LIMIT = 4096;
const CREDENTIAL_LIMIT = 256;
const CATEGORY_LIMIT = 128;

function fail(message, path) {
  throw new TypeError(path ? `${path}: ${message}` : message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function assertPlainObject(value, path) {
  if (!isPlainObject(value)) fail('expected a plain object', path);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

function assertCleanString(value, path, limit, label) {
  if (typeof value !== 'string') fail(`${label || 'value'} must be a string`, path);
  if (value.length === 0 || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(`${label || 'value'} is invalid`, path);
  }
  return value;
}

function inputString(value, path, limit, label) {
  const raw = assertCleanString(value, path, limit, label);
  const result = raw.trim();
  if (!result) fail(`${label || 'value'} cannot be empty`, path);
  return result;
}

function normalizeRoot(value, path) {
  const raw = inputString(value, path, PATH_LIMIT, 'root path');
  if (!raw.startsWith('/') || raw.includes('\\') || raw.split('/').some((segment) => segment === '..' || segment === '.')) {
    fail('must be a safe absolute Linux path', path);
  }
  const normalized = raw.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  if (normalized === '/' || SENSITIVE_ROOTS.some((root) => root !== '/' && (normalized === root || normalized.startsWith(`${root}/`)))) {
    fail('must not target a system root', path);
  }
  return normalized;
}

function parseQbittorrentUrl(value) {
  const raw = inputString(value, 'choices.qbittorrentUrl', URL_LIMIT, 'qBittorrent URL');
  const authorityEnd = raw.indexOf('//') + 2;
  const rawPathStart = authorityEnd > 1 ? raw.indexOf('/', authorityEnd) : -1;
  const rawPath = rawPathStart === -1 ? '' : raw.slice(rawPathStart).split(/[?#]/, 1)[0];
  if (rawPath.split('/').some((segment) => segment === '..' || segment === '.')) {
    fail('URL path cannot contain traversal segments', 'choices.qbittorrentUrl');
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail('must be a valid HTTP or HTTPS URL', 'choices.qbittorrentUrl');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail('must be an HTTP or HTTPS URL without credentials, query, or fragment', 'choices.qbittorrentUrl');
  }
  const urlBase = (parsed.pathname || '').replace(/\/+/g, '/').replace(/\/$/, '');
  return Object.freeze({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80),
    useSsl: parsed.protocol === 'https:',
    urlBase
  });
}

function validateChoices(choices) {
  assertPlainObject(choices, 'choices');
  const keys = Object.keys(choices).sort();
  const expected = [...INPUT_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('contains unsupported or missing fields', 'choices');
  }
  return Object.freeze({
    sonarrRoot: normalizeRoot(choices.sonarrRoot, 'choices.sonarrRoot'),
    radarrRoot: normalizeRoot(choices.radarrRoot, 'choices.radarrRoot'),
    qbittorrentUrl: inputString(choices.qbittorrentUrl, 'choices.qbittorrentUrl', URL_LIMIT, 'qBittorrent URL'),
    qbittorrentUsername: inputString(choices.qbittorrentUsername, 'choices.qbittorrentUsername', CREDENTIAL_LIMIT, 'qBittorrent username'),
    qbittorrentPassword: inputString(choices.qbittorrentPassword, 'choices.qbittorrentPassword', CREDENTIAL_LIMIT, 'qBittorrent password'),
    sonarrCategory: inputString(choices.sonarrCategory, 'choices.sonarrCategory', CATEGORY_LIMIT, 'Sonarr category'),
    radarrCategory: inputString(choices.radarrCategory, 'choices.radarrCategory', CATEGORY_LIMIT, 'Radarr category')
  });
}

function validateSnapshot(snapshot) {
  assertPlainObject(snapshot, 'snapshot');
  for (const service of Object.keys(snapshot)) {
    if (!SERVICES.includes(service)) fail('service is not supported', `snapshot.${service}`);
  }
  const result = {};
  for (const service of SERVICES) {
    const source = snapshot[service] || {};
    assertPlainObject(source, `snapshot.${service}`);
    const keys = Object.keys(source).sort();
    const expected = ['downloadClientSchemas', 'downloadClients', 'rootFolders'];
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
      fail('must contain rootFolders, downloadClients, and downloadClientSchemas', `snapshot.${service}`);
    }
    for (const key of expected) {
      if (!Array.isArray(source[key])) fail('must be an array', `snapshot.${service}.${key}`);
      for (const item of source[key]) assertPlainObject(item, `snapshot.${service}.${key}`);
    }
    result[service] = {
      rootFolders: source.rootFolders,
      downloadClients: source.downloadClients,
      downloadClientSchemas: source.downloadClientSchemas
    };
  }
  return result;
}

function schemaFor(service, schemas) {
  const matches = schemas.filter((schema) =>
    String(schema.implementation || '').toLowerCase() === 'qbittorrent' ||
    String(schema.configContract || '') === DOWNLOAD_CLIENT_CONTRACT
  );
  const schema = matches[0];
  if (!schema) fail(`qBittorrent schema is missing for ${service}`, `snapshot.${service}.downloadClientSchemas`);
  assertPlainObject(schema, `snapshot.${service}.downloadClientSchemas`);
  if (!Array.isArray(schema.fields)) fail('qBittorrent schema fields are missing', `snapshot.${service}.downloadClientSchemas`);
  return schema;
}

function schemaFieldMap(schema, service) {
  const map = new Map();
  for (const field of schema.fields) {
    assertPlainObject(field, `snapshot.${service}.downloadClientSchemas.fields`);
    const name = field.name;
    if (typeof name !== 'string' || !SAFE_FIELD_NAME.test(name) || map.has(name)) {
      fail('qBittorrent schema contains an invalid or duplicate field', `snapshot.${service}.downloadClientSchemas.fields`);
    }
    if (SECRET_NAME.test(name) && !QBIT_FIELD_NAMES.has(name)) {
      fail('qBittorrent schema contains an unsupported sensitive field', `snapshot.${service}.downloadClientSchemas.fields.${name}`);
    }
    map.set(name, clone(field));
  }
  return map;
}

function fieldMap(resource) {
  const map = new Map();
  for (const field of Array.isArray(resource?.fields) ? resource.fields : []) {
    if (isPlainObject(field) && typeof field.name === 'string' && !map.has(field.name)) map.set(field.name, field);
  }
  return map;
}

function ensureField(fields, name) {
  if (!fields.has(name)) fields.set(name, { name });
}

function setField(fields, name, value) {
  if (!fields.has(name)) return;
  fields.get(name).value = value;
}

function downloadClientBody(schema, service, choices, existing) {
  const body = clone(schema);
  const fields = schemaFieldMap(schema, service);
  for (const name of ['host', 'port', 'useSsl', 'urlBase', 'username', 'password']) ensureField(fields, name);
  const categoryField = service === 'sonarr' ? 'tvCategory' : 'movieCategory';
  ensureField(fields, categoryField);
  const connection = parseQbittorrentUrl(choices.qbittorrentUrl);
  setField(fields, 'host', connection.host);
  setField(fields, 'port', connection.port);
  setField(fields, 'useSsl', connection.useSsl);
  setField(fields, 'urlBase', connection.urlBase);
  setField(fields, 'username', choices.qbittorrentUsername);
  setField(fields, 'password', choices.qbittorrentPassword);
  setField(fields, categoryField, service === 'sonarr' ? choices.sonarrCategory : choices.radarrCategory);

  body.name = MANAGED_CLIENT_NAME;
  body.enable = true;
  body.priority = 1;
  body.implementation = DOWNLOAD_CLIENT_IMPLEMENTATION;
  body.configContract = DOWNLOAD_CLIENT_CONTRACT;
  body.protocol = 'torrent';
  body.removeCompletedDownloads = true;
  body.removeFailedDownloads = true;
  body.tags = [];
  body.fields = [...fields.values()];
  if (existing) {
    if (!Number.isInteger(existing.id) || existing.id < 1) fail('managed qBittorrent client has an invalid id', `snapshot.${service}.downloadClients`);
    body.id = existing.id;
  } else {
    delete body.id;
  }
  return body;
}

function currentRoot(service, roots, desiredPath) {
  return roots.find((root) => {
    if (typeof root.path !== 'string') return false;
    try {
      return normalizeRoot(root.path, `snapshot.${service}.rootFolders`) === desiredPath;
    } catch {
      return false;
    }
  });
}

function managedClient(clients) {
  return clients.find((client) => client.name === MANAGED_CLIENT_NAME) || null;
}

function publicChanges(requests) {
  return requests.map((request) => {
    if (request.resource === 'rootFolder') {
      return {
        service: request.service,
        kind: 'rootFolder',
        action: request.action,
        label: 'Media root folder',
        before: 'Not configured',
        after: request.body.path
      };
    }
    const categoryField=request.service==='sonarr'?'tvCategory':'movieCategory';
    const category=fieldMap(request.body).get(categoryField)?.value;
    return {
      service: request.service,
      kind: 'downloadClient',
      action: request.method === 'POST' ? 'create' : 'update',
      label: MANAGED_CLIENT_NAME,
      before: request.method === 'POST' ? 'Not configured' : 'Existing managed client',
      after: `Configured qBittorrent download client${category?` using ${category}`:''}`
    };
  });
}

function canonicalRequests(requests) {
  return JSON.stringify(requests);
}

function integrity(plan) {
  const signed = {
    version: plan.version,
    mode: plan.mode,
    changes: plan.changes,
    requests: plan.requests,
    isEmpty: plan.isEmpty
  };
  return crypto.createHash('sha256').update(JSON.stringify(signed)).digest('hex');
}

function buildPlan(choicesInput, snapshotInput) {
  const choices = validateChoices(choicesInput);
  const snapshot = validateSnapshot(snapshotInput || {});
  const requests = [];

  for (const service of SERVICES) {
    const rootPath = service === 'sonarr' ? choices.sonarrRoot : choices.radarrRoot;
    if (!currentRoot(service, snapshot[service].rootFolders, rootPath)) {
      requests.push({
        service,
        resource: 'rootFolder',
        action: 'create',
        method: 'POST',
        path: ROOT_ENDPOINT,
        body: { path: rootPath },
        original: null
      });
    }

    const current = managedClient(snapshot[service].downloadClients);
    const schema = schemaFor(service, snapshot[service].downloadClientSchemas);
    const body = downloadClientBody(schema, service, choices, current);
    if (!current || !clientMatches(current, body)) {
      requests.push({
        service,
        resource: 'downloadClient',
        action: current ? 'update' : 'create',
        method: current ? 'PUT' : 'POST',
        path: current ? `${DOWNLOAD_CLIENT_ENDPOINT}/${current.id}` : DOWNLOAD_CLIENT_ENDPOINT,
        body,
        original: current ? clone(current) : null
      });
    }
  }

  const plan = {
    version: 1,
    mode: 'preview',
    changes: publicChanges(requests),
    requests,
    isEmpty: requests.length === 0
  };
  plan.integrity = integrity(plan);
  return freezeDeep(plan);
}

function currentFieldValue(resource, name) {
  return fieldMap(resource).get(name)?.value;
}

function fieldMatches(currentValue, expectedValue, name) {
  return name === 'password' && typeof currentValue === 'string' && MASKED_SECRET.test(currentValue)
    ? true
    : currentValue === expectedValue;
}

function clientMatches(current, expected) {
  if (!current || current.name !== MANAGED_CLIENT_NAME) return false;
  for (const key of ['name', 'enable', 'priority', 'implementation', 'configContract', 'protocol', 'removeCompletedDownloads', 'removeFailedDownloads']) {
    if (current[key] !== expected[key]) return false;
  }
  for (const field of expected.fields) {
    if (!fieldMatches(currentFieldValue(current, field.name), field.value, field.name)) return false;
  }
  return true;
}

function validFieldForRequest(field) {
  if (!isPlainObject(field) || typeof field.name !== 'string' || !SAFE_FIELD_NAME.test(field.name)) return false;
  if (SECRET_NAME.test(field.name) && !QBIT_FIELD_NAMES.has(field.name)) return false;
  const keys = Object.keys(field);
  if (keys.some((key) => !['name', 'value', 'type', 'label', 'advanced', 'helpText', 'isFloat', 'order', 'privacy', 'selectOptions', 'unit', 'hidden'].includes(key))) return false;
  return true;
}

function safeRequest(request) {
  if (!isPlainObject(request) || !SERVICES.includes(request.service) || !['POST', 'PUT'].includes(request.method) || !isPlainObject(request.body)) return false;
  if (!['rootFolder', 'downloadClient'].includes(request.resource) || !['create', 'update'].includes(request.action)) return false;
  if (request.resource === 'rootFolder') {
    return request.method === 'POST' && request.action === 'create' && request.path === ROOT_ENDPOINT && request.original === null &&
      Object.keys(request.body).length === 1 && typeof request.body.path === 'string' && (() => {
        try { normalizeRoot(request.body.path, 'request.body.path'); return true; } catch { return false; }
      })();
  }
  const isCreate = request.method === 'POST';
  const isUpdate = request.method === 'PUT';
  if ((isCreate && request.action !== 'create') || (isUpdate && request.action !== 'update')) return false;
  if (isCreate && request.path !== DOWNLOAD_CLIENT_ENDPOINT) return false;
  if (isUpdate && (!/^\/api\/v3\/downloadclient\/[1-9][0-9]*$/.test(request.path) || request.body.id !== Number(request.path.split('/').pop()))) return false;
  if ((isCreate && request.original !== null) || (isUpdate && !isPlainObject(request.original))) return false;
  const required = {
    name: MANAGED_CLIENT_NAME,
    enable: true,
    priority: 1,
    implementation: DOWNLOAD_CLIENT_IMPLEMENTATION,
    configContract: DOWNLOAD_CLIENT_CONTRACT,
    protocol: 'torrent',
    removeCompletedDownloads: true,
    removeFailedDownloads: true
  };
  for (const [key, value] of Object.entries(required)) if (request.body[key] !== value) return false;
  if (!Array.isArray(request.body.fields) || !request.body.fields.length || request.body.fields.some((field) => !validFieldForRequest(field))) return false;
  const fieldNames = new Set(request.body.fields.map((field) => field.name));
  for (const name of ['host', 'port', 'useSsl', 'urlBase', 'username', 'password']) if (!fieldNames.has(name)) return false;
  if (!fieldNames.has('tvCategory') && !fieldNames.has('movieCategory')) return false;
  if (Object.keys(request.body).some((key) => !SAFE_SCHEMA_TOP_LEVEL_FIELDS.has(key))) return false;
  if (typeof currentFieldValue(request.body, 'host') !== 'string' || typeof currentFieldValue(request.body, 'port') !== 'number' ||
      typeof currentFieldValue(request.body, 'useSsl') !== 'boolean' || typeof currentFieldValue(request.body, 'urlBase') !== 'string' ||
      typeof currentFieldValue(request.body, 'username') !== 'string' || typeof currentFieldValue(request.body, 'password') !== 'string') return false;
  return true;
}

function validatePlan(plan) {
  if (!isPlainObject(plan) || plan.version !== 1 || plan.mode !== 'preview' || !Array.isArray(plan.requests) || !Array.isArray(plan.changes) || typeof plan.integrity !== 'string') {
    return false;
  }
  if (integrity(plan) !== plan.integrity || !plan.requests.every(safeRequest)) return false;
  if (plan.isEmpty !== (plan.requests.length === 0) || plan.changes.length !== plan.requests.length) return false;
  return true;
}

function preview(choices, snapshot = {}) {
  return buildPlan(choices, snapshot);
}

function applicationRequests(plan) {
  if (!validatePlan(plan)) fail('plan is invalid or contains a tampered request', 'plan');
  return clone(plan.requests);
}

function publicPlan(plan) {
  if (!validatePlan(plan)) fail('plan is invalid or contains a tampered request', 'plan');
  return {
    version: 1,
    mode: 'preview',
    changes: publicChanges(plan.requests),
    isEmpty: plan.requests.length === 0
  };
}

function mismatchFields(plan, snapshotInput) {
  if (!validatePlan(plan)) return ['plan'];
  let snapshot;
  try {
    snapshot = validateSnapshot(snapshotInput || {});
  } catch {
    return ['snapshot'];
  }
  const mismatches = [];
  for (const request of plan.requests) {
    const current = snapshot[request.service];
    if (request.resource === 'rootFolder') {
      if (!currentRoot(request.service, current.rootFolders, request.body.path)) mismatches.push(`${request.service}.rootFolder.path`);
      continue;
    }
    const client = managedClient(current.downloadClients);
    if (!client) {
      mismatches.push(`${request.service}.downloadClient`);
      continue;
    }
    for (const key of ['name', 'enable', 'priority', 'implementation', 'configContract', 'protocol', 'removeCompletedDownloads', 'removeFailedDownloads']) {
      if (client[key] !== request.body[key]) mismatches.push(`${request.service}.downloadClient.${key}`);
    }
    for (const field of request.body.fields) {
      if (!fieldMatches(currentFieldValue(client, field.name), field.value, field.name)) mismatches.push(`${request.service}.downloadClient.${field.name}`);
    }
  }
  return [...new Set(mismatches)];
}

function matches(plan, snapshot) {
  return mismatchFields(plan, snapshot).length === 0;
}

module.exports = Object.freeze({
  SERVICES,
  INPUT_FIELDS,
  preview,
  applicationRequests,
  publicPlan,
  mismatchFields,
  matches
});
