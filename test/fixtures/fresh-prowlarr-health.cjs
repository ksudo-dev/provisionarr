'use strict';

const expectedMessages = {
  IndexerCheck: 'No indexers enabled, Prowlarr will not return search results',
  UpdateCheck: /^New update is available: v\d+(?:\.\d+){2,}$/
};

function isExpectedFreshProwlarrHealthFailure(item) {
  if (String(item?.type || item?.level || '').toLowerCase() !== 'error') return false;
  const expected = expectedMessages[String(item?.source || '')];
  if (typeof expected === 'string') return item?.message === expected;
  return expected instanceof RegExp && expected.test(String(item?.message || ''));
}

module.exports = {isExpectedFreshProwlarrHealthFailure};
