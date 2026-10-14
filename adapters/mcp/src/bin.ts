#!/usr/bin/env node
import { main } from './server.js';

main().catch(() => {
  process.stderr.write('sess-mcp: the stdio server could not start\n');
  process.exitCode = 1;
});
