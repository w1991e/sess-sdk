# Weekend planner on Gemini

This recipe asks a person two questions on one private Sess link and plans their weekend on live weather. The model is Google's, through the Gemini API with function calling.

**Needs two keys:** a Sess API key and a Gemini API key (paid tier), both in the environment. It also needs `SESS_DEMO_CONTACT`.

From `examples/recipes`, after `npm install --ignore-scripts` (or read the keys from the Keychain with `../with-keychain.sh`):

```sh
read -rs SESS_API_KEY && read -rs GEMINI_API_KEY && export SESS_API_KEY GEMINI_API_KEY   # paste each key; not echoed
export SESS_DEMO_CONTACT=you@example.com
node gemini/agent.mjs
```

**What you'll see:** a private link to open on your phone. After your two answers, the plan, and the usage and cost of the run.

The default model is `gemini-3.8-flash`, the current Flash (founder 2026-10-19), falling back to `gemini-3.5-flash-lite` on a 404 (rates and source in [../models.json](../models.json)); set `RECIPE_MODEL` to change it. The model's content goes back unchanged, so its thought signatures stay with their function calls. Each `functionResponse` carries the call's name and id.
