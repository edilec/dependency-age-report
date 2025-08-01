import test from 'node:test';
import assert from 'node:assert/strict';
import { reportDependencyAge, TOOL_ID } from '../src/index.mjs';
import { cleanDocuments } from '../support/fixture-documents.mjs';

test('good saved v3 lock and complete snapshot report recorded-release age at snapshot', () => {
  assert.equal(TOOL_ID, 'dependency-age-report');
  const report = reportDependencyAge(cleanDocuments(), { now: () => 0 });
  assert.equal(report.status, 'pass');
  assert.ok(report.summary.checked > 0);
  assert.equal(report.asOf, '2026-01-01T00:00:00.000Z');
  assert.equal(report.packages.length, 1);
  assert.equal(report.packages[0].recordedReleaseAgeDays, 1);
  assert.equal(report.packages[0].observedReleases365d, 1);
  assert.equal(report.packages[0].location.file, 'lock-0');
  assert.equal(report.packages[0].location.pointer, '/packages/@1');
  assert.equal(JSON.stringify(report).includes('alpha'), false);
  assert.equal(JSON.stringify(report).includes('synthetic-app'), false);
});

test('age review candidate fires only above threshold and never claims vulnerability', () => {
  const at = reportDependencyAge(cleanDocuments(), { now: () => 0, reviewAfterDays: 1 });
  assert.equal(at.status, 'pass');
  assert.equal(at.findings.some(f => f.ruleId === 'age-review-candidate'), false);
  const over = reportDependencyAge(cleanDocuments(), { now: () => 0, reviewAfterDays: 0 });
  assert.equal(over.status, 'fail');
  assert.equal(over.findings.filter(f => f.ruleId === 'age-review-candidate').length, 1);
  assert.equal(JSON.stringify(over).toLowerCase().includes('vulnerability'), true);
  assert.equal(over.findings.every(f => f.ruleId !== 'age-review-candidate' || f.message.includes('not a vulnerability claim')), true);
});

test('recorded-release day boundary uses snapshot timestamp, not injected wall clock', () => {
  const documents = cleanDocuments();
  documents.snapshot.packages[0].releases[0].publishedAt = '2025-12-31T00:00:00.001Z';
  const before = reportDependencyAge(documents, { now: () => 99_999_999_999 });
  assert.equal(before.status, 'pass');
  assert.equal(before.packages[0].recordedReleaseAgeDays, 0);
  documents.snapshot.packages[0].releases[0].publishedAt = '2025-12-31T00:00:00.000Z';
  const at = reportDependencyAge(documents, { now: () => 0 });
  assert.equal(at.packages[0].recordedReleaseAgeDays, 1);
  assert.equal(at.asOf, before.asOf);
});

test('cadence excludes exact lower endpoint and includes one millisecond after it', () => {
  const documents = cleanDocuments();
  documents.snapshot.packages[0].historyCompleteFrom = '2025-01-01T00:00:00.000Z';
  documents.snapshot.packages[0].releases.push(
    { version: '0.8.0', publishedAt: '2025-01-01T00:00:00.000Z' },
    { version: '0.9.0', publishedAt: '2025-01-01T00:00:00.001Z' });
  const at = reportDependencyAge(documents, { now: () => 0 });
  assert.equal(at.status, 'pass');
  assert.equal(at.packages[0].observedReleases365d, 2);
  documents.snapshot.packages[0].historyCompleteFrom = '2025-01-01T00:00:00.001Z';
  const partial = reportDependencyAge(documents, { now: () => 0 });
  assert.equal(partial.status, 'incomplete');
  assert.equal(partial.packages[0].recordedReleaseAgeDays, 1);
  assert.equal(partial.packages[0].observedReleases365d, null);
  assert.equal(partial.findings.some(f => f.ruleId === 'cadence-unavailable'), true);
});

test('missing package or exact version is unknown, never zero age', () => {
  const packageMissing = cleanDocuments();
  packageMissing.snapshot.packages = [];
  const first = reportDependencyAge(packageMissing, { now: () => 0 });
  assert.equal(first.status, 'incomplete');
  assert.equal(first.packages[0].recordedReleaseAgeDays, null);
  assert.equal(first.findings.some(f => f.ruleId === 'snapshot-package-missing'), true);
  const versionMissing = cleanDocuments();
  versionMissing.snapshot.packages[0].releases[0].version = '2.0.0';
  const second = reportDependencyAge(versionMissing, { now: () => 0 });
  assert.equal(second.status, 'incomplete');
  assert.equal(second.packages[0].recordedReleaseAgeDays, null);
  assert.equal(second.findings.some(f => f.ruleId === 'snapshot-release-missing'), true);
});

test('unsupported lock dialect and root-only lock are incomplete, not vacuous pass', () => {
  const wrong = cleanDocuments();
  wrong.locks[0].lockfileVersion = 2;
  const invalid = reportDependencyAge(wrong, { now: () => 0 });
  assert.equal(invalid.status, 'incomplete');
  assert.equal(invalid.findings.some(f => f.ruleId === 'lock-invalid'), true);
  const rootOnly = cleanDocuments();
  delete rootOnly.locks[0].packages['node_modules/alpha'];
  const empty = reportDependencyAge(rootOnly, { now: () => 0 });
  assert.equal(empty.status, 'incomplete');
  assert.equal(empty.summary.checked, 0);
  assert.equal(empty.findings.some(f => f.ruleId === 'no-subject'), true);
});

test('1000 installed members are legal and 1001 exceed member cap, excluding root', () => {
  const documents = cleanDocuments();
  const packages = { '': { name: 'synthetic-app', version: '1.0.0' } };
  const metadata = [];
  for (let index = 0; index < 1000; index++) {
    const name = `p${String(index).padStart(4, '0')}`;
    packages[`node_modules/${name}`] = { version: '1.0.0' };
    metadata.push({ name, historyCompleteFrom: '2024-01-01T00:00:00.000Z',
      releases: [{ version: '1.0.0', publishedAt: '2025-12-31T00:00:00.000Z' }] });
  }
  documents.locks[0].packages = packages;
  documents.snapshot.packages = metadata;
  const at = reportDependencyAge(documents, { now: () => 0 });
  assert.equal(at.status, 'pass');
  assert.equal(at.packages.length, 1000);
  packages['node_modules/p1000'] = { version: '1.0.0' };
  const over = reportDependencyAge(documents, { now: () => 0 });
  assert.equal(over.status, 'incomplete');
  assert.equal(over.findings.some(f => f.ruleId === 'limit-exceeded'), true);
});

test('dot traversal is not a supported package-lock member path', () => {
  const documents = cleanDocuments();
  documents.locks[0].packages['node_modules/..'] = { version: '1.0.0' };
  const report = reportDependencyAge(documents, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.findings.some(f => f.ruleId === 'lock-invalid'), true);
});

test('package identity accepts 128 units but refuses 129 before absence inference', () => {
  const at = cleanDocuments();
  const name = `a${'b'.repeat(127)}`;
  at.locks[0].packages = { '': {}, [`node_modules/${name}`]: { version: '1.0.0' } };
  at.snapshot.packages[0].name = name;
  assert.equal(reportDependencyAge(at, { now: () => 0 }).status, 'pass');
  const over = cleanDocuments();
  over.locks[0].packages = { '': {}, [`node_modules/${name}c`]: { version: '1.0.0' } };
  const report = reportDependencyAge(over, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.findings.some(f => f.ruleId === 'lock-invalid'), true);
  assert.equal(report.findings.some(f => f.ruleId === 'snapshot-package-missing'), false);
});

test('scoped and nested v3 members are checked in code-unit key order', () => {
  const documents = cleanDocuments();
  documents.locks[0].packages = {
    '': { name: 'synthetic-app', version: '1.0.0' },
    'node_modules/z/node_modules/@s/b': { version: '1.0.0' },
    'node_modules/@s/b': { version: '1.0.0' },
  };
  documents.snapshot.packages = [{ name: '@s/b', historyCompleteFrom: '2024-01-01T00:00:00.000Z',
    releases: [{ version: '1.0.0', publishedAt: '2025-12-31T00:00:00.000Z' }] }];
  const report = reportDependencyAge(documents, { now: () => 0 });
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.packages.map(row => row.location.pointer), ['/packages/@1', '/packages/@2']);
  assert.equal(report.summary.checked, 4);
});

test('four distinct locks retain occurrences and fifth exceeds exact cap', () => {
  const documents = cleanDocuments();
  documents.locks = Array.from({ length: 4 }, () => structuredClone(cleanDocuments().locks[0]));
  const at = reportDependencyAge(documents, { now: () => 0 });
  assert.equal(at.status, 'pass');
  assert.deepEqual(at.packages.map(row => row.lockOrdinal), [0, 1, 2, 3]);
  documents.locks.push(structuredClone(cleanDocuments().locks[0]));
  const over = reportDependencyAge(documents, { now: () => 0 });
  assert.equal(over.status, 'incomplete');
  assert.equal(over.findings.some(f => f.ruleId === 'limit-exceeded'), true);
});

test('4000 metadata packages are legal and 4001 exceed exact cap', () => {
  const documents = cleanDocuments();
  const alpha = documents.snapshot.packages[0];
  documents.snapshot.packages = Array.from({ length: 4000 }, (_, index) => ({ ...alpha, name: `p${index}` }));
  documents.snapshot.packages[0].name = 'alpha';
  const at = reportDependencyAge(documents, { now: () => 0 });
  assert.equal(at.status, 'pass');
  documents.snapshot.packages.push({ ...alpha, name: 'overflow' });
  const over = reportDependencyAge(documents, { now: () => 0 });
  assert.equal(over.status, 'incomplete');
  assert.equal(over.findings.some(f => f.ruleId === 'limit-exceeded'), true);
});

test('64 saved releases are legal and 65 exceed exact cap', () => {
  const documents = cleanDocuments();
  const publishedAt = '2025-12-31T00:00:00.000Z';
  documents.snapshot.packages[0].releases = Array.from({ length: 64 }, (_, index) => ({ version: `${index}.0.0`, publishedAt }));
  documents.locks[0].packages['node_modules/alpha'].version = '1.0.0';
  const at = reportDependencyAge(documents, { now: () => 0 });
  assert.equal(at.status, 'pass');
  assert.equal(at.packages[0].observedReleases365d, 64);
  documents.snapshot.packages[0].releases.push({ version: '64.0.0', publishedAt });
  const over = reportDependencyAge(documents, { now: () => 0 });
  assert.equal(over.status, 'incomplete');
  assert.equal(over.findings.some(f => f.ruleId === 'limit-exceeded'), true);
});

test('invalid snapshot index cannot establish a package absence', () => {
  const documents = cleanDocuments();
  documents.snapshot.packages.push(structuredClone(documents.snapshot.packages[0]));
  const duplicate = reportDependencyAge(documents, { now: () => 0 });
  assert.equal(duplicate.status, 'incomplete');
  assert.equal(duplicate.findings.some(f => f.ruleId === 'snapshot-invalid'), true);
  assert.equal(duplicate.findings.some(f => f.ruleId === 'snapshot-package-missing'), false);
  documents.snapshot.packages.pop();
  documents.snapshot.packages[0].releases[0].publishedAt = '2026-01-01T00:00:00.001Z';
  const future = reportDependencyAge(documents, { now: () => 0 });
  assert.equal(future.status, 'incomplete');
  assert.equal(future.findings.some(f => f.ruleId === 'snapshot-invalid'), true);
  assert.equal(future.packages[0].recordedReleaseAgeDays, null);
});

test('unsupported lock member cannot be dropped while another member passes', () => {
  const documents = cleanDocuments();
  documents.locks[0].packages['node_modules/local'] = { version: 'file:../local' };
  const report = reportDependencyAge(documents, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.findings.some(f => f.ruleId === 'lock-invalid'), true);
  assert.equal(report.summary.checked, 0);
});

test('local file resolution is not a public exact-release assertion', () => {
  const documents = cleanDocuments();
  documents.locks[0].packages['node_modules/alpha'].resolved = 'https://registry.invalid/alpha/-/alpha-1.0.0.tgz';
  assert.equal(reportDependencyAge(documents, { now: () => 0 }).status, 'pass');
  documents.locks[0].packages['node_modules/alpha'].resolved = 'file:../alpha';
  const report = reportDependencyAge(documents, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.findings.some(f => f.ruleId === 'lock-invalid'), true);
  assert.equal(report.summary.checked, 0);
});

test('opaque package/version canaries never reach output', () => {
  const documents = cleanDocuments();
  documents.locks[0].packages['node_modules/token-synthetic-secret-canary'] = { version: '2.0.0' };
  const report = reportDependencyAge(documents, { now: () => 0 });
  assert.equal(report.status, 'incomplete');
  assert.equal(JSON.stringify(report).includes('token-synthetic-secret-canary'), false);
  assert.equal(JSON.stringify(report).includes('alpha'), false);
});

test('finite nondecreasing injected clock and exact timeout are required', () => {
  const good = cleanDocuments();
  let calls = 0;
  const at = reportDependencyAge(good, { now: () => calls++ ? 2000 : 0 });
  assert.equal(at.status, 'pass');
  calls = 0;
  const over = reportDependencyAge(good, { now: () => calls++ ? 2001 : 0 });
  assert.equal(over.status, 'incomplete');
  assert.equal(over.findings.some(f => f.ruleId === 'limit-exceeded'), true);
  for (const now of [() => NaN, () => Infinity]) assert.throws(() => reportDependencyAge(good, { now }), { name: 'ConfigError' });
  calls = 0;
  assert.throws(() => reportDependencyAge(good, { now: () => calls++ ? 0 : 1 }), { name: 'ConfigError' });
});
