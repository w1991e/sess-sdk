# @sess.si/create-agent

Creates a small agent that asks you two questions on your phone and plans your weekend on the real
forecast.

**Create and run:** `npm create @sess.si/agent@next my-agent`

**What you'll see:** it asks for your Sess API key (hidden as you paste it) and a contact for the
weather services, then prints a Sess link.
Answer two questions on your phone and your plan prints in the terminal with a verified receipt.

## Details

The command writes the agent into `my-agent`, installs it (`npm install --ignore-scripts`) and runs it
once (`npm start`). It uses `SESS_API_KEY` and `SESS_DEMO_CONTACT` from your environment when they are
set, and asks only for what is missing. `SESS_DEMO_CONTACT` is a project URL or team email that the
weather services ask for. Run it again later with `cd my-agent && npm start`.

To only write the files, add `-- --no-run`. Without a terminal and without both values it also only
writes the files, then prints the next steps.

The generated agent is `agent.mjs` (the flow) and `weather.mjs` (the weather and the plan rule), with
its own [README](template/README.md). It depends
on an exact version of [`@sess.si/sdk`](https://www.npmjs.com/package/@sess.si/sdk) and has no
install scripts. Its `package.json` is private.

This tool:

- writes into a new or empty directory inside the current one, and refuses anything else: a
  non-empty directory, a symlink anywhere on the path, or a path outside the current directory;
- creates each file only if nothing is there yet, so it never overwrites;
- never takes your API key on the command line and never writes it anywhere; only the agent's own
  process receives it, through its environment;
- runs no install script.

The generated files are `agent.mjs`, `weather.mjs`, `package.json`, `README.md`, `LICENSE`,
`.gitignore` and `.env.example`. The same template feeds the public `sess-agent-starter` repository.

Node.js 22.14 or later. [Apache-2.0](LICENSE)
