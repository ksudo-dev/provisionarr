'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  GIB_TO_MB,
  validateMediaSizeInputs,
  mediaSizeLimitsToMbPerMinute,
  previewQualityDefinitionChanges,
  buildQualityDefinitionApplyPayload
} = require('../lib/media-limits');

const limits = {
  tvEpisodeMinutes: '45',
  tvMaxGiB: '1.5',
  movieMinutes: 120,
  movieMaxGiB: 8
};

test('validates user-facing duration and GiB inputs and calculates ARR rates', () => {
  const normalized = validateMediaSizeInputs(limits);

  assert.equal(GIB_TO_MB, 1024);
  assert.equal(normalized.tvEpisodeMinutes, 45);
  assert.equal(normalized.tvMaxGiB, 1.5);
  assert.equal(normalized.movieMinutes, 120);
  assert.equal(normalized.movieMaxGiB, 8);
  assert.equal(normalized.tvMaxMbPerMinute, (1.5 * 1024) / 45);
  assert.equal(normalized.movieMaxMbPerMinute, (8 * 1024) / 120);
  assert.deepEqual(mediaSizeLimitsToMbPerMinute(limits), {
    tv: (1.5 * 1024) / 45,
    movie: (8 * 1024) / 120
  });
});

test('accepts duration aliases but rejects ambiguous or unsafe input', () => {
  assert.equal(validateMediaSizeInputs({
    tvEpisodeDurationMinutes: '42',
    tvMaximumGiB: '0.5',
    movieDurationMinutes: '100',
    movieMaximumGiB: '4'
  }).tvEpisodeMinutes, 42);
  assert.throws(() => validateMediaSizeInputs({...limits, tvEpisodeMinutes: '45', unknown: 1}), /unsupported field/);
  assert.throws(() => validateMediaSizeInputs({...limits, tvEpisodeMinutes: '0'}), /at least 1/);
  assert.throws(() => validateMediaSizeInputs({...limits, tvMaxGiB: '-1'}), /plain positive number/);
  assert.throws(() => validateMediaSizeInputs({...limits, movieMinutes: '1e2'}), /plain positive number/);
  assert.throws(() => validateMediaSizeInputs({...limits, movieMaxGiB: '2048'}), /must not exceed 1024/);
  assert.throws(() => validateMediaSizeInputs({...limits, tvMaxGiB: 'NaN'}), /plain positive number/);
  assert.throws(() => validateMediaSizeInputs({...limits, tvMaxGiB: '1', tvMaximumGiB: '1'}), /only one spelling/);
});

test('preview reports exact max-size changes without mutating quality definitions', () => {
  const definitions = [
    {id: 1, title: 'WEB-DL 1080p', minSize: 0, preferredSize: 8, maxSize: 100},
    {id: 2, title: 'Bluray 2160p', minSize: 20, preferredSize: 25, maxSize: 200}
  ];
  const original = structuredClone(definitions);
  const preview = previewQualityDefinitionChanges(definitions, limits, 'tv');

  assert.equal(preview.mediaType, 'tv');
  assert.equal(preview.capMbPerMinute, (1.5 * 1024) / 45);
  assert.deepEqual(preview.changes.map(change => ({id: change.id, fields: change.fields})), [
    {id: 1, fields: {maxSize: {from: 100, to: (1.5 * 1024) / 45}}},
    {id: 2, fields: {maxSize: {from: 200, to: (1.5 * 1024) / 45}}}
  ]);
  assert.deepEqual(definitions, original);
  assert.notStrictEqual(preview.payload[0], definitions[0]);
  assert.equal(preview.payload[0].minSize, 0);
  assert.equal(preview.payload[0].preferredSize, 8);
});

test('apply payload preserves min and preferred sizes unless explicitly overridden', () => {
  const definitions = [{id: 10, name: 'Balanced', minSize: 2, preferredSize: 4, maxSize: 50}];
  const payload = buildQualityDefinitionApplyPayload(definitions, {
    ...limits,
    tvMinMbPerMinute: '3',
    tvPreferredMbPerMinute: '5'
  }, 'sonarr');

  assert.deepEqual(payload, [{
    id: 10,
    name: 'Balanced',
    minSize: 3,
    preferredSize: 5,
    maxSize: (1.5 * 1024) / 45
  }]);
  assert.deepEqual(definitions, [{id: 10, name: 'Balanced', minSize: 2, preferredSize: 4, maxSize: 50}]);
});

test('rejects an apply payload whose preserved or explicit values exceed the cap', () => {
  const definitions = [{id: 5, minSize: 0, preferredSize: 100, maxSize: 200}];
  assert.throws(() => buildQualityDefinitionApplyPayload(definitions, limits, 'movie'), /preferredSize must be at least minSize|qualityDefinitions/);
  assert.throws(() => buildQualityDefinitionApplyPayload(
    [{id: 6, minSize: 0, preferredSize: 0, maxSize: 200}],
    {...limits, moviePreferredMbPerMinute: 100},
    'radarr'
  ), /preferredSize must be at least minSize|qualityDefinitions/);
  assert.throws(() => buildQualityDefinitionApplyPayload([{
    id: -1,
    minSize: 0,
    preferredSize: 0,
    maxSize: 1
  }], limits, 'tv'), /non-negative integer/);
});
