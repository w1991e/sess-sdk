// Test-only stand-in for npm, reached through npm_execpath (`node <this file> install|start ...`), so
// the initializer tests run with no network, no registry and no real agent. Not packed.
//
// FAKE_NPM (JSON): { record, install?: <exit code>, start?: <exit code> | 'SIGTERM' }
// Each call appends one JSON line to `record`: the npm arguments, the directory, and the two
// values the agent needs. The API key is recorded only as a SHA-256 digest, so no file the tests
// write holds it.
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';

const config = JSON.parse(process.env.FAKE_NPM ?? '{}');
const [command] = process.argv.slice(2);
const key = process.env.SESS_API_KEY;
appendFileSync(
  config.record,
  `${JSON.stringify({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    keySha256: key === undefined ? null : createHash('sha256').update(key).digest('hex'),
    contact: process.env.SESS_DEMO_CONTACT ?? null,
  })}\n`,
);
if (command === 'install') {
  if (config.install) {
    console.error('npm error code E404 (fake)');
    process.exit(config.install);
  }
  console.log('added 4 packages (fake)');
} else if (command === 'start') {
  console.log('Agent running. Asking where and when.');
  console.log('Open this private link on your phone. Anyone with it can answer:\n  https://sess.si/s/fake');
  if (config.start === 'SIGTERM') process.kill(process.pid, 'SIGTERM');
  else process.exit(config.start ?? 0);
} else process.exit(64);
