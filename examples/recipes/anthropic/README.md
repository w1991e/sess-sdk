# Weekend planner on Anthropic

This recipe asks a person two questions on one private Sess link and plans their weekend on live weather. The model is Anthropic's, through the Messages API with tool use.

**Needs two keys:** a Sess API key and an Anthropic API key, both in the environment. It also needs `SESS_DEMO_CONTACT`.

From `examples/recipes`, after `npm install --ignore-scripts` (or read the keys from the Keychain with `../with-keychain.sh`):

```sh
read -rs SESS_API_KEY && read -rs ANTHROPIC_API_KEY && export SESS_API_KEY ANTHROPIC_API_KEY   # paste each key; not echoed
export SESS_DEMO_CONTACT=you@example.com
node anthropic/agent.mjs
```

**What you'll see:** a private link to open on your phone. After your two answers, the plan, and the usage and cost of the run.

The default model is `claude-haiku-5-5`, the cheapest (rates and source in [../models.json](../models.json)); set `RECIPE_MODEL` to change it. Each assistant turn goes back unchanged, thinking blocks included. Every `tool_use` is answered by a `tool_result` with its `tool_use_id`.
