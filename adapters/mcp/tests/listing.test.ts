import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cursorDeeplink,
  generate,
  readSchemas,
  scanText,
  validate,
  type ListingInputs,
} from '../scripts/listing.mjs';
import { ENV } from '../src/config.js';
import { TOOLS, TOOL_NAMES, TOOL_SCHEMA_VERSION } from '../src/tools.js';
import { ASK_LIMITS } from '../src/validate.js';

const base = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(base, path), 'utf8');

function inputs(): ListingInputs {
  return {
    listing: JSON.parse(read('listing.json')),
    manifest: JSON.parse(read('package.json')),
    tools: structuredClone(TOOLS) as unknown as any[],
    toolNames: [...TOOL_NAMES],
    envNames: Object.values(ENV).filter((name) => name !== ENV.insecureLocalhost),
    askFieldLimit: ASK_LIMITS.fields,
  };
}
/** A successor candidate that lists the npm package: its mcpName is the registry name. */
function listed(): ListingInputs {
  const i = inputs();
  i.listing.providers.mcpRegistry.npmPackage.status = 'listed';
  i.manifest.mcpName = i.listing.registryName;
  return i;
}
const schemas = readSchemas(JSON.parse(read('listing.json')), base);
const check = (i: ListingInputs, files = generate(i)) => validate(i, files, schemas);
const edit = (files: Map<string, string>, path: string, change: (value: any) => void) => {
  const value = JSON.parse(files.get(path)!);
  change(value);
  return new Map(files).set(path, JSON.stringify(value));
};

describe('tool annotation audit', () => {
  it('matches each tool’s behaviour; schemas are sess-mcp-tools/4', () => {
    expect(TOOL_SCHEMA_VERSION).toBe('sess-mcp-tools/4');
    const table = Object.fromEntries(TOOLS.map((t) => [t.name, t.annotations]));
    // Creates a Session and a human link: writes, additive, a repeat creates another one.
    expect(table.sess_request).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    // Reads or waits for the answer; changes nothing on SESS.
    expect(table.sess_response).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    // Appends the next immutable revision; the answered one stays; an identical replay is answered.
    expect(table.sess_publish).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    // Terminal: the link stops accepting answers and the interaction never reopens.
    expect(table.sess_complete).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });
    // The same create as sess_request.
    expect(table.sess_ask).toEqual(table.sess_request);
    for (const tool of TOOLS) expect(tool.title.length).toBeGreaterThan(0);
  });
});

describe('listing.json artifacts', () => {
  it('the checked-in artifacts are exactly what listing.json, package.json and tools.ts generate', () => {
    const files = generate(inputs());
    expect([...files.keys()].sort()).toEqual(
      [
        'listings/claude-connector.json',
        'listings/cursor-install.json',
        'listings/plugin/README.md',
        'listings/plugin/mcp.json',
        'listings/plugin/plugin.json',
        'listings/plugin/skills/ask-a-person/SKILL.md',
        'server.json',
      ].sort(),
    );
    for (const [path, content] of files) expect(read(path), path).toBe(content);
  });

  it('are valid against the pinned schemas and rules, and list the owner blockers', () => {
    const { errors, blockers } = check(inputs());
    expect(errors).toEqual([]);
    const text = blockers.join('\n');
    expect(text).toMatch(
      /https:\/\/mcp\.sess\.si\/mcp is unqualified \(production host qualification pending\)/,
    );
    expect(text).toMatch(/PROPOSED and awaits the founder’s line-by-line sign-off/);
    // The icon stays an open blocker until the owner supplies a PNG; nothing is invented.
    expect(text).toMatch(/icon missing: no PNG icon yet/);
    expect(JSON.parse(read('listing.json')).icons.value).toBeNull();
    // The npm package is deferred: adding it needs a successor candidate carrying si.sess/sess.
    expect(text).toMatch(
      /MCP Registry npm package: deferred \(remote-only entry\); adding @sess\.si\/mcp needs a successor candidate whose mcpName is si\.sess\/sess \(@sess\.si\/mcp@0\.1\.0-rc\.4 on npm declares io\.github\.w1991e\/sess\)/,
    );
  });

  it('server.json is remote-only under si.sess/sess, and the package keeps its published mcpName', () => {
    const i = inputs();
    const server = JSON.parse(generate(i).get('server.json')!);
    expect(server.name).toBe('si.sess/sess');
    expect(server.packages).toBeUndefined();
    expect(server.remotes).toEqual([{ type: 'streamable-http', url: 'https://mcp.sess.si/mcp' }]);
    expect(i.manifest.mcpName).toBe('io.github.w1991e/sess');
    // A package slipped into the remote-only entry is refused.
    const slipped = edit(generate(i), 'server.json', (s) => {
      s.packages = JSON.parse(generate(listed()).get('server.json')!).packages;
    });
    expect(check(i, slipped).errors).toContain(
      'server.json must declare no packages while the npm package is deferred (remote-only)',
    );
    // An unknown npm package status is refused outright.
    const unknown = inputs();
    unknown.listing.providers.mcpRegistry.npmPackage.status = 'maybe';
    expect(() => generate(unknown)).toThrow(/listed or deferred/);
  });

  it('a successor candidate lists the stdio package beside the remote, under its own mcpName', () => {
    const i = listed();
    const server = JSON.parse(generate(i).get('server.json')!);
    expect(server.packages[0]).toMatchObject({ identifier: '@sess.si/mcp', transport: { type: 'stdio' } });
    expect(server.remotes).toEqual([{ type: 'streamable-http', url: 'https://mcp.sess.si/mcp' }]);
    expect(check(i).errors).toEqual([]);
    const mismatch = listed();
    mismatch.manifest.mcpName = 'io.github.w1991e/sess';
    expect(check(mismatch).errors).toContain('listing.json registryName must equal package.json mcpName');
  });

  it('server.json names package.json’s exact version for the server and the npm package, on every candidate', () => {
    const inputs = listed;
    const i = inputs();
    const server = JSON.parse(generate(i).get('server.json')!);
    expect(server.version).toBe(i.manifest.version);
    expect(server.packages[0].version).toBe(i.manifest.version);
    expect(server.description).toBe(
      'Your agent sends a Sess link, a person answers on any device, and the agent gets a verified answer.',
    );
    expect(i.listing.providers.mcpRegistry.version).toBeUndefined();
    for (const version of ['0.1.0-rc.4', '0.1.0']) {
      const next = inputs();
      next.manifest.version = version;
      const generated = JSON.parse(generate(next).get('server.json')!);
      expect([generated.version, generated.packages[0].version]).toEqual([version, version]);
      expect(check(next).errors).toEqual([]);
    }
    const message = `server.json and its npm package must name package.json's version ${i.manifest.version}`;
    const drift = edit(generate(i), 'server.json', (s) => {
      s.packages[0].version = '0.1.0-rc.1';
    });
    expect(check(i, drift).errors).toContain(message);
    const stale = edit(generate(i), 'server.json', (s) => {
      s.version = '0.1.0';
      s.packages[0].version = '0.1.0';
    });
    expect(check(i, stale).errors).toContain(message);
  });

  it('a changed tool title or annotation changes the artifacts, so the up-to-date check fails', () => {
    const changed = inputs();
    changed.tools[3].annotations.destructiveHint = false;
    changed.tools[0].title = 'Something else';
    const files = generate(changed);
    expect(files.get('listings/claude-connector.json')).not.toBe(read('listings/claude-connector.json'));
    expect(files.get('listings/plugin/plugin.json')).not.toBe(read('listings/plugin/plugin.json'));
    expect(files.get('listings/plugin/README.md')).not.toBe(read('listings/plugin/README.md'));
  });

  it('rejects tools without a title or with non-boolean hints', () => {
    const bad = inputs();
    bad.tools[1].title = '';
    delete bad.tools[2].annotations.destructiveHint;
    const { errors } = check(bad);
    expect(errors).toContain('sess_response: missing title');
    expect(errors).toContain('sess_publish: destructiveHint must be a boolean');
  });

  it('rejects the forbidden words and overclaims in any generated text', () => {
    for (const phrase of [
      'Find it in our marketplace.',
      'A directory of agents.',
      'Like an app store.',
      'The catalog of forms.',
      'Delivery is guaranteed.',
      'The receipt proves who answered.',
      'Identity verified.',
    ]) {
      const bad = inputs();
      bad.listing.copy.long = `Sess. ${phrase}`;
      const { errors } = check(bad);
      expect(
        errors.some((e) => /forbidden word|overclaim/.test(e)),
        phrase,
      ).toBe(true);
    }
    // URLs and encoded links are not prose.
    expect(scanText('x.md', 'See https://cursor.com/marketplace/publish')).toEqual([]);
  });

  it('validates server.json against the pinned MCP Registry schema', () => {
    const i = inputs();
    const files = edit(generate(i), 'server.json', (s) => {
      s.description = 'x'.repeat(101);
      s.remotes[0].url = 'mcp.sess.si/mcp';
    });
    const { errors } = check(i, files);
    expect(errors.some((e) => e.startsWith('server.json: /description'))).toBe(true);
    expect(errors.some((e) => e.startsWith('server.json: /remotes/0'))).toBe(true);
  });

  it('validates plugin.json and mcp.json against the pinned Agent Plugins schemas', () => {
    const i = inputs();
    let files = edit(generate(i), 'listings/plugin/plugin.json', (p) => {
      p.name = 'Sess Plugin';
      p.unknown = true;
    });
    files = edit(files, 'listings/plugin/mcp.json', (m) => {
      m.mcpServers.sess.headers = { Authorization: 'x' };
      m.mcpServers.other = { type: 'stdio', command: 'x' };
    });
    const { errors } = check(i, files);
    expect(errors.some((e) => e.startsWith('plugin.json: /name'))).toBe(true);
    expect(errors.some((e) => e.startsWith('plugin.json: / must NOT have additional properties'))).toBe(true);
    expect(errors).toContain('mcp.json must declare exactly one MCP server');
    expect(errors).toContain('mcp.json server must not carry headers');
  });

  it('refuses a vendored schema that does not match its pinned SHA-256', () => {
    const { errors } = validate(inputs(), generate(inputs()), { ...schemas, plugin: `${schemas.plugin} ` });
    expect(errors.some((e) => e.includes('does not match its pinned SHA-256'))).toBe(true);
  });

  it('enforces OpenAI’s documented submission limits', () => {
    const bad = inputs();
    bad.listing.copy.short = 'Ask a person and get the typed answer';
    bad.listing.copy.defaultPrompts = ['@Sess ask me', '@Sess ask me'];
    bad.listing.providers.agentPlugin.openai.positive[0].tools = ['sess_wait'];
    const { errors } = check(bad);
    expect(errors).toContain('copy.short is over 30 characters');
    expect(errors).toContain('plugin.json interface.shortDescription must be 1-30 characters');
    expect(errors).toContain(
      'plugin.json interface.defaultPrompt: at most 3 prompts of 128 characters, no @mentions',
    );
    expect(errors).toContain('plugin.json interface.defaultPrompt must be unique');
    expect(errors).toContain('test case names unknown tool sess_wait');
  });

  it('requires exactly five positive and three negative cases, each negative with its refusal', () => {
    const counts = inputs();
    counts.listing.providers.agentPlugin.openai.positive.pop();
    counts.listing.providers.agentPlugin.openai.negative.push({
      description: 'Another reason',
      prompt: 'Another prompt',
      expected_behavior: 'Refuses.',
    });
    expect(check(counts).errors).toContain(
      'plugin.json review needs exactly five positive and three negative test cases',
    );
    const refusal = inputs();
    delete refusal.listing.providers.agentPlugin.openai.negative[0].expected_behavior;
    expect(check(refusal).errors).toContain(
      'every negative test case needs description (why not to act), prompt and expected_behavior (the refusal)',
    );
    const plugin = JSON.parse(generate(inputs()).get('listings/plugin/plugin.json')!);
    const cases = plugin.extensions['com.openai'].review.test_cases;
    expect([cases.positive.length, cases.negative.length]).toEqual([5, 3]);
    for (const c of cases.negative)
      expect(Object.keys(c)).toEqual(['description', 'prompt', 'expected_behavior']);
  });

  it('requires all four HTTPS listing URLs for OpenAI and refuses “MCP” or “Plugin” in the name', () => {
    const i = inputs();
    const ui = JSON.parse(generate(i).get('listings/plugin/plugin.json')!).extensions['com.openai'].interface;
    expect([ui.websiteURL, ui.supportURL, ui.privacyPolicyURL, ui.termsOfServiceURL]).toEqual([
      'https://sess.si',
      'https://docs.sess.si/support/',
      'https://sess.si/privacy/',
      'https://sess.si/terms/',
    ]);
    const missing = inputs();
    missing.listing.urls.terms.value = null;
    missing.listing.urls.privacy.value = 'http://sess.si/privacy/';
    const { errors } = check(missing);
    expect(errors).toContain(
      'plugin.json interface.termsOfServiceURL must be an HTTPS URL of at most 1024 characters',
    );
    expect(errors).toContain('urls.privacy must be an HTTPS URL or null');
    for (const name of ['Sess MCP', 'Sess Plugin', 'Sess mcp server']) {
      const named = inputs();
      named.listing.displayName = name;
      expect(check(named).errors, name).toContain(
        'plugin.json interface.displayName must not include “MCP” or “Plugin”',
      );
    }
  });

  it('refuses pricing, plan, trial and upgrade text in any listing', () => {
    for (const phrase of [
      'See our pricing.',
      'Start a free trial.',
      'Upgrade to unlock more links.',
      'Subscribe for more.',
      'Pro plan includes webhooks.',
      'Only $9 a month.',
      'A 20% discount.',
    ]) {
      const bad = inputs();
      bad.listing.copy.long = `Sess. ${phrase}`;
      expect(
        check(bad).errors.some((e) => e.includes('pricing or upgrade text')),
        phrase,
      ).toBe(true);
    }
    const prompt = inputs();
    prompt.listing.copy.defaultPrompts = ['Ask me to upgrade the plan.'];
    expect(check(prompt).errors.some((e) => e.includes('pricing or upgrade text'))).toBe(true);
  });

  it('enforces the Claude connector form limits: name, one-liner, description, categories, URLs, contact', () => {
    const claude = JSON.parse(generate(inputs()).get('listings/claude-connector.json')!);
    expect(claude).toMatchObject({
      name: 'Sess',
      categories: ['Productivity', 'Developer Tools'],
      documentationUrl: 'https://docs.sess.si/add-to-your-agent/',
      privacyPolicyUrl: 'https://sess.si/privacy/',
      supportContact: 'support@sess.si',
    });
    expect(claude.oneLiner.length).toBeLessThanOrEqual(200);
    const bad = inputs();
    bad.listing.copy.oneLiner = 'x'.repeat(201);
    bad.listing.copy.long = 'y'.repeat(2001);
    bad.listing.categories = ['A', 'B', 'C', 'D', 'E', 'F'];
    bad.listing.supportContact = 'not a contact';
    bad.listing.urls.privacy.value = null;
    const { errors } = check(bad);
    expect(errors).toContain('claude-connector.json oneLiner must be 1-200 characters');
    expect(errors).toContain('claude-connector.json description must be 1-2000 characters');
    expect(errors).toContain('claude-connector.json categories must be 1-5 distinct names');
    expect(errors).toContain('claude-connector.json supportContact must be an email address or an HTTPS URL');
    expect(errors).toContain('claude-connector.json privacyPolicyUrl must be an HTTPS URL');
    const none = inputs();
    none.listing.categories = [];
    expect(check(none).errors).toContain('claude-connector.json categories must be 1-5 distinct names');
  });

  it('keeps the registry name in the si.sess namespace that DNS authentication of sess.si grants', () => {
    const i = inputs();
    expect(i.listing.providers.mcpRegistry.namespace).toMatchObject({ auth: 'dns', domain: 'sess.si' });
    const other = inputs();
    other.listing.registryName = 'io.github.w1991e/sess';
    other.manifest.mcpName = 'io.github.w1991e/sess';
    expect(check(other).errors).toContain(
      'server.json name must be in the si.sess/* namespace that DNS authentication of sess.si grants',
    );
    const preview = inputs();
    preview.listing.remote.url = 'https://mcp.preview.sess.si/mcp';
    expect(check(preview).errors).toContain(
      'remote.url must be the production endpoint https://mcp.sess.si/mcp',
    );
    const remote = edit(generate(i), 'server.json', (s) => {
      s.remotes.push({ type: 'streamable-http', url: 'https://mcp.preview.sess.si/mcp' });
    });
    expect(check(i, remote).errors).toContain(
      'server.json must declare exactly one HTTPS streamable-http remote, the listing remote URL',
    );
    const l = listed();
    const stdio = edit(generate(l), 'server.json', (s) => {
      s.packages[0].transport = { type: 'streamable-http', url: 'https://mcp.sess.si/mcp' };
    });
    expect(check(l, stdio).errors).toContain(
      'server.json must declare exactly one npm stdio package, this package',
    );
  });

  it('declares exactly the owner settings the server reads', () => {
    const bad = inputs();
    bad.listing.stdio.environmentVariables.pop();
    expect(
      check(bad).errors.some((e) => e.startsWith('stdio.environmentVariables must declare exactly')),
    ).toBe(true);
  });

  it('Cursor install links decode to their config and carry no secret', () => {
    const cursor = JSON.parse(generate(inputs()).get('listings/cursor-install.json')!);
    for (const entry of cursor.entries) {
      const link = new URL(entry.deeplink);
      expect(link.protocol).toBe('cursor:');
      expect(JSON.parse(Buffer.from(link.searchParams.get('config')!, 'base64').toString('utf8'))).toEqual(
        entry.config,
      );
    }
    expect(cursor.entries[1].config.env).toEqual({ SESS_API_KEY: '${env:SESS_API_KEY}' });
    const i = inputs();
    const files = edit(generate(i), 'listings/cursor-install.json', (c) => {
      c.entries[1].config.env.SESS_API_KEY = 'a-literal-value';
      c.entries[1].deeplink = cursorDeeplink('sess', c.entries[1].config);
    });
    expect(check(i, files).errors).toContain('cursor stdio: env values must be ${env:NAME}');
  });
});
