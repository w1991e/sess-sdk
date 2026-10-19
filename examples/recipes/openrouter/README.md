# Weekend planner through OpenRouter

This recipe asks a person two questions on one private Sess link and plans their weekend on live weather. The model is reached through OpenRouter's OpenAI-compatible chat completions with tools.

**Needs two keys:** a Sess API key and an OpenRouter API key, both in the environment. It also needs `SESS_DEMO_CONTACT`.

From `examples/recipes`, after `npm install --ignore-scripts` (or read the keys from the Keychain with `../with-keychain.sh`):

```sh
read -rs SESS_API_KEY && read -rs OPENROUTER_API_KEY && export SESS_API_KEY OPENROUTER_API_KEY   # paste each key; not echoed
export SESS_DEMO_CONTACT=you@example.com
node openrouter/agent.mjs
```

**What you'll see:** a private link to open on your phone. After your two answers, the plan, and the usage and cost of the run.

The default model is `anthropic/claude-haiku-5.5` (rates, source and the cheaper alternative in [../models.json](../models.json)); set `RECIPE_MODEL` to change it. The assistant message goes back as it came, including `tool_calls` and any `reasoning_details`. Each result is a `tool` message with its `tool_call_id`.
