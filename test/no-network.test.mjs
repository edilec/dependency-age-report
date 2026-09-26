import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const guard = join(root, 'support/deny-network.mjs');

test('active network guard rejects safe data URL and null-socket controls', () => {
  for (const expression of [
    "await fetch('data:text/plain,probe')",
    "(await import('node:net')).Socket.prototype.connect.call(null)",
  ]) {
    const child = spawnSync(process.execPath, ['--import', guard, '--input-type=module', '-e', expression], { encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /network forbidden by test guard/u);
  }
});

test('product source gate rejects listeners, network clients and command execution', () => {
  const forbidden = /(?:\bfetch\s*\(|\.(?:listen|connect|request|lookup|resolve)\s*\(|(?<!\.)\b(?:spawn|exec|fork)\s*\(|(?:from|import\s*\()\s*['"]node:(?:net|dns|http|https|child_process)['"])/u;
  for (const path of ['src/index.mjs', 'src/validate.mjs', 'src/json.mjs', 'bin/dependency-age-report.mjs'])
    assert.doesNotMatch(readFileSync(join(root, path), 'utf8'), forbidden, path);
  assert.match('server.listen(0)', forbidden);
  const writing = /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|renameSync|unlinkSync|rmSync|mkdirSync)\s*\(/u;
  for (const path of ['src/index.mjs', 'src/validate.mjs', 'src/json.mjs', 'bin/dependency-age-report.mjs'])
    assert.doesNotMatch(readFileSync(join(root, path), 'utf8'), writing, path);
  assert.match('writeFileSync(target, data)', writing);
});
