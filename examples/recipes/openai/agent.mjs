// The weekend planner on OpenAI's Responses API with function tools. Stateless (`store: false`):
// every turn sends the whole history back, including the encrypted reasoning items, so the model
// keeps its reasoning across tool calls. Function results go back by `call_id`.
// Needs SESS_API_KEY, OPENAI_API_KEY and SESS_DEMO_CONTACT. Run: node openai/agent.mjs
import { fileURLToPath } from 'node:url';
import { isMain, runRecipe } from '../harness.mjs';

export const PROVIDER = {
  id: 'openai',
  keyEnv: 'OPENAI_API_KEY',
  file: fileURLToPath(import.meta.url),
};

export async function plan({ workflow, guard, model, apiKey, system, task }) {
  const tools = workflow.tools.map((t) => ({
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    strict: false,
  }));
  const input = [{ role: 'user', content: task }];
  for (;;) {
    const response = await guard.post(
      'https://api.openai.com/v1/responses',
      { authorization: `Bearer ${apiKey}` },
      {
        model,
        instructions: system,
        input,
        tools,
        max_output_tokens: guard.bounds.maxOutputTokens,
        reasoning: { effort: 'low' },
        store: false,
        include: ['reasoning.encrypted_content'],
      },
    );
    guard.count(response.usage?.input_tokens, response.usage?.output_tokens, response.model);
    const output = response.output ?? [];
    input.push(...output); // reasoning, messages and function calls, as the model sent them
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
