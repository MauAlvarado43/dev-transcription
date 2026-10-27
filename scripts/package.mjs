import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { name, version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });

const result = spawnSync(
  process.execPath,
  [require.resolve('@vscode/vsce/vsce'), 'package', '--no-dependencies', '--out', `dist/${name}-${version}.vsix`],
  { cwd: root, stdio: 'inherit' }
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
