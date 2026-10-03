import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
for (const dir of ['src', 'bin', 'scripts', 'test']) {
  for (const file of await readdir(dir)) if (/\.(?:m?js)$/.test(file)) execFileSync(process.execPath, ['--check', join(dir, file)], { stdio: 'inherit' });
}
console.log('Syntax checks passed.');
