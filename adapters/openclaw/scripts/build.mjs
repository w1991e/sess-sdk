// Explicit build (no lifecycle hooks): clean compiled output, then compile src/ to ESM in dist/.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], {
  stdio: 'inherit',
});
