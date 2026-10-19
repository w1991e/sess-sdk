# Weekend planner on Meta

This recipe asks a person two questions on one private Sess link and plans their weekend on live weather. The model is Meta's, through the Meta Model API's Responses API with tool calling.

**Needs two keys:** a Sess API key and a Meta Model API key, both in the environment. It also needs `SESS_DEMO_CONTACT`.

From `examples/recipes`, after `npm install --ignore-scripts` (or read the keys from the Keychain with `../with-keychain.sh`):

```sh
read -rs SESS_API_KEY && read -rs META_API_KEY && export SESS_API_KEY META_API_KEY   # paste each key; not echoed
export SESS_DEMO_CONTACT=you@example.com
node meta/agent.mjs
```

**What you'll see:** a private link to open on your phone. After your two answers, the plan, and the usage and cost of the run.

The default model is `muse-spark-1.3` (Muse Spark 1.3, 1.2 and 1.1 cost the same; rates and source in [../models.json](../models.json)); set `RECIPE_MODEL` to change it. Turns are threaded with `previous_response_id`, which keeps the model's reasoning across tool turns, and each result goes back by `call_id`.

Use the API's Standard mode, in which your content is not used for training.
