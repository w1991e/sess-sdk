# @sess.si/create-agent

Creates a small agent that asks you two questions on your phone and plans your weekend on the real
forecast.

**Install and create:** `npm create @sess.si/agent@next my-agent`

**Run:** `cd my-agent && npm install --ignore-scripts && npm start` (with `SESS_API_KEY` and
`SESS_DEMO_CONTACT` set in your environment)

**What you'll see:** a private link. Answer two questions on your phone and your plan prints in the
terminal with a verified receipt.

## Details

The generated agent is `agent.mjs` (the flow) and `weather.mjs` (the weather and the plan rule), with
its own [README](template/README.md). It depends
on an exact version of [`@sess.si/sdk`](https://www.npmjs.com/package/@sess.si/sdk) and has no
install scripts. Its `package.json` is private.

This tool:

- writes into a new or empty directory inside the current one, and refuses anything else: a
  non-empty directory, a symlink anywhere on the path, or a path outside the current directory;
- creates each file only if nothing is there yet, so it never overwrites;
- never asks for, reads or stores your API key, and runs no `npm` command or install script;
- prints the next steps.

The generated files are `agent.mjs`, `weather.mjs`, `package.json`, `README.md`, `LICENSE`,
`.gitignore` and `.env.example`. The same template feeds the public `sess-agent-starter` repository.

Node.js 22.14 or later. [Apache-2.0](LICENSE)
