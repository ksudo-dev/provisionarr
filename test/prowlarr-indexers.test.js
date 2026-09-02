'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const indexers = require('../lib/prowlarr-indexers');

const schema = {
  id: 42,
  name: 'Example Indexer',
  implementationName: 'Cardigann',
  implementation: 'Cardigann',
  configContract: 'CardigannSettings',
  protocol: 'torrent',
  infoLink: 'https://wiki.example.test/indexer',
  tags: [4, 4, -1, 'bad'],
  fields: [
    {name: 'definitionFile', type: 'text', value: 'example.yml', editable: false},
    {name: 'baseUrl', type: 'url', label: 'Indexer URL', required: true, value: 'https://indexer.example.test'},
    {name: 'username', type: 'text', label: 'Username', required: true, value: ''},
    {name: 'apiKey', type: 'text', label: 'API key', isSecret: true, value: 'schema-secret'},
    {name: 'category', type: 'select', selectOptions: [{value: 1000, name: 'Console'}, {value: 2000, name: 'Movies'}], value: 2000},
    {name: 'advancedNote', type: 'text', hidden: true, value: 'internal'}
  ]
};

test('normalizes dynamic schemas into safe UI metadata', () => {
  const metadata = indexers.normalizeIndexerSchema(schema);
  assert.deepEqual(metadata.requiredFields, ['baseUrl', 'username']);
  assert.deepEqual(metadata.editableFields, ['baseUrl', 'username', 'apiKey', 'category']);
  assert.equal(metadata.fields.find(field => field.name === 'apiKey').secret, true);
  assert.equal(metadata.fields.find(field => field.name === 'definitionFile').editable, false);
  assert.deepEqual(metadata.fields.find(field => field.name === 'category').selectOptions, [
    {value: 1000, label: 'Console'},
    {value: 2000, label: 'Movies'}
  ]);
  assert.equal(JSON.stringify(metadata).includes('schema-secret'), false);
  assert.equal(JSON.stringify(metadata).includes('internal'), false);
  assert.deepEqual(metadata.tags, [4]);
});

test('identifies required editable fields without hardcoded indexer names', () => {
  const required = indexers.requiredEditableFields(schema);
  assert.deepEqual(required.map(field => field.name), ['baseUrl', 'username']);
  assert.deepEqual(indexers.identifyRequiredEditableFields(schema).map(field => field.name), ['baseUrl', 'username']);
});

test('validates a selection against the selected schema', () => {
  const selection = indexers.validateIndexerSelection(schema, {
    schemaId: 42,
    fields: {
      username: 'tester',
      apiKey: 'private-value',
      category: 1000
    }
  });
  assert.equal(selection.schemaId, 42);
  assert.equal(selection.fields.baseUrl, 'https://indexer.example.test');
  assert.equal(selection.fields.apiKey, 'private-value');
  assert.equal(selection.priority, 25);
});

test('rejects missing required, unknown, non-editable, and wrong-schema fields', () => {
  assert.throws(() => indexers.validateIndexerSelection(schema, {fields: {}}), /selection\.fields\.username: is required/);
  assert.throws(() => indexers.validateIndexerSelection(schema, {fields: {username: 'tester', noSuchField: 'x'}}), /not present in the selected schema/);
  assert.throws(() => indexers.validateIndexerSelection(schema, {fields: {username: 'tester', definitionFile: 'x'}}), /is not editable/);
  assert.throws(() => indexers.validateIndexerSelection(schema, {schemaId: 99, fields: {username: 'tester'}}), /does not match the selected schema/);
  assert.throws(() => indexers.validateIndexerSelection(schema, {fields: {username: {secret: 'x'}}}), /scalar array/);
});

test('builds the native POST payload while retaining schema descriptors', () => {
  const payload = indexers.buildIndexerPayload(schema, {
    fields: {username: 'tester', apiKey: 'private-value', category: 1000},
    enable: false,
    priority: 10,
    tags: [8, 8],
    name: 'My Example Indexer'
  });
  assert.deepEqual(payload, {
    name: 'My Example Indexer',
    enable: false,
    protocol: 'torrent',
    priority: 10,
    implementationName: 'Cardigann',
    implementation: 'Cardigann',
    configContract: 'CardigannSettings',
    infoLink: 'https://wiki.example.test/indexer',
    tags: [8],
    fields: [
      {name: 'definitionFile', type: 'text', value: 'example.yml', editable: false},
      {name: 'baseUrl', type: 'url', label: 'Indexer URL', required: true, value: 'https://indexer.example.test'},
      {name: 'username', type: 'text', label: 'Username', required: true, value: 'tester'},
      {name: 'apiKey', type: 'text', label: 'API key', isSecret: true, value: 'private-value'},
      {name: 'category', type: 'select', selectOptions: [{value: 1000, name: 'Console'}, {value: 2000, name: 'Movies'}], value: 1000},
      {name: 'advancedNote', type: 'text', hidden: true, value: 'internal'}
    ]
  });
});

test('summaries expose configuration state but never field values', () => {
  const summary = indexers.summarizeIndexerSelection(schema, {
    fields: {username: 'tester', apiKey: 'private-value'}
  });
  const serialized = JSON.stringify(summary);
  assert.equal(summary.name, 'Example Indexer');
  assert.equal(summary.configuredFieldCount, 6);
  assert.equal(summary.fields.find(field => field.name === 'apiKey').configured, true);
  assert.equal(summary.fields.find(field => field.name === 'apiKey').secret, true);
  assert.equal(serialized.includes('private-value'), false);
  assert.equal(serialized.includes('schema-secret'), false);
  assert.equal(serialized.includes('indexer.example.test'), false);
});

test('normalization does not mutate the upstream schema', () => {
  const input = JSON.parse(JSON.stringify(schema));
  indexers.buildIndexerPayload(input, {fields: {username: 'tester', apiKey: 'private-value'}});
  assert.deepEqual(input, schema);
});
