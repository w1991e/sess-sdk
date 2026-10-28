// Test-only helpers for the Commerce builders: capture a refusal, and check a component or a whole
// interaction against the runtime's schemas and semantic checks (runtime-items-contract.json).
import { expect } from 'vitest';
import { SessError } from '../../src/index.js';
import { validate } from './json-schema.js';
import { RUNTIME_CONTRACT, runtimeCheckItems, runtimeCheckSurface } from './runtime-items-check.js';

/** The SessError a call throws (fails the test when it returns). */
export function refusal(call: () => unknown): SessError {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(SessError);
    const e = error as SessError;
    expect(e.kind).toBe('configuration');
    expect(e.outcome).toBe('not_sent');
    return e;
  }
  throw new Error('expected a refusal');
}

/** Whether Sess would accept the component: its schema, then checkItems. Returns the failure. */
export function runtimeItemsFailure(component: unknown, at = ''): string | null {
  return (
    validate(RUNTIME_CONTRACT.items_component, component, at) ??
    runtimeCheckItems(component as Parameters<typeof runtimeCheckItems>[0], at)
  );
}

/** Whether Sess would accept the interaction: its schema, each component's, and the items rules. */
export function runtimeSurfaceFailure(interaction: unknown): string | null {
  const envelope = validate(RUNTIME_CONTRACT.interactive_interaction, interaction, '/interaction');
  if (envelope) return envelope;
  const i = interaction as { source: { components: { type: string }[] }; actions: { intent?: string }[] };
  for (const [n, c] of i.source.components.entries()) {
    const at = `/interaction/source/components/${n}`;
    const schema =
      c.type === 'items'
        ? RUNTIME_CONTRACT.items_component
        : c.type === 'record'
          ? RUNTIME_CONTRACT.record_component
          : undefined;
    if (!schema) return `${at}/type`;
    const failed = validate(schema, c, at);
    if (failed) return failed;
  }
  return runtimeCheckSurface(i);
}
