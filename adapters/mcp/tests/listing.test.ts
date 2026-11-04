import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  checkIconFiles,
  checkPackets,
  cursorDeeplink,
  generate,
  pngSize,
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
        'listings/cline-issue.md',
        'listings/cursor-install.json',
        'listings/docker/readme.md',
        'listings/docker/server.yaml',
        'listings/docker/tools.json',
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
    // Production proved claude.ai, not Cursor: only Cursor's remote is still a blocker.
    expect(text).toMatch(
      /Cursor remote: https:\/\/mcp\.sess\.si\/mcp is unqualified on Cursor \(no production Cursor run is our evidence\)/,
    );
    expect(text).not.toMatch(/Claude remote/);
    expect(text).not.toMatch(/production host qualification pending/);
    // Signed copy is no blocker; a change back to proposed is.
    expect(text).not.toMatch(/PROPOSED/);
    const proposed = inputs();
    proposed.listing.copy.status = 'proposed';
    expect(check(proposed).blockers.join('\n')).toMatch(/PROPOSED and awaits the founder’s/);
    // The signature is on the words: the test cases still have to be run.
    expect(text).toMatch(/OpenAI: test cases are not yet run against a Sess test account/);
    expect(text).toMatch(
      /Cursor: one production round through the one-click install, run by the founder, before submitting/,
    );
    // Hosts and stores with no qualified packet say so; none is promoted.
    expect(text).toMatch(/OpenAI: ChatGPT has one production run, not marked qualified .*Codex has none/);
    expect(text).toMatch(/Docker: OAuth through Docker's Toolkit is untested/);
    // Production serves the icon URLs and npm serves 0.1.0, so neither is a blocker; Cline's
    // 400x400 stays one until it is deployed and committed here.
    expect(text).not.toMatch(/icon URLs/);
    expect(text).not.toMatch(/on npm$/m);
    expect(text).toMatch(
      /Cline: needs a 400x400 PNG at a deployed URL; it is in w1991e\/sess PR #1019, not merged at this writing and not deployed until a founder window/,
    );
    expect(text).toMatch(/Cline: listings\/cline-issue\.md has OWNER: lines to resolve/);
    expect(text).not.toMatch(/no PNG icon yet/);
    expect(text).not.toMatch(/urls\.(privacy|terms)/);
    // The npm package is deferred: adding it needs a successor candidate carrying si.sess/sess.
    expect(text).toMatch(
      /MCP Registry npm package: deferred \(remote-only entry\); adding @sess\.si\/mcp needs a successor candidate whose mcpName is si\.sess\/sess \(@sess\.si\/mcp@0\.1\.0 on npm declares io\.github\.w1991e\/sess\)/,
    );
  });

  it('remote.status and stdio.status take allowed values, and each blocks while it is not there', () => {
    const remote = inputs();
    remote.listing.remote.status = 'maybe';
    expect(check(remote).errors).toContain('remote.status must be qualified or unqualified');
    const stdio = inputs();
    stdio.listing.stdio.status = 'maybe';
    expect(check(stdio).errors).toContain('stdio.status must be published or unpublished');

    // The remote blocker fires when no host is qualified.
    const unqualified = inputs();
    unqualified.listing.remote.status = 'unqualified';
    const { errors, blockers } = check(unqualified);
    expect(errors).toEqual([]);
    expect(blockers).toContain(
      'all remote entries: https://mcp.sess.si/mcp is unqualified (production host qualification pending)',
    );
    const unpublished = inputs();
    unpublished.listing.stdio.status = 'unpublished';
    expect(check(unpublished).blockers).toContain(
      'MCP Registry and Cursor stdio: @sess.si/mcp is unpublished on npm',
    );

    // remote.status qualified needs a host proved by evidence.
    const noProof = inputs();
    noProof.listing.providers.claudeConnector.remoteStatus = 'unqualified';
    expect(check(noProof).errors).toContain(
      'remote.status qualified needs a provider qualified with qualificationEvidence',
    );
    for (const evidence of [[], [''], ['  '], 'a run', [1]]) {
      const bad = inputs();
      bad.listing.providers.claudeConnector.qualificationEvidence = evidence;
      expect(check(bad).errors).toEqual([
        'Claude: remoteStatus qualified needs qualificationEvidence from a production run',
        'Claude: qualificationEvidence must be a non-empty array of non-empty strings',
        'remote.status qualified needs a provider qualified with qualificationEvidence',
      ]);
    }
  });

  it('server.json and plugin.json point at sess.si and carry no optional repository', () => {
    const i = inputs();
    const files = generate(i);
    const server = JSON.parse(files.get('server.json')!);
    expect(server.websiteUrl).toBe('https://sess.si');
    expect(server.repository).toBeUndefined();
    const plugin = JSON.parse(files.get('listings/plugin/plugin.json')!);
    expect(plugin.homepage).toBe('https://sess.si');
    expect(plugin.repository).toBeUndefined();
    expect(files.get('listings/plugin/README.md')).not.toContain('github.com');
    const drifted = edit(files, 'server.json', (s) => {
      s.websiteUrl = 'https://example.com';
    });
    expect(check(i, drifted).errors).toContain('server.json websiteUrl must be listing.json homepage');
  });

  it('the one-line description fields (copy.registry, copy.oneLiner) are the MCP adapter README’s first line, word for word', () => {
    const readmeFirstLine = read('README.md').split('\n')[2];
    expect(readmeFirstLine).toBe('Ask a person a question and continue with their verified answer.');
    const { listing } = inputs();
    expect(listing.copy.registry).toBe(readmeFirstLine);
    expect(listing.copy.oneLiner).toBe(readmeFirstLine);
    const files = generate(inputs());
    expect(JSON.parse(files.get('server.json')!).description).toBe(readmeFirstLine);
    expect(JSON.parse(files.get('listings/plugin/plugin.json')!).description).toBe(readmeFirstLine);
    expect(JSON.parse(files.get('listings/claude-connector.json')!).oneLiner).toBe(readmeFirstLine);
    expect(files.get('listings/docker/server.yaml')).toContain(`  description: ${readmeFirstLine}\n`);
    expect(files.get('listings/cline-issue.md')).toContain(`\n${readmeFirstLine}\n`);
  });

  it('Claude and Cursor each carry their own status; qualified needs that host’s evidence', () => {
    const files = generate(inputs());
    const claude = () => JSON.parse(files.get('listings/claude-connector.json')!);
    const cursor = () => JSON.parse(files.get('listings/cursor-install.json')!);
    expect(claude().status).toBe('qualified');
    expect(cursor().entries.map((e: any) => [e.transport, e.status])).toEqual([
      ['streamable-http', 'unqualified'],
      ['stdio', 'published'],
    ]);
    expect(files.get('listings/cursor-install.json')).not.toMatch(/"qualified"/);

    // The shared remote.status feeds neither artifact.
    const shared = inputs();
    shared.listing.remote.status = 'something-else';
    const sharedFiles = generate(shared);
    expect(JSON.parse(sharedFiles.get('listings/claude-connector.json')!).status).toBe('qualified');
    expect(JSON.parse(sharedFiles.get('listings/cursor-install.json')!).entries[0].status).toBe(
      'unqualified',
    );

    // Qualifying a host without evidence is refused; a hand-edited artifact is refused.
    const noEvidence = inputs();
    noEvidence.listing.providers.cursorInstall.remoteStatus = 'qualified';
    expect(check(noEvidence).errors).toContain(
      'Cursor: remoteStatus qualified needs qualificationEvidence from a production run',
    );
    const unknown = inputs();
    unknown.listing.providers.claudeConnector.remoteStatus = 'maybe';
    expect(check(unknown).errors).toContain('Claude: remoteStatus must be qualified or unqualified');
    const i = inputs();
    const edited = edit(generate(i), 'listings/cursor-install.json', (c) => {
      c.entries[0].status = 'qualified';
    });
    expect(check(i, edited).errors).toContain(
      "Cursor: the artifact's status must be its provider's remoteStatus",
    );
  });

  it('the Cline issue fills Cline’s template with true values and ticks nothing', () => {
    const issue = generate(inputs()).get('listings/cline-issue.md')!;
    for (const heading of [
      '## GitHub Repository URL',
      '## Logo Image',
      '## Installation Testing',
      '## Additional Information',
    ])
      expect(issue).toContain(`\n${heading}\n`);
    expect(issue).toContain('`[Server Submission]: Sess`');
    // Only the sections below the title are form content: the preamble is not.
    expect(issue).toContain(
      'Everything else in the sections below `## Title` goes into the form as written.',
    );
    expect(issue).toContain('\nhttps://github.com/w1991e/sess-sdk/tree/master/adapters/mcp\n');
    // Neither required box is ticked; each has an OWNER: line, and so does the undeployed logo.
    expect(issue).not.toMatch(/- \[x\]/i);
    expect(issue.match(/^- \[ \] /gm)).toHaveLength(2);
    expect(issue.match(/^OWNER: /gm)).toHaveLength(3);
    // No PNG exists to point at yet: the only icons are the deployed set, and none is named here.
    expect(issue).not.toMatch(/icon-\d+\.png|\/assets\/icons\//);
    expect(issue).toContain('https://mcp.sess.si/mcp');
    expect(issue).toContain('https://sess.si');
    expect(issue).toContain('https://www.npmjs.com/package/@sess.si/mcp');
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
    expect(server.description).toBe('Ask a person a question and continue with their verified answer.');
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
    // Stale: both name the previous candidate, not package.json's version.
    expect(i.manifest.version).not.toBe('0.1.0-rc.4');
    const stale = edit(generate(i), 'server.json', (s) => {
      s.version = '0.1.0-rc.4';
      s.packages[0].version = '0.1.0-rc.4';
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
      supportContact: 'ask@sess.si',
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
    // The remote link installs the production endpoint, and nothing else.
    const remoteLink = new URL(cursor.entries[0].deeplink);
    expect(
      JSON.parse(Buffer.from(remoteLink.searchParams.get('config')!, 'base64').toString('utf8')),
    ).toEqual({
      url: 'https://mcp.sess.si/mcp',
    });
    const preview = inputs();
    const previewFiles = edit(generate(preview), 'listings/cursor-install.json', (c) => {
      c.entries[0].config.url = 'https://mcp.preview.example/mcp';
      c.entries[0].deeplink = cursorDeeplink('sess', c.entries[0].config);
    });
    expect(check(preview, previewFiles).errors).toContain(
      'cursor remote link must install the production endpoint https://mcp.sess.si/mcp',
    );
    const i = inputs();
    const files = edit(generate(i), 'listings/cursor-install.json', (c) => {
      c.entries[1].config.env.SESS_API_KEY = 'a-literal-value';
      c.entries[1].deeplink = cursorDeeplink('sess', c.entries[1].config);
    });
    expect(check(i, files).errors).toContain('cursor stdio: env values must be ${env:NAME}');
  });
});

describe('listing icons', () => {
  const readBytes = (path: string) =>
    existsSync(join(base, path)) ? readFileSync(join(base, path)) : undefined;
  const ICON_URL = 'https://sess.si/assets/icons/24eb73d4a4d9';

  it('are the Sess logos script’s 512 and 192 PNGs, square, at their pinned SHA-256s', () => {
    const { icons } = inputs().listing;
    expect(icons.source).toMatchObject({
      repository: 'https://github.com/w1991e/sess',
      commit: '43f169107f2b37a1e1b14ec69bc5ae446931445c',
      generator: 'packages/design-tokens/scripts/logos.ts',
      iconSetVersion: '24eb73d4a4d9',
    });
    expect(icons.files).toEqual([
      {
        path: 'listings/plugin/assets/icon-512.png',
        size: 512,
        sha256: '423a61419cf7988e51afb858e671a23bffea8593eb7529345cce854073d6ae90',
      },
      {
        path: 'listings/plugin/assets/icon-192.png',
        size: 192,
        sha256: '7c22cd45d39dd0b57d5dc61282952b77724f345614e763d08e74b34d57c1e862',
      },
    ]);
    expect(checkIconFiles(inputs().listing, readBytes)).toEqual([]);
    for (const f of icons.files)
      expect(pngSize(readBytes(f.path))).toEqual({ width: f.size, height: f.size });
  });

  it('refuses a missing icon, a non-PNG, a wrong size and changed bytes', () => {
    const listing = inputs().listing;
    const real = readBytes('listings/plugin/assets/icon-512.png')!;
    const swapped = (path: string) =>
      path.endsWith('icon-512.png') ? readBytes('listings/plugin/assets/icon-192.png') : readBytes(path);
    expect(checkIconFiles(listing, (p) => (p.endsWith('icon-512.png') ? undefined : readBytes(p)))).toEqual([
      'icon listings/plugin/assets/icon-512.png is missing',
    ]);
    expect(checkIconFiles(listing, swapped)).toEqual([
      'icon listings/plugin/assets/icon-512.png is 192x192, not the stated 512x512',
      'icon listings/plugin/assets/icon-512.png does not match its recorded SHA-256',
    ]);
    const notPng = (p: string) =>
      p.endsWith('icon-512.png') ? Buffer.from('GIF89a not a png') : readBytes(p);
    expect(checkIconFiles(listing, notPng)).toContain(
      'icon listings/plugin/assets/icon-512.png is not a PNG',
    );
    // One changed byte after the header: same IHDR, different SHA-256.
    const tampered = Buffer.from(real);
    const at = tampered.length - 20;
    tampered[at] = tampered[at]! ^ 1;
    expect(createHash('sha256').update(tampered).digest('hex')).not.toBe(listing.icons.files[0].sha256);
    expect(checkIconFiles(listing, (p) => (p.endsWith('icon-512.png') ? tampered : readBytes(p)))).toEqual([
      'icon listings/plugin/assets/icon-512.png does not match its recorded SHA-256',
    ]);
  });

  it('reach every host from icons.value and icons.files', () => {
    const files = generate(inputs());
    const server = JSON.parse(files.get('server.json')!);
    expect(server.icons).toEqual([
      { src: `${ICON_URL}/icon-512.png`, mimeType: 'image/png', sizes: ['512x512'] },
      { src: `${ICON_URL}/icon-192.png`, mimeType: 'image/png', sizes: ['192x192'] },
    ]);
    const ui = JSON.parse(files.get('listings/plugin/plugin.json')!).extensions['com.openai'].interface;
    expect([ui.logo, ui.composerIcon]).toEqual(['./assets/icon-512.png', './assets/icon-192.png']);
    expect(JSON.parse(files.get('listings/claude-connector.json')!).icon).toBe(
      'listings/plugin/assets/icon-512.png',
    );
    expect(files.get('listings/docker/server.yaml')).toContain(`  icon: ${ICON_URL}/icon-512.png\n`);
  });

  it('refuses icon URLs, sizes or host fields that drift from the committed files', () => {
    const wrongUrl = inputs();
    wrongUrl.listing.icons.value[0].src = 'https://cdn.example.com/icon-512.png';
    expect(check(wrongUrl).errors).toContain(`icons.value[0].src must be ${ICON_URL}/icon-512.png`);
    const wrongSize = inputs();
    wrongSize.listing.icons.value[1].sizes = ['512x512'];
    expect(check(wrongSize).errors).toContain('icons.value[1] must be image/png with sizes ["192x192"]');
    const tooSmall = inputs();
    tooSmall.listing.icons.files[1].size = 32;
    tooSmall.listing.icons.value[1].sizes = ['32x32'];
    expect(check(tooSmall).errors).toContain('icons.files[1] must be at least 48x48');
    const unsourced = inputs();
    delete unsourced.listing.icons.source.commit;
    expect(check(unsourced).errors).toContain(
      'icons.source must name the Sess commit and the icons.json version the icons come from',
    );
    const i = inputs();
    let files = edit(generate(i), 'server.json', (s) => {
      s.icons.pop();
    });
    files = edit(files, 'listings/plugin/plugin.json', (p) => {
      delete p.extensions['com.openai'].interface.logo;
    });
    files = edit(files, 'listings/claude-connector.json', (c) => {
      c.icon = 'listings/plugin/assets/other.png';
    });
    const { errors } = check(i, files);
    expect(errors).toContain('server.json icons drift from listing.json icons.value');
    expect(errors).toContain('plugin.json interface.logo and composerIcon must name the committed icons');
    expect(errors).toContain('claude-connector.json icon must name the primary icon');
  });
});

describe('directory packets', () => {
  it('Docker: a remote server with OAuth, the production URL, the icon URL and dynamic tools', () => {
    const files = generate(inputs());
    expect(files.get('listings/docker/server.yaml')).toBe(
      [
        'name: sess',
        'type: remote',
        'dynamic:',
        '  tools: true',
        'meta:',
        '  category: productivity',
        '  tags:',
        '    - productivity',
        '    - human-in-the-loop',
        '    - forms',
        '    - approvals',
        '    - remote',
        'about:',
        '  title: Sess',
        '  description: Ask a person a question and continue with their verified answer.',
        '  icon: https://sess.si/assets/icons/24eb73d4a4d9/icon-512.png',
        'remote:',
        '  transport_type: streamable-http',
        '  url: https://mcp.sess.si/mcp',
        'oauth:',
        '  - provider: sess',
        '    secret: sess.personal_access_token',
        '    env: SESS_PERSONAL_ACCESS_TOKEN',
        '',
      ].join('\n'),
    );
    expect(files.get('listings/docker/tools.json')).toBe('[]\n');
    expect(files.get('listings/docker/readme.md')).toBe('Docs: https://docs.sess.si/add-to-your-agent/\n');
    // A value that would need YAML quoting is refused, never written half-quoted.
    const colon = inputs();
    colon.listing.copy.registry = 'Sess: ask a person';
    expect(() => generate(colon)).toThrow(/needs quoting/);
  });

  it('LISTINGS.md quotes listing.json’s current copy, URLs and icons', () => {
    const listing = inputs().listing;
    expect(checkPackets(listing, read('LISTINGS.md'))).toEqual([]);
    const changed = inputs().listing;
    changed.copy.registry = 'Another registry description.';
    expect(checkPackets(changed, read('LISTINGS.md'))).toEqual([
      'LISTINGS.md owner submission steps do not quote listing.json\'s "Another registry description."',
    ]);
  });
});
