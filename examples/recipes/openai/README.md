# Weekend planner on OpenAI

This recipe asks a person two questions on one private Sess link and plans their weekend on live weather. The model is OpenAI's, through the Responses API with function tools.

**Needs two keys:** a Sess API key and an OpenAI API key, both in the environment. It also needs `SESS_DEMO_CONTACT`.

From `examples/recipes`, after `npm install --ignore-scripts` (or read the keys from the Keychain with `../with-keychain.sh`):

```sh
read -rs SESS_API_KEY && read -rs OPENAI_API_KEY && export SESS_API_KEY OPENAI_API_KEY   # paste each key; not echoed
export SESS_DEMO_CONTACT=you@example.com
node openai/agent.mjs
```

**What you'll see:** a private link to open on your phone. After your two answers, the plan, and the usage and cost of the run.

The default model is `gpt-5.4-nano`, falling back to `gpt-4.1-mini` if the key is not offered it (rates and sources in [../models.json](../models.json)); set `RECIPE_MODEL` to change it. The loop is stateless (`store: false`). Each turn sends back the encrypted reasoning items and the function calls, and returns each result by `call_id`.
