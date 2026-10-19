// The weekend planner on the Gemini API with function calling. The model's content goes back
// unchanged, so its thought signatures stay with the function calls they belong to; each
// functionResponse carries the call's name and, when the model gave one, its id.
// Needs SESS_API_KEY, GEMINI_API_KEY and SESS_DEMO_CONTACT. Run: node gemini/agent.mjs
import { fileURLToPath } from 'node:url';
import { isMain, runRecipe } from '../harness.mjs';

export const PROVIDER = {
  id: 'gemini',
  keyEnv: 'GEMINI_API_KEY',
  file: fileURLToPath(import.meta.url),
};

export async function plan({ workflow, guard, model, apiKey, system, task }) {
  const tools = [
    {
      functionDeclarations: workflow.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parametersJsonSchema: t.parameters,
      })),
    },
  ];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const contents = [{ role: 'user', parts: [{ text: task }] }];
  for (;;) {
    const response = await guard.post(
      url,
      { 'x-goog-api-key': apiKey },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools,
        generationConfig: {
          maxOutputTokens: guard.bounds.maxOutputTokens,
          // Gemini 3 models (the default 3.1 Flash-Lite included) take a thinking level.
          ...(model.startsWith('gemini-3') ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
        },
      },
    );
    const u = response.usageMetadata ?? {};
    guard.count(
      u.promptTokenCount,
      u.candidatesTokenCount === undefined ? undefined : u.candidatesTokenCount + (u.thoughtsTokenCount ?? 0),
      response.modelVersion,
    );
    const candidate = response.candidates?.[0];
    const content = candidate?.content ?? { role: 'model', parts: [] };
    contents.push(content);
    const calls = (content.parts ?? []).filter((part) => part.functionCall);
    if (calls.length === 0) {
      if (candidate?.finishReason === 'MAX_TOKENS') throw new Error('The model stopped before it finished.');
      return (content.parts ?? [])
        .filter((part) => typeof part.text === 'string' && !part.thought)
        .map((part) => part.text)
        .join('');
    }
    const parts = [];
    for (const { functionCall } of calls) {
      const result = await workflow.call(functionCall.name, functionCall.args);
      parts.push({
        functionResponse: {
          name: functionCall.name,
          ...(functionCall.id ? { id: functionCall.id } : {}),
          response: result,
        },
      });
    }
    contents.push({ role: 'user', parts });
  }
}

if (isMain(import.meta.url)) process.exitCode = (await runRecipe(PROVIDER, plan)).ok ? 0 : 1;
