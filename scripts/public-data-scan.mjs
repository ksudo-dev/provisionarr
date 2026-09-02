import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const findings = [];
const seenBlobs = new Set();

const rules = [
  {
    name: 'Linux account home path',
    regex: /\/home\/[A-Za-z0-9._-]+(?:\/|$)/g,
  },
  {
    name: 'macOS account home path',
    regex: /\/Users\/[A-Za-z0-9._-]+\/(?:Desktop|Documents|Downloads|Library|Movies|Music|Pictures|Projects|Public|Repos|Sites)(?:\/|$)/g,
  },
  {
    name: 'private IPv4 address',
    regex: /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2})\b/g,
  },
  {
    name: 'Tailscale hostname',
    regex: /\b[A-Za-z0-9-]+\.[A-Za-z0-9-]+\.ts\.net\b/g,
  },
  {
    name: '32-character hexadecimal token',
    regex: /\b[A-Fa-f0-9]{32}\b/g,
  },
  {
    name: 'personal email address',
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    allow: value => /@example\.(?:com|org|net)$/i.test(value) || /@users\.noreply\.github\.com$/i.test(value),
  },
];

function scanText(ref, path, text) {
  if (text.includes('\0')) return;
  for (const rule of rules) {
    rule.regex.lastIndex = 0;
    for (const match of text.matchAll(rule.regex)) {
      if (rule.allow?.(match[0])) continue;
      const line = text.slice(0, match.index).split('\n').length;
      findings.push({ rule: rule.name, ref, path, line });
    }
  }
}

function scanReleasePolicy(ref, path, text) {
  if (/^\.github\/workflows\/.*\.ya?ml$/.test(path)) {
    for (const [index, line] of text.split('\n').entries()) {
      const match = line.match(/^\s*-?\s*uses:\s*[^#\s]+@([^#\s]+)/);
      if (match && !/^[a-f0-9]{40}$/.test(match[1])) findings.push({rule:'Mutable GitHub Action reference',ref,path,line:index+1});
    }
  }
  if (path === 'Dockerfile' && !/^FROM\s+\S+@sha256:[a-f0-9]{64}\s*$/m.test(text)) {
    findings.push({rule:'Mutable Docker base image',ref,path,line:1});
  }
  if (path === 'scripts/public-safety-scan.sh' && !/zricethezav\/gitleaks@sha256:[a-f0-9]{64}/.test(text)) {
    findings.push({rule:'Mutable Gitleaks image',ref,path,line:1});
  }
}

function gitText(args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: root, encoding, maxBuffer: 32 * 1024 * 1024 });
}

const commits = gitText(['rev-list', '--all']).trim().split('\n').filter(Boolean);
for (const commit of commits) {
  const entries = gitText(['ls-tree', '-r', '-z', commit]).split('\0').filter(Boolean);
  for (const entry of entries) {
    const [metadata, path] = entry.split('\t');
    if (!metadata || !path) continue;
    const [, type, blob] = metadata.split(' ');
    if (type !== 'blob' || seenBlobs.has(blob)) continue;
    seenBlobs.add(blob);
    const content = gitText(['show', `${commit}:${path}`], null).toString('utf8');
    scanText(commit.slice(0, 12), path, content);
    scanReleasePolicy(commit.slice(0, 12), path, content);
  }
}

const paths = gitText(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean);
for (const path of paths) {
  try {
    const content = readFileSync(join(root, path), 'utf8');
    scanText('working-tree', path, content);
    scanReleasePolicy('working-tree', path, content);
  } catch {}
}

if (findings.length) {
  for (const finding of findings) {
    process.stderr.write(`${finding.rule}: ${finding.ref}:${finding.path}:${finding.line}\n`);
  }
  process.stderr.write(`Public-data scan failed with ${findings.length} finding(s). Matched values were not printed.\n`);
  process.exit(1);
}

process.stdout.write(`Public-data scan passed across ${commits.length} commit(s) and the working tree.\n`);
