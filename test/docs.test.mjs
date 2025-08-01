import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RULE_SEVERITY } from '../src/index.mjs';

test('README rule table includes every emitted rule and severity', () => {
  const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');
  for (const [rule, severity] of Object.entries(RULE_SEVERITY))
    assert.ok(readme.includes('| `' + rule + '` | ' + severity + ' |'), rule);
  assert.match(readme, /snapshot timestamp/u);
  assert.match(readme, /not a vulnerability assertion/u);
});
