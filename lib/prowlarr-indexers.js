'use strict';

// Pure helpers for turning Prowlarr indexer schemas into a safe setup flow.
// The module never performs HTTP requests and never includes field values in
// the metadata or summary objects intended for a UI.

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
const SECRET_FIELD = /(?:api[._-]?key|password|passphrase|token|secret|cookie|captcha|credential|private[._-]?key|client[._-]?secret)/i;
const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_VALUE_LENGTH = 8192;
const MAX_FIELD_COUNT = 512;

function fail(message, path) {
  throw new TypeError(path ? `${path}: ${message}` : message);
}

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function text(value, path, limit = 2048, required = false) {
  if (value === undefined || value === null) {
    if (required) fail('is required', path);
    return '';
  }
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('must be a clean string', path);
  }
  const result = value.trim();
  if (required && !result) fail('is required', path);
  return result;
}

function fieldName(value, path) {
  const result = text(value, path, 128, true);
  if (!FIELD_NAME.test(result)) fail('contains unsupported characters', path);
  return result;
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function numericId(value, path) {
  if (value === undefined || value === null || value === '') return null;
  if (!Number.isInteger(value) || value < 0) fail('must be a non-negative integer', path);
  return value;
}

function safeUrl(value, path) {
  const result = text(value, path, 2048);
  if (!result) return '';
  let parsed;
  try {
    parsed = new URL(result);
  } catch {
    return '';
  }
  return SAFE_URL_PROTOCOLS.has(parsed.protocol) ? result : '';
}

function secretField(field) {
  return field.isSecret === true || field.secret === true || field.privacy === 'password' || /password|secret/i.test(String(field.type || '')) || SECRET_FIELD.test(String(field.name || ''));
}

function editableField(field) {
  return field.editable !== false && field.hidden !== true && field.readOnly !== true && field.readonly !== true && field.internal !== true;
}

function requiredField(field) {
  if (field.required === true || field.isRequired === true) return true;
  return plain(field.validation) && field.validation.required === true;
}

function safeOption(option, path) {
  if (!plain(option)) fail('must contain option objects', path);
  const value = option.value;
  if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
    fail('option value must be a string, number, or boolean', path);
  }
  const label = text(option.name ?? option.label ?? value, `${path}.label`, 512, true);
  return {value, label};
}

function normalizeField(field, index) {
  const path = `schema.fields.${index}`;
  if (!plain(field)) fail('must be an object', path);
  const name = fieldName(field.name, `${path}.name`);
  const secret = secretField(field);
  const editable = editableField(field);
  const result = {
    name,
    label: text(field.label ?? field.name, `${path}.label`, 512, true),
    type: text(field.type ?? field.inputType ?? 'text', `${path}.type`, 128, true).toLowerCase(),
    editable,
    required: editable && requiredField(field),
    secret,
    advanced: bool(field.advanced, false)
  };

  const helpText = text(field.helpText, `${path}.helpText`, 4096);
  const helpLink = safeUrl(field.helpLink, `${path}.helpLink`);
  const section = text(field.section, `${path}.section`, 256);
  if (helpText) result.helpText = helpText;
  if (helpLink) result.helpLink = helpLink;
  if (section) result.section = section;

  if (Array.isArray(field.selectOptions)) {
    if (field.selectOptions.length > MAX_FIELD_COUNT) fail('has too many select options', `${path}.selectOptions`);
    result.selectOptions = field.selectOptions.map((option, optionIndex) => safeOption(option, `${path}.selectOptions.${optionIndex}`));
  }
  const provider = text(field.selectOptionsProviderAction, `${path}.selectOptionsProviderAction`, 512);
  if (provider) result.selectOptionsProviderAction = provider;
  if (Number.isInteger(field.order)) result.order = field.order;
  return Object.freeze(result);
}

function normalizedFields(schema) {
  if (!Array.isArray(schema.fields)) fail('fields must be an array', 'schema.fields');
  if (schema.fields.length > MAX_FIELD_COUNT) fail('contains too many fields', 'schema.fields');
  const seen = new Set();
  const fields = schema.fields.map((field, index) => {
    const normalized = normalizeField(field, index);
    if (seen.has(normalized.name)) fail('contains a duplicate field name', `schema.fields.${index}.name`);
    seen.add(normalized.name);
    return normalized;
  });
  return fields;
}

function normalizeIndexerSchema(schema) {
  if (!plain(schema)) fail('must be an object', 'schema');
  const name = text(schema.name ?? schema.implementationName, 'schema.name', 512, true);
  const implementationName = text(schema.implementationName ?? name, 'schema.implementationName', 512, true);
  const implementation = text(schema.implementation ?? implementationName, 'schema.implementation', 512, true);
  const configContract = text(schema.configContract ?? `${implementation}Settings`, 'schema.configContract', 512, true);
  const fields = normalizedFields(schema);
  const id = numericId(schema.id, 'schema.id');
  const infoLink = safeUrl(schema.infoLink, 'schema.infoLink');
  const protocol = text(schema.protocol ?? 'torrent', 'schema.protocol', 128, true);
  const tags = Array.isArray(schema.tags) ? schema.tags.filter(tag => Number.isInteger(tag) && tag >= 0) : [];

  const result = {
    ...(id === null ? {} : {id}),
    name,
    implementationName,
    implementation,
    configContract,
    protocol,
    fields,
    requiredFields: Object.freeze(fields.filter(field => field.required).map(field => field.name)),
    editableFields: Object.freeze(fields.filter(field => field.editable).map(field => field.name))
  };
  if (infoLink) result.infoLink = infoLink;
  if (tags.length) result.tags = Object.freeze([...new Set(tags)]);
  return Object.freeze(result);
}

function normalizeIndexerSchemas(schemas) {
  if (!Array.isArray(schemas)) fail('must be an array', 'schemas');
  return Object.freeze(schemas.map(normalizeIndexerSchema));
}

function rawFields(schema) {
  if (!plain(schema) || !Array.isArray(schema.fields)) fail('schema fields are missing', 'schema.fields');
  const map = new Map();
  for (const [index, field] of schema.fields.entries()) {
    if (!plain(field)) fail('must be an object', `schema.fields.${index}`);
    const name = fieldName(field.name, `schema.fields.${index}.name`);
    if (map.has(name)) fail('contains a duplicate field name', `schema.fields.${index}.name`);
    map.set(name, {source: field, metadata: normalizeField(field, index)});
  }
  return map;
}

function selectionValues(selection, path) {
  if (!plain(selection)) fail('must be an object', 'selection');
  const hasFields = Object.hasOwn(selection, 'fields');
  const hasFieldValues = Object.hasOwn(selection, 'fieldValues');
  if (hasFields && hasFieldValues) fail('use fields or fieldValues, not both', 'selection');
  const values = hasFields ? selection.fields : (hasFieldValues ? selection.fieldValues : {});
  if (!plain(values)) fail('must be an object', path);
  return values;
}

function value(value, path) {
  if (typeof value === 'string') {
    if (value.length > MAX_VALUE_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) fail('contains an invalid string', path);
    return value;
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length <= MAX_FIELD_COUNT && value.every(item => ['string', 'number', 'boolean'].includes(typeof item) && (typeof item !== 'number' || Number.isFinite(item)))) {
    return clone(value);
  }
  fail('must be a string, number, boolean, or scalar array', path);
}

function empty(valueToCheck) {
  return valueToCheck === undefined || valueToCheck === null || valueToCheck === '' || (Array.isArray(valueToCheck) && valueToCheck.length === 0);
}

function selectionId(selection) {
  for (const key of ['schemaId', 'indexerId', 'id']) {
    if (Object.hasOwn(selection, key)) return selection[key];
  }
  return undefined;
}

function validateSelectionOptions(selection) {
  const allowed = new Set(['schemaId', 'indexerId', 'id', 'name', 'fields', 'fieldValues', 'enable', 'enabled', 'priority', 'tags', 'protocol']);
  for (const key of Object.keys(selection)) if (!allowed.has(key)) fail('contains an unsupported field', `selection.${key}`);
  if (Object.hasOwn(selection, 'enable') && typeof selection.enable !== 'boolean') fail('must be a boolean', 'selection.enable');
  if (Object.hasOwn(selection, 'enabled') && typeof selection.enabled !== 'boolean') fail('must be a boolean', 'selection.enabled');
  if (Object.hasOwn(selection, 'priority') && (!Number.isInteger(selection.priority) || selection.priority < 0)) fail('must be a non-negative integer', 'selection.priority');
  if (Object.hasOwn(selection, 'name')) text(selection.name, 'selection.name', 512, true);
  if (Object.hasOwn(selection, 'protocol')) text(selection.protocol, 'selection.protocol', 128, true);
  if (Object.hasOwn(selection, 'tags') && (!Array.isArray(selection.tags) || selection.tags.some(tag => !Number.isInteger(tag) || tag < 0))) fail('must be an array of non-negative integers', 'selection.tags');
}

function validateIndexerSelection(schema, selection) {
  const normalized = normalizeIndexerSchema(schema);
  if (!plain(selection)) fail('must be an object', 'selection');
  validateSelectionOptions(selection);
  const selectedId = selectionId(selection);
  if (selectedId !== undefined && normalized.id !== undefined && selectedId !== normalized.id) fail('does not match the selected schema', 'selection.schemaId');
  if (selectedId !== undefined && normalized.id === undefined) fail('schema has no selectable id', 'selection.schemaId');

  const fields = rawFields(schema);
  const supplied = selectionValues(selection, 'selection.fields');
  const values = {};
  for (const name of Object.keys(supplied)) {
    if (!fields.has(name)) fail('is not present in the selected schema', `selection.fields.${name}`);
    if (!fields.get(name).metadata.editable) fail('is not editable', `selection.fields.${name}`);
    values[name] = value(supplied[name], `selection.fields.${name}`);
  }
  for (const [name, field] of fields) {
    if (!Object.hasOwn(values, name) && Object.hasOwn(field.source, 'value')) values[name] = clone(field.source.value);
    if (field.metadata.required && empty(values[name])) fail('is required', `selection.fields.${name}`);
  }
  return Object.freeze({
    ...(normalized.id === undefined ? {} : {schemaId: normalized.id}),
    name: text(selection.name ?? normalized.name, 'selection.name', 512, true),
    fields: Object.freeze(values),
    enable: selection.enable ?? selection.enabled ?? true,
    priority: selection.priority ?? 25,
    protocol: text(selection.protocol ?? normalized.protocol, 'selection.protocol', 128, true),
    tags: Object.freeze(selection.tags ? [...new Set(selection.tags)] : (normalized.tags ? [...normalized.tags] : []))
  });
}

function buildIndexerPayload(schema, selection) {
  const normalized = normalizeIndexerSchema(schema);
  const validated = validateIndexerSelection(schema, selection);
  const fields = rawFields(schema);
  const payloadFields = [...fields.entries()].map(([name, field]) => {
    const result = clone(field.source);
    if (Object.hasOwn(validated.fields, name)) result.value = clone(validated.fields[name]);
    else if (!Object.hasOwn(result, 'value')) result.value = '';
    return result;
  });
  return {
    name: validated.name,
    enable: validated.enable,
    protocol: validated.protocol,
    priority: validated.priority,
    implementationName: normalized.implementationName,
    implementation: normalized.implementation,
    configContract: normalized.configContract,
    infoLink: normalized.infoLink || '',
    tags: [...validated.tags],
    fields: payloadFields
  };
}

function summarizeIndexerSelection(schema, selection) {
  const normalized = normalizeIndexerSchema(schema);
  const validated = validateIndexerSelection(schema, selection);
  const source = rawFields(schema);
  const fields = normalized.fields.map(metadata => ({
    name: metadata.name,
    label: metadata.label,
    required: metadata.required,
    editable: metadata.editable,
    secret: metadata.secret,
    configured: !empty(validated.fields[metadata.name])
  }));
  return {
    name: validated.name,
    implementation: normalized.implementation,
    enabled: validated.enable,
    fieldCount: source.size,
    configuredFieldCount: fields.filter(field => field.configured).length,
    missingRequiredFields: fields.filter(field => field.required && !field.configured).map(field => field.name),
    fields
  };
}

const exported = {
  normalizeIndexerSchema,
  normalizeIndexerSchemaRecord: normalizeIndexerSchema,
  normalizeSchema: normalizeIndexerSchema,
  normalizeSchemaRecord: normalizeIndexerSchema,
  normalizeIndexerSchemas,
  requiredEditableFields(schema) {
    return normalizeIndexerSchema(schema).fields.filter(field => field.required && field.editable);
  },
  identifyRequiredEditableFields(schema) {
    return normalizeIndexerSchema(schema).fields.filter(field => field.required && field.editable);
  },
  getRequiredEditableFields(schema) {
    return normalizeIndexerSchema(schema).fields.filter(field => field.required && field.editable);
  },
  validateIndexerSelection,
  validateSelection: validateIndexerSelection,
  buildIndexerPayload,
  buildPostPayload: buildIndexerPayload,
  summarizeIndexerSelection,
  summarizeSelection: summarizeIndexerSelection,
  buildIndexerSummary: summarizeIndexerSelection
};

module.exports = Object.freeze(exported);
