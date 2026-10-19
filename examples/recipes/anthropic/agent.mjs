// The weekend planner on Anthropic's Messages API with tool use. Each assistant turn goes back
// exactly as it came (text, thinking and tool_use blocks), and every tool_use gets a tool_result
// with its `tool_use_id` in the next user turn.
// Needs SESS_API_KEY, ANTHROPIC_API_KEY and SESS_DEMO_CONTACT. Run: node anthropic/agent.mjs
import { fileURLToPath } from 'node:url';
import { isMain, runRecipe } from '../harness.mjs';

export const PROVIDER = {
  id: 'anthropic',
  keyEnv: 'ANTHROPIC_API_KEY',
  file: fileURLToPath(import.meta.url),
};

export async function plan({ workflow, guard, model, apiKey, system, task }) {
  const tools = workflow.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
  const messages = [{ role: 'user', content: task }];
  for (;;) {
    const response = await guard.post(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      { model, system, messages, tools, max_tokens: guard.bounds.maxOutputTokens },
    );
    const u = response.usage ?? {};
    guard.count(
      u.input_tokens === undefined
        ? undefined
        : u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      u.output_tokens,
      response.model,
    );
    const content = response.content ?? [];
    messages.push({ role: 'assistant', content });
    const uses = content.filter((block) => block.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || uses.length === 0) {
      if (response.stop_reason === 'max_tokens') throw new Error('The model stopped before it finished.');
      return content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
    }
    const results = [];
    for (const use of uses) {
      const result = await workflow.call(use.name, use.input);
      results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(result) });
    }
    messages.push({ role: 'user', content: results });
  }
}

if (isMain(import.meta.url)) process.exitCode = (await runRecipe(PROVIDER, plan)).ok ? 0 : 1;
