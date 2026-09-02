'use strict';

const GIB_TO_MB = 1024;
const MEDIA_TYPES = Object.freeze(['tv', 'movie']);
const REQUIRED_FIELDS = Object.freeze([
  'tvEpisodeMinutes',
  'tvMaxGiB',
  'movieMinutes',
  'movieMaxGiB'
]);
const OPTIONAL_FIELDS = Object.freeze([
  'tvMinMbPerMinute',
  'tvPreferredMbPerMinute',
  'movieMinMbPerMinute',
  'moviePreferredMbPerMinute'
]);
const ACCEPTED_ALIASES = Object.freeze({
  tvEpisodeMinutes: Object.freeze(['tvEpisodeMinutes', 'tvEpisodeDurationMinutes']),
  tvMaxGiB: Object.freeze(['tvMaxGiB', 'tvMaximumGiB']),
  movieMinutes: Object.freeze(['movieMinutes', 'movieDurationMinutes']),
  movieMaxGiB: Object.freeze(['movieMaxGiB', 'movieMaximumGiB'])
});
const QUALITY_FIELDS = Object.freeze(['minSize', 'preferredSize', 'maxSize']);

function fail(message, path) {
  throw new TypeError(path ? `${path}: ${message}` : message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function assertPlainObject(value, path) {
  if (!isPlainObject(value)) fail('expected an object', path);
}

function parseNumber(value, path, {minimum, maximum, integer = false} = {}) {
  let number;
  if (typeof value === 'number') {
    number = value;
  } else if (typeof value === 'string') {
    const text = value.trim();
    if (!text || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text)) {
      fail('must be a plain positive number', path);
    }
    number = Number(text);
  } else {
    fail('must be a number or numeric string', path);
  }

  if (!Number.isFinite(number)) fail('must be finite', path);
  if (integer && !Number.isInteger(number)) fail('must be a whole number', path);
  if (number < minimum) fail(`must be at least ${minimum}`, path);
  if (number > maximum) fail(`must not exceed ${maximum}`, path);
  return number;
}

function parseRate(value, path) {
  return parseNumber(value, path, {minimum: 0, maximum: 1_000_000});
}

function readAliasedField(input, canonical) {
  const matches = ACCEPTED_ALIASES[canonical].filter(name => Object.prototype.hasOwnProperty.call(input, name));
  if (matches.length > 1) fail(`use only one spelling: ${matches.join(', ')}`, `limits.${canonical}`);
  return matches.length === 1 ? input[matches[0]] : undefined;
}

function normalizeMediaType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['tv', 'television', 'series', 'sonarr'].includes(normalized)) return 'tv';
  if (['movie', 'movies', 'film', 'radarr'].includes(normalized)) return 'movie';
  fail('must be tv or movie', 'mediaType');
}

function validateMediaSizeInputs(input) {
  assertPlainObject(input, 'limits');

  const allowed = new Set([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS, ...Object.values(ACCEPTED_ALIASES).flat()]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) fail('contains an unsupported field', `limits.${key}`);
  }

  const normalized = {
    tvEpisodeMinutes: parseNumber(readAliasedField(input, 'tvEpisodeMinutes'), 'limits.tvEpisodeMinutes', {minimum: 1, maximum: 1_440}),
    tvMaxGiB: parseNumber(readAliasedField(input, 'tvMaxGiB'), 'limits.tvMaxGiB', {minimum: 0.01, maximum: 1_024}),
    movieMinutes: parseNumber(readAliasedField(input, 'movieMinutes'), 'limits.movieMinutes', {minimum: 1, maximum: 1_440}),
    movieMaxGiB: parseNumber(readAliasedField(input, 'movieMaxGiB'), 'limits.movieMaxGiB', {minimum: 0.01, maximum: 1_024})
  };

  for (const field of OPTIONAL_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) normalized[field] = parseRate(input[field], `limits.${field}`);
  }

  normalized.tvMaxMbPerMinute = (normalized.tvMaxGiB * GIB_TO_MB) / normalized.tvEpisodeMinutes;
  normalized.movieMaxMbPerMinute = (normalized.movieMaxGiB * GIB_TO_MB) / normalized.movieMinutes;
  return Object.freeze(normalized);
}

function mediaSizeLimitsToMbPerMinute(input) {
  const limits = validateMediaSizeInputs(input);
  return Object.freeze({
    tv: limits.tvMaxMbPerMinute,
    movie: limits.movieMaxMbPerMinute
  });
}

function clone(value) {
  return structuredClone(value);
}

function numericQualityField(record, field, path) {
  if (!Object.prototype.hasOwnProperty.call(record, field)) return undefined;
  const value = record[field];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail('must be a finite non-negative number', path);
  }
  return value;
}

function qualityDefinitionId(record, index) {
  if (!Object.prototype.hasOwnProperty.call(record, 'id')) return `index ${index}`;
  if (!Number.isInteger(record.id) || record.id < 0) fail('must be a non-negative integer', `qualityDefinitions[${index}].id`);
  return record.id;
}

function targetQualityFields(limits, mediaType) {
  const prefix = mediaType === 'tv' ? 'tv' : 'movie';
  const target = {
    maxSize: mediaType === 'tv' ? limits.tvMaxMbPerMinute : limits.movieMaxMbPerMinute
  };
  const minimum = limits[`${prefix}MinMbPerMinute`];
  const preferred = limits[`${prefix}PreferredMbPerMinute`];
  if (minimum !== undefined) target.minSize = minimum;
  if (preferred !== undefined) target.preferredSize = preferred;
  return target;
}

function validateResultOrdering(record, index) {
  const values = QUALITY_FIELDS
    .map(field => [field, numericQualityField(record, field, `qualityDefinitions[${index}].${field}`)])
    .filter(([, value]) => value !== undefined);
  for (let position = 1; position < values.length; position += 1) {
    const [previousField, previousValue] = values[position - 1];
    const [field, value] = values[position];
    if (value < previousValue) {
      fail(`${field} must be at least ${previousField}`, `qualityDefinitions[${index}]`);
    }
  }
}

function buildQualityDefinitionApplyPayload(qualityDefinitions, input, mediaType) {
  if (!Array.isArray(qualityDefinitions)) fail('must be an array', 'qualityDefinitions');
  const normalizedType = normalizeMediaType(mediaType);
  const limits = validateMediaSizeInputs(input);
  const target = targetQualityFields(limits, normalizedType);

  return qualityDefinitions.map((source, index) => {
    assertPlainObject(source, `qualityDefinitions[${index}]`);
    qualityDefinitionId(source, index);
    for (const field of QUALITY_FIELDS) numericQualityField(source, field, `qualityDefinitions[${index}].${field}`);
    const payload = clone(source);
    Object.assign(payload, target);
    validateResultOrdering(payload, index);
    return payload;
  });
}

function previewQualityDefinitionChanges(qualityDefinitions, input, mediaType) {
  if (!Array.isArray(qualityDefinitions)) fail('must be an array', 'qualityDefinitions');
  const normalizedType = normalizeMediaType(mediaType);
  const limits = validateMediaSizeInputs(input);
  const payload = buildQualityDefinitionApplyPayload(qualityDefinitions, input, normalizedType);
  const changes = [];

  qualityDefinitions.forEach((source, index) => {
    const updated = payload[index];
    const fields = {};
    for (const field of QUALITY_FIELDS) {
      if (source[field] !== updated[field]) fields[field] = Object.freeze({from: source[field], to: updated[field]});
    }
    if (Object.keys(fields).length > 0) {
      changes.push(Object.freeze({
        id: source.id,
        name: typeof source.title === 'string' ? source.title : typeof source.name === 'string' ? source.name : null,
        fields: Object.freeze(fields)
      }));
    }
  });

  return Object.freeze({
    mediaType: normalizedType,
    capMbPerMinute: normalizedType === 'tv' ? limits.tvMaxMbPerMinute : limits.movieMaxMbPerMinute,
    changes: Object.freeze(changes),
    payload: Object.freeze(payload)
  });
}

module.exports = Object.freeze({
  GIB_TO_MB,
  validateMediaSizeInputs,
  mediaSizeLimitsToMbPerMinute,
  previewQualityDefinitionChanges,
  buildQualityDefinitionApplyPayload
});
