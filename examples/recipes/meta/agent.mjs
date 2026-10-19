// The weekend planner on the Meta Model API's Responses API with tool calling, as Meta's tool
// calling guide recommends: the turns are threaded with `previous_response_id`, which keeps the
// model's reasoning across tool turns, and each result goes back as a function_call_output by
// `call_id`.
// Needs SESS_API_KEY, META_API_KEY and SESS_DEMO_CONTACT. Run: node meta/agent.mjs
import { fileURLToPath } from 'node:url';
import { isMain, runRecipe } from '../harness.mjs';

export const PROVIDER = {
  id: 'meta',
  keyEnv: 'META_API_KEY',
  file: fileURLToPath(import.meta.url),
};

export async function plan({ workflow, guard, model, apiKey, system, task }) {
  const tools = workflow.tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
  let input = [
    { role: 'system', content: system },
    { role: 'user', content: task },
  ];
  let previous = null;
  for (;;) {
    const response = await guard.post(
      'https://api.meta.ai/v1/responses',
      { authorization: `Bearer ${apiKey}` },
      {
        model,
        input,
        tools,
        max_output_tokens: guard.bounds.maxOutputTokens,
        reasoning: { effort: 'low' },
        ...(previous ? { previous_response_id: previous } : {}),
      },
    );
    guard.count(response.usage?.input_tokens, response.usage?.output_tokens, response.model);
    previous = response.id;
    const output = response.output ?? [];
    const calls = output.filter((item) => item.type === 'function_call');
    if (calls.length === 0) {
      if (response.status === 'incomplete') throw new Error('The model stopped before it finished.');
      return output
        .filter((item) => item.type === 'message')
        .flatMap((item) => item.content ?? [])
        .filter((part) => part.type === 'output_text')
        .map((part) => part.text)
        .join('');
    }
    input = [];
    for (const call of calls) {
      const result = await workflow.call(call.name, parse(call.arguments));
      input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
    }
  }
}

function parse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

if (isMain(import.meta.url)) process.exitCode = (await runRecipe(PROVIDER, plan)).ok ? 0 : 1;
