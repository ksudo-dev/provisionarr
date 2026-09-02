'use strict';

function check(id, state, summary, detail) {
  return Object.freeze({id, state, summary, ...(detail ? {detail} : {})});
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function booleanValue(value) {
  return value === true || value === 1 || value === 'true';
}

function hasAuthenticatedStatus(data) {
  const source = asObject(data);
  if (source.authenticated === false || source.isAuthenticated === false) return false;
  if (source.authenticated === true || source.isAuthenticated === true) return true;
  return Number.isInteger(source.statusCode) && source.statusCode >= 200 && source.statusCode < 300;
}

function enabledItem(item) {
  const source = asObject(item);
  return source.enable !== false && source.enabled !== false && source.isEnabled !== false;
}

function itemNames(items) {
  return Array.isArray(items)
    ? items.map(item => text(asObject(item).name || asObject(item).appName || asObject(item).implementation).toLowerCase())
    : [];
}

function findNamedLink(items, name) {
  const needle = name.toLowerCase();
  return Array.isArray(items) && items.some(item => {
    const source = asObject(item);
    const values = [source.name, source.appName, source.implementation, source.type]
      .map(value => text(value).toLowerCase());
    return enabledItem(source) && values.some(value => value === needle || value.includes(needle));
  });
}

function prowlarrCompatibility(input) {
  const source = asObject(input);
  const status = asObject(source.status || source.systemStatus || source);
  const healthAvailable = Array.isArray(source.health);
  const health = healthAvailable ? source.health : [];
  const indexers = Array.isArray(source.indexers) ? source.indexers : [];
  const applications = Array.isArray(source.applications || source.apps) ? (source.applications || source.apps) : [];
  const healthy = health.every(item => {
    const level = text(asObject(item).level || asObject(item).type).toLowerCase();
    return !['error', 'fatal'].includes(level) && asObject(item).isHealthy !== false;
  });
  const checks = [
    hasAuthenticatedStatus(status)
      ? check('authenticated', 'pass', 'Prowlarr is connected.')
      : check('authenticated', 'fail', 'Prowlarr did not accept the connection.'),
    !healthAvailable
      ? check('health', 'unknown', 'Prowlarr health could not be confirmed.')
      : healthy
        ? check('health', 'pass', 'Prowlarr reports no failing health checks.')
        : check('health', 'fail', 'Prowlarr reports a failing health check.'),
    indexers.some(enabledItem)
      ? check('enabled_indexer', 'pass', 'At least one indexer is enabled.')
      : check('enabled_indexer', 'fail', 'Prowlarr has no enabled indexer.'),
    findNamedLink(applications, 'sonarr')
      ? check('sonarr_link', 'pass', 'Prowlarr is linked to Sonarr.')
      : check('sonarr_link', 'fail', 'Prowlarr is not linked to Sonarr.'),
    findNamedLink(applications, 'radarr')
      ? check('radarr_link', 'pass', 'Prowlarr is linked to Radarr.')
      : check('radarr_link', 'fail', 'Prowlarr is not linked to Radarr.')
  ];
  return Object.freeze({
    service: 'prowlarr',
    state: checks.some(item => item.state === 'fail') ? 'needs_configuration' : checks.some(item => item.state === 'unknown') ? 'unknown' : 'ready',
    checks: Object.freeze(checks),
    counts: Object.freeze({indexers: indexers.length, enabledIndexers: indexers.filter(enabledItem).length, applicationLinks: applications.length})
  });
}

function usableSavePath(value) {
  const path = text(value);
  return path.length > 0 && path.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(path) && (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path));
}

function qBittorrentCompatibility(input) {
  const source = asObject(input);
  const version = text(source.version || source.apiVersion || source.appVersion).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,80);
  const preferences = asObject(source.preferences || source.preference);
  const queue = Array.isArray(source.queue || source.torrents) ? (source.queue || source.torrents) : null;
  const authenticated = hasAuthenticatedStatus(source) || booleanValue(source.authenticated);
  const checks = [
    authenticated && version
      ? check('authenticated_version', 'pass', 'qBittorrent accepted the connection and returned its version.')
      : check('authenticated_version', 'fail', 'qBittorrent version access is unavailable.'),
    usableSavePath(preferences.save_path || preferences.savePath || source.defaultSavePath)
      ? check('default_save_path', 'pass', 'qBittorrent has a usable default save path.')
      : check('default_save_path', 'fail', 'qBittorrent has no usable default save path.'),
    queue
      ? check('queue_visibility', 'pass', 'qBittorrent queue visibility is available.')
      : check('queue_visibility', 'fail', 'qBittorrent queue visibility is unavailable.')
  ];
  const knownStates=new Set(['downloading','uploading','stalleddl','stalledup','metadl','checkingdl','checkingup','checkingresumedata','allocating','paused','pauseddl','pausedup','forceddl','forcedup','error','missingfiles','queued']);
  const states = queue ? queue.reduce((result, item) => {
    const raw = text(asObject(item).state).toLowerCase();
    const state=knownStates.has(raw)?raw:raw?'other':'';
    if(state)result[state]=(result[state]||0)+1;
    return result;
  }, {}) : {};
  return Object.freeze({
    service: 'qbittorrent',
    version: version || null,
    state: checks.some(item => item.state === 'fail') ? 'needs_configuration' : 'ready',
    checks: Object.freeze(checks),
    counts: Object.freeze({queueItems: queue ? queue.length : 0, queueStates: Object.freeze(states)})
  });
}

module.exports = Object.freeze({prowlarrCompatibility, qBittorrentCompatibility});
