// The weekend planner on xAI's Responses-compatible API with function calling. The conversation is
// threaded on xAI's side with `previous_response_id`: each turn sends only the new function
// results, by `call_id`, and the model keeps its earlier reasoning.
// Needs SESS_API_KEY, XAI_API_KEY and SESS_DEMO_CONTACT. Run: node xai/agent.mjs
import { fileURLToPath } from 'node:url';
import { isMain, runRecipe } from '../harness.mjs';

export const PROVIDER = {
  id: 'xai',
  keyEnv: 'XAI_API_KEY',
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
      'https://api.x.ai/v1/responses',
      { authorization: `Bearer ${apiKey}` },
      {
        model,
        input,
        tools,
        max_output_tokens: guard.bounds.maxOutputTokens,
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
