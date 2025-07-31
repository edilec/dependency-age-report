import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStrictJson } from '../src/json.mjs';

test('strict JSON preserves ordinary v3 numeric versions and decoded distinct keys', () => {
  const parsed = parseStrictJson('{"lockfileVersion":3,"packages":{"":{},"node_modules/a":{}}}');
  assert.equal(parsed.lockfileVersion, 3);
  assert.equal(Object.keys(parsed.packages).length, 2);
});

test('duplicate decoded keys on both lock and metadata indexes are refused', () => {
  for (const text of [
    '{"lockfileVersion":3,"lockfileVersion":2}',
    '{"packages":{"node_modules/a":{},"node_modules/\\u0061":{}}}',
    '{"packages":[{"name":"a","name":"b"}]}',
  ]) assert.throws(() => parseStrictJson(text), { name: 'EvidenceError' });
});

test('rounded numeric dialect token cannot masquerade as exact lockfile version', () => {
  assert.throws(() => parseStrictJson('{"lockfileVersion":2.999999999999999999999}'), { name: 'EvidenceError' });
  assert.equal(parseStrictJson('{"lockfileVersion":3.0}').lockfileVersion, 3);
});

test('byte, depth and node limits fire at N plus one but not N', () => {
  const text = '{"a":"é"}';
  const bytes = Buffer.byteLength(text, 'utf8');
  assert.deepEqual(parseStrictJson(text, { maxBytes: bytes }), { a: 'é' });
  assert.throws(() => parseStrictJson(text, { maxBytes: bytes - 1 }), { name: 'EvidenceError' });
  assert.deepEqual(parseStrictJson('{"a":1}', { maxDepth: 1, maxNodes: 2 }), { a: 1 });
  assert.throws(() => parseStrictJson('{"a":1}', { maxDepth: 0, maxNodes: 2 }), { name: 'EvidenceError' });
  assert.throws(() => parseStrictJson('{"a":1}', { maxDepth: 1, maxNodes: 1 }), { name: 'EvidenceError' });
});
