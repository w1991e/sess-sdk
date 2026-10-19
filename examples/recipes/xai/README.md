# Weekend planner on xAI Grok

This recipe asks a person two questions on one private Sess link and plans their weekend on live weather. The model is xAI's, through its Responses-compatible API with function calling.

**Needs two keys:** a Sess API key and an xAI API key, both in the environment. It also needs `SESS_DEMO_CONTACT`.

From `examples/recipes`, after `npm install --ignore-scripts` (or read the keys from the Keychain with `../with-keychain.sh`):

```sh
read -rs SESS_API_KEY && read -rs XAI_API_KEY && export SESS_API_KEY XAI_API_KEY   # paste each key; not echoed
export SESS_DEMO_CONTACT=you@example.com
node xai/agent.mjs
```

**What you'll see:** a private link to open on your phone. After your two answers, the plan, and the usage and cost of the run.

The default model is `grok-4.3`, the cheapest general model with function calling (rates, source and why not `grok-build-0.1` in [../models.json](../models.json)); set `RECIPE_MODEL` to change it. Turns are threaded with `previous_response_id`, and each result goes back by `call_id`.
