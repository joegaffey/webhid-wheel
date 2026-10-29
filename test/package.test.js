import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('build produces both package entries and types', () => {
  execFileSync(process.execPath, ['scripts/build.js'], { cwd: root, stdio: 'pipe' });
  for (const relative of [
    'dist/core/index.js',
    'dist/core/index.d.ts',
    'dist/ui/index.js',
    'dist/ui/index.d.ts'
  ]) {
    assert.equal(existsSync(join(root, relative)), true, relative);
  }

  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.exports['.'].import, './dist/core/index.js');
  assert.equal(pkg.exports['./ui'].import, './dist/ui/index.js');
  assert.deepEqual(pkg.sideEffects, ['./dist/ui/index.js']);
});

test('core entry imports without DOM and keeps compatibility exports', async () => {
  const core = await import('../dist/core/index.js');
  for (const name of ['WebHIDWheel', 'WebHIDDevice', 'WheelManager', 'ProfileManager', 'SetupProfileManager', 'mapChannels']) {
    assert.equal(typeof core[name], 'function', name);
  }
  assert.equal(core.default, core.WebHIDWheel);
});

test('compatibility shim and UI entry import in Node', async () => {
  const shim = await import('../webhid-wheel.js');
  assert.equal(typeof shim.WebHIDWheel, 'function');
  assert.equal(shim.default, shim.WebHIDWheel);

  const ui = await import('../dist/ui/index.js');
  assert.equal(typeof ui.registerWebHIDElements, 'function');
  assert.equal(typeof ui.WebHIDConfigPanel, 'function');
});
