import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, linkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanDocuments } from '../support/fixture-documents.mjs';

const CLI = fileURLToPath(new URL('../bin/dependency-age-report.mjs', import.meta.url));
const GUARD = fileURLToPath(new URL('../support/deny-network.mjs', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'edilec-age-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const documents = cleanDocuments();
  const lock = join(root, 'package-lock.json');
  const snapshot = join(root, 'metadata.json');
  writeFileSync(lock, JSON.stringify(documents.locks[0]));
  writeFileSync(snapshot, JSON.stringify(documents.snapshot));
  return { root, lock, snapshot };
}
function run(...args) {
  const result = spawnSync(process.execPath, ['--import', GUARD, CLI, ...args], { encoding: 'utf8', timeout: 10000 });
  if (result.error) throw result.error;
  return result;
}
function args({ root, lock, snapshot }) { return ['--root', root, '--lock', lock, '--snapshot', snapshot]; }

test('real CLI clean, review candidate and help retain honest exit shapes', t => {
  const f = fixture(t);
  const good = run(...args(f));
  assert.equal(good.status, 0);
  assert.equal(JSON.parse(good.stdout).status, 'pass');
  assert.match(good.stderr, /^pass: /u);
  const review = run(...args(f), '--review-after-days', '0', '--json');
  assert.equal(review.status, 1);
  assert.equal(JSON.parse(review.stdout).status, 'fail');
  assert.equal(review.stderr, '');
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^Usage: dependency-age-report/u);
  assert.equal(help.stderr, '');
  assert.equal(readFileSync(f.lock, 'utf8').includes('alpha'), true);
});

test('invalid configuration has empty stdout; missing named lock is incomplete JSON', t => {
  const f = fixture(t);
  for (const invalid of [run('--bad'), run('--root', f.lock, '--lock', f.lock, '--snapshot', f.snapshot),
    run(...args(f), '--review-after-days', '01'), run(...args(f), '--json', '--bad')]) {
    assert.equal(invalid.status, 2);
    assert.equal(invalid.stdout, '');
    assert.match(invalid.stderr, /^Invalid CLI configuration\./u);
  }
  const missing = run('--root', f.root, '--lock', join(f.root, 'missing.json'), '--snapshot', f.snapshot);
  assert.equal(missing.status, 2);
  assert.equal(JSON.parse(missing.stdout).status, 'incomplete');
  assert.equal(JSON.parse(missing.stdout).findings[0].ruleId, 'input-unreadable');
});

test('same lock named twice, symlink alias and hardlink alias never double-count', t => {
  const f = fixture(t);
  const aliases = [f.lock, join(f.root, 'alias.json'), join(f.root, 'hard.json')];
  symlinkSync(f.lock, aliases[1]);
  linkSync(f.lock, aliases[2]);
  for (const alias of aliases) {
    const result = run('--root', f.root, '--lock', f.lock, '--lock', alias, '--snapshot', f.snapshot, '--json');
    assert.equal(result.status, 2);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'incomplete');
    assert.equal(report.findings[0].ruleId, 'duplicate-lock-input');
    assert.equal(report.summary.occurrences, 0);
  }
  const distinct = join(f.root, 'distinct.json');
  writeFileSync(distinct, readFileSync(f.lock));
  const good = run('--root', f.root, '--lock', f.lock, '--lock', distinct, '--snapshot', f.snapshot, '--json');
  assert.equal(good.status, 0);
  assert.equal(JSON.parse(good.stdout).summary.occurrences, 2);
});

test('safe absolute inputs with root slash work and symlink escape is incomplete', t => {
  const f = fixture(t);
  const atRoot = run('--root', '/', '--lock', f.lock, '--snapshot', f.snapshot, '--json');
  assert.equal(atRoot.status, 0);
  assert.equal(JSON.parse(atRoot.stdout).status, 'pass');
  const other = mkdtempSync(join(tmpdir(), 'edilec-age-outside-'));
  t.after(() => rmSync(other, { recursive: true, force: true }));
  const outside = join(other, 'lock.json');
  writeFileSync(outside, readFileSync(f.lock));
  symlinkSync(outside, join(f.root, 'escape.json'));
  const escaped = run('--root', f.root, '--lock', join(f.root, 'escape.json'), '--snapshot', f.snapshot, '--json');
  assert.equal(escaped.status, 2);
  assert.equal(JSON.parse(escaped.stdout).findings[0].ruleId, 'path-outside-root');
  assert.equal(escaped.stdout.includes(other), false);
});

test('duplicate keys, rounded dialect and invalid UTF-8 never pass through CLI', t => {
  const f = fixture(t);
  for (const content of [
    '{"lockfileVersion":3,"lockfileVersion":2,"packages":{}}',
    '{"lockfileVersion":2.999999999999999999999,"packages":{}}',
    Buffer.from([0xff]),
  ]) {
    writeFileSync(f.lock, content);
    const result = run(...args(f), '--json');
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).status, 'incomplete');
    assert.equal(JSON.parse(result.stdout).findings[0].ruleId, 'input-invalid');
  }
});

test('input byte boundary permits exact cap and refuses one byte beyond', t => {
  const f = fixture(t);
  const base = readFileSync(f.lock);
  const max = 4194304;
  writeFileSync(f.lock, Buffer.concat([base, Buffer.alloc(max - base.length, 0x20)]));
  const at = run(...args(f), '--json');
  assert.equal(at.status, 0);
  writeFileSync(f.lock, Buffer.concat([base, Buffer.alloc(max + 1 - base.length, 0x20)]));
  const over = run(...args(f), '--json');
  assert.equal(over.status, 2);
  assert.equal(JSON.parse(over.stdout).findings[0].ruleId, 'limit-exceeded');
});

test('untrusted named path canary is never rendered into JSON or human output', t => {
  const f = fixture(t);
  const canary = 'token-SYNTHETIC_SECRET_CANARY.json';
  const result = run('--root', f.root, '--lock', join(f.root, canary), '--snapshot', f.snapshot);
  assert.equal(result.status, 2);
  assert.equal(`${result.stdout}${result.stderr}`.includes(canary), false);
});

test('CLI lock count, path text and review threshold bounds have both sides', t => {
  const f = fixture(t);
  const distinct = [f.lock];
  for (let index = 1; index < 5; index++) {
    const path = join(f.root, `lock-${index}.json`);
    writeFileSync(path, readFileSync(f.lock));
    distinct.push(path);
  }
  const four = run('--root', f.root, ...distinct.slice(0, 4).flatMap(path => ['--lock', path]), '--snapshot', f.snapshot, '--json');
  assert.equal(four.status, 0);
  assert.equal(JSON.parse(four.stdout).summary.occurrences, 4);
  const five = run('--root', f.root, ...distinct.flatMap(path => ['--lock', path]), '--snapshot', f.snapshot, '--json');
  assert.equal(five.status, 2);
  assert.equal(five.stdout, '');
  const pathAt = run('--root', f.root, '--lock', 'x'.repeat(4096), '--snapshot', f.snapshot, '--json');
  assert.equal(pathAt.status, 2);
  assert.equal(JSON.parse(pathAt.stdout).status, 'incomplete');
  const pathOver = run('--root', f.root, '--lock', 'x'.repeat(4097), '--snapshot', f.snapshot, '--json');
  assert.equal(pathOver.status, 2);
  assert.equal(pathOver.stdout, '');
  assert.equal(run(...args(f), '--review-after-days', '36500').status, 0);
  const over = run(...args(f), '--review-after-days', '36501');
  assert.equal(over.status, 2);
  assert.equal(over.stdout, '');
});

test('documented clean, review and incomplete examples are runnable', () => {
  const base = fileURLToPath(new URL('../examples/', import.meta.url));
  const rows = [
    ['clean', [], 0, 'pass'],
    ['failing', ['--review-after-days', '30'], 1, 'fail'],
    ['incomplete', [], 2, 'incomplete'],
  ];
  for (const [directory, extra, exit, status] of rows) {
    const root = join(base, directory);
    const result = run('--root', root, '--lock', 'package-lock.json', '--snapshot', 'metadata.json', ...extra);
    assert.equal(result.status, exit, directory);
    assert.equal(JSON.parse(result.stdout).status, status, directory);
  }
});
