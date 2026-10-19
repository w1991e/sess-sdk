// The weekend planner through OpenRouter's OpenAI-compatible chat completions with tools. The
// assistant message goes back as it came (tool_calls and any reasoning_details), and each result
// is a `tool` message with its `tool_call_id`.
// Needs SESS_API_KEY, OPENROUTER_API_KEY and SESS_DEMO_CONTACT. Run: node openrouter/agent.mjs
import { fileURLToPath } from 'node:url';
import { isMain, runRecipe } from '../harness.mjs';

export const PROVIDER = {
  id: 'openrouter',
  keyEnv: 'OPENROUTER_API_KEY',
  file: fileURLToPath(import.meta.url),
  /**
   * A free readback an ordinary OpenRouter key can make: the key's cumulative `usage` in USD from
   * GET /api/v1/key, read before and after a qualification run. The difference is recorded as a
   * diagnostic only, never as the run's charge (other use of the key, delayed accounting). Null on
   * any failure.
   */
  billing: {
    source: 'OpenRouter GET /api/v1/key usage',
    async read({ apiKey, fetch }) {
      const response = await fetch('https://openrouter.ai/api/v1/key', {
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return null;
      }
      const usage = (await response.json())?.data?.usage;
      return Number.isFinite(usage) ? usage : null;
    },
  },
};

export async function plan({ workflow, guard, model, apiKey, system, task }) {
  const tools = workflow.tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: task },
  ];
  for (;;) {
    const response = await guard.post(
      'https://openrouter.ai/api/v1/chat/completions',
      { authorization: `Bearer ${apiKey}` },
      { model, messages, tools, max_tokens: guard.bounds.maxOutputTokens, reasoning: { effort: 'low' } },
    );
    guard.count(response.usage?.prompt_tokens, response.usage?.completion_tokens, response.model);
    const choice = response.choices?.[0];
    const message = choice?.message ?? { role: 'assistant', content: '' };
    messages.push(message);
    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      if (choice?.finish_reason === 'length') throw new Error('The model stopped before it finished.');
      return typeof message.content === 'string' ? message.content : '';
    }
    for (const call of calls) {
      const result = await workflow.call(call.function?.name, parse(call.function?.arguments));
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
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
