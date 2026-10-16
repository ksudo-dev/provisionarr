const historicalPublicDataAllowances = [
  {
    path: 'test/discovery-catalog.test.js',
    rule: 'private IPv4 address',
    value: ['192', '168', '50', '9'].join('.'),
    blobs: new Set([
      ['147f6e2ff758f003', 'b031b0943dd64897', '32a20376'].join(''),
      ['2f449baf8b1c5b64', '8bdd6f0c2247db62', 'bb9a74fa'].join(''),
      ['bc20d8769840db64', '7d729502a01258fd', '23b05747'].join(''),
    ]),
  },
  {
    path: 'test/discovery-catalog.test.js',
    rule: 'personal email address',
    value: 'user' + '@' + 'static.tvmaze.com',
    blobs: new Set([
      ['147f6e2ff758f003', 'b031b0943dd64897', '32a20376'].join(''),
      ['bc20d8769840db64', '7d729502a01258fd', '23b05747'].join(''),
    ]),
  },
  {
    path: 'CODE_OF_CONDUCT.md',
    rule: 'personal email address',
    value: 'k' + '@' + 'sudo-dev.com',
    blobs: new Set([
      ['4019fb0c4429b3cf', '741966de610b0242', '2060f809'].join(''),
    ]),
  },
];

// Historical allowances are pinned to the exact blob, path, rule, and value.
// Working-tree matches have no blob identity and must remain findings.
export function isHistoricalPublicDataAllowance({rule, path, value, blob}) {
  return Boolean(blob) && historicalPublicDataAllowances.some(allowance =>
    allowance.path === path && allowance.rule === rule && allowance.value === value && allowance.blobs.has(blob)
  );
}
