import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const entry of ['core', 'ui']) {
  const from = join(root, 'src', entry);
  if (!existsSync(from)) throw new Error(`missing source entry: src/${entry}`);
  cpSync(from, join(dist, entry), { recursive: true });
}

const required = [
  'dist/core/index.js',
  'dist/core/index.d.ts',
  'dist/ui/index.js',
  'dist/ui/index.d.ts'
];

for (const relative of required) {
  if (!existsSync(join(root, relative))) {
    throw new Error(`build did not produce ${relative}`);
  }
}

console.log(`built ${required.length} package entries in dist/`);
