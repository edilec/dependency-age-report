#!/usr/bin/env node
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { ConfigError, DEFAULT_LIMITS, MAX_INPUT_BYTES, incompleteInput, reportDependencyAge } from '../src/index.mjs';
import { parseStrictJson } from '../src/json.mjs';

const USAGE = 'Usage: dependency-age-report --root DIR --lock FILE [--lock FILE ...] --snapshot FILE [--review-after-days N] [--json]\n';
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

function options(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const parsed = { locks: [] };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json' && !parsed.json) parsed.json = true;
    else if (['--root', '--snapshot', '--review-after-days', '--lock'].includes(arg) &&
      typeof args[index + 1] === 'string' && args[index + 1].length > 0 && !args[index + 1].startsWith('--')) {
      const value = args[++index];
      if (arg === '--lock') parsed.locks.push(value);
      else if (!Object.hasOwn(parsed, arg)) parsed[arg] = value;
      else throw new ConfigError();
    } else throw new ConfigError();
  }
  if (typeof parsed['--root'] !== 'string' || parsed['--root'].length > 4096 || parsed['--root'].includes('\u0000') ||
      typeof parsed['--snapshot'] !== 'string' || parsed['--snapshot'].length > 4096 || parsed['--snapshot'].includes('\u0000') ||
      parsed.locks.length === 0 || parsed.locks.length > DEFAULT_LIMITS.maxLocks ||
      parsed.locks.some(path => path.length > 4096 || path.includes('\u0000'))) throw new ConfigError();
  if (Object.hasOwn(parsed, '--review-after-days')) {
    const value = parsed['--review-after-days'];
    if (!/^(?:0|[1-9]\d*)$/u.test(value) || Number(value) > 36500) throw new ConfigError();
    parsed.reviewAfterDays = Number(value);
  }
  try {
    parsed.root = realpathSync(resolve(parsed['--root']));
    if (!statSync(parsed.root).isDirectory()) throw new ConfigError();
  } catch { throw new ConfigError(); }
  return parsed;
}

function namedInput(root, named, file) {
  let real;
  try { real = realpathSync(resolve(root, named)); }
  catch { return { report: incompleteInput('input-unreadable', file) }; }
  if (!inside(root, real)) return { report: incompleteInput('path-outside-root', file) };
  try {
    const stat = statSync(real);
    if (!stat.isFile()) return { report: incompleteInput('input-unreadable', file) };
    if (stat.size > MAX_INPUT_BYTES) return { report: incompleteInput('limit-exceeded', file, '/limits/maxBytes') };
    return { real, stat };
  } catch { return { report: incompleteInput('input-unreadable', file) }; }
}

function decode(named, file) {
  let bytes;
  try { bytes = readFileSync(named.real); }
  catch { return { report: incompleteInput('input-unreadable', file) }; }
  if (bytes.length > MAX_INPUT_BYTES) return { report: incompleteInput('limit-exceeded', file, '/limits/maxBytes') };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { value: parseStrictJson(text, { maxBytes: MAX_INPUT_BYTES,
      maxDepth: DEFAULT_LIMITS.maxDepth, maxNodes: DEFAULT_LIMITS.maxNodes }) };
  } catch { return { report: incompleteInput('input-invalid', file) }; }
}

function reportFor(parsed) {
  const lockPaths = [];
  const seen = new Set();
  for (let ordinal = 0; ordinal < parsed.locks.length; ordinal++) {
    const file = `lock-${ordinal}`;
    const named = namedInput(parsed.root, parsed.locks[ordinal], file);
    if (named.report) return named.report;
    const identity = `${named.stat.dev}:${named.stat.ino}`;
    if (seen.has(named.real) || seen.has(identity)) return incompleteInput('duplicate-lock-input', file);
    seen.add(named.real);
    seen.add(identity);
    lockPaths.push(named);
  }
  const snapshotPath = namedInput(parsed.root, parsed['--snapshot'], 'snapshot');
  if (snapshotPath.report) return snapshotPath.report;
  const locks = [];
  for (let ordinal = 0; ordinal < lockPaths.length; ordinal++) {
    const decoded = decode(lockPaths[ordinal], `lock-${ordinal}`);
    if (decoded.report) return decoded.report;
    locks.push(decoded.value);
  }
  const snapshot = decode(snapshotPath, 'snapshot');
  if (snapshot.report) return snapshot.report;
  return reportDependencyAge({ locks, snapshot: snapshot.value }, { reviewAfterDays: parsed.reviewAfterDays ?? null });
}

try {
  const parsed = options(process.argv.slice(2));
  if (parsed.help) process.stdout.write(USAGE);
  else {
    const report = reportFor(parsed);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (!parsed.json) process.stderr.write(`${report.status}: ${report.summary.checked} checks, ${report.summary.errors} errors, ${report.summary.warnings} warnings\n`);
    process.exitCode = report.status === 'pass' ? 0 : report.status === 'fail' ? 1 : 2;
  }
} catch {
  process.stderr.write('Invalid CLI configuration.\n');
  process.exitCode = 2;
}
