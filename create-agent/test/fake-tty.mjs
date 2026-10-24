// Test-only preload for the initializer (`node --import <this file> index.mjs`). Not packed.
//
// It makes a piped stdin look like a terminal: `isTTY` is true and `setRawMode` records the mode
// instead of changing a terminal. Each chunk the test types is logged with whether raw mode (no echo)
// was on when it arrived. On exit the log goes to the file named in FAKE_TTY_RECORD.
import { writeFileSync } from 'node:fs';

const log = [];
const input = process.stdin;
let hooked = false;
input.isTTY = true;
input.isRaw = false;
input.setRawMode = (on) => {
  input.isRaw = on;
  log.push(`raw:${on}`);
  if (!hooked) {
    hooked = true;
    input.prependListener('data', () => log.push(`typed:raw=${input.isRaw}`));
  }
  return input;
};
process.on('exit', () => writeFileSync(process.env.FAKE_TTY_RECORD, `${JSON.stringify(log)}\n`));
