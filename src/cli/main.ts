#!/usr/bin/env node
// The `sess` executable. The only command is `sess verify <bundle.json>` (see ./verify.ts).
import { runCli } from './verify.js';

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
