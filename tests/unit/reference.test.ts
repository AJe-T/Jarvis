import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EVENT_CHANNELS, INVOKE_CHANNELS, SEND_CHANNELS } from '@shared/ipc-channels';
import { MAIN_ONLY_SETTINGS, SENSITIVE_SETTINGS, SETTINGS } from '@shared/settings';
import { KNOWN_SECRETS } from '@shared/types';
import { AGENT_CLIS } from '@shared/agent-clis';
import { CLOUD_PROVIDERS } from '@shared/llm-providers';
import { createResearchTool } from '@main/agent/research';
import { createAutomation } from '@main/automation/automation';
import { copilotTool, createCopilot } from '@main/copilot/copilot';
import { createMemorySystem } from '@main/memory/memory-system';
import { createComputerSystem } from '@main/tools/computer/computer-system';
import { createFakeDriver, createFakeScreen } from '@main/tools/computer/drivers';
import { setupServices } from '../integration/helpers';

/**
 * docs/REFERENCE.md is generated from the code (tools, settings, IPC, migrations) so the docs can't
 * drift. This test fails when it is stale; `npm run docs:reference` rewrites it.
 */
const ROOT = join(__dirname, '..', '..');
const OUT = join(ROOT, 'docs', 'REFERENCE.md');

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

function typeOf(schema: z.ZodType): string {
  const j = z.toJSONSchema(schema, { unrepresentable: 'any' }) as {
    type?: string;
    enum?: unknown[];
  };
  if (j.enum) return j.enum.map((v) => `\`${String(v)}\``).join(' / ');
  return j.type ?? 'object';
}

function buildReference(): string {
  const t = setupServices();
  const s = t.services;
  // The same composition as src/main/index.ts, with fakes for the screen.
  createMemorySystem(s);
  createAutomation(s);
  s.registry.register(createResearchTool(s));
  s.registry.register(copilotTool(createCopilot(s), () => undefined));
  createComputerSystem(s, {
    screen: createFakeScreen(),
    driver: async () => createFakeDriver(),
    overlay: { show: () => undefined, hide: () => undefined },
    mainWindow: { minimize: () => undefined, restore: () => undefined },
  });

  const tools = s.registry
    .all()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((tool) => {
      const tier = typeof tool.tier === 'function' ? 'depends on input' : tool.tier;
      const flags = [
        tool.destructive ? 'destructive' : '',
        tool.untrustedOutput ? 'untrusted output' : '',
        tool.externalFacing ? 'external' : '',
      ].filter(Boolean);
      return `| \`${tool.name}\` | ${tier}${flags.length ? ` (${flags.join(', ')})` : ''} | ${cell(tool.description)} |`;
    });

  const settings = Object.entries(SETTINGS).map(([key, def]) => {
    const d = (def as { default: unknown }).default;
    const shown =
      typeof d === 'string' ? d.split('\n')[0] + (d.includes('\n') ? ' …' : '') : JSON.stringify(d);
    const notes = [
      SENSITIVE_SETTINGS.includes(key as never) ? 'audited with value' : '',
      MAIN_ONLY_SETTINGS.includes(key as never) ? 'main-process only' : '',
    ].filter(Boolean);
    return `| \`${key}\` | ${cell(typeOf((def as { schema: z.ZodType }).schema))} | ${cell(`\`${shown.slice(0, 80)}\``)} | ${notes.join(', ')} |`;
  });

  const migrations = readdirSync(join(ROOT, 'src', 'main', 'db', 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => {
      const first =
        readFileSync(join(ROOT, 'src', 'main', 'db', 'migrations', f), 'utf8').split('\n')[0] ?? '';
      return `| \`${f}\` | ${cell(first.replace(/^--\s*/, ''))} |`;
    });

  const providers = CLOUD_PROVIDERS.map(
    (p) =>
      `| \`${p.id}\` | ${cell(p.label)} | ${p.category} | ${p.baseUrl} | ${p.models} | ${p.tools} | \`${p.secret}\` | ${p.checked} |`,
  );
  const agents = AGENT_CLIS.map(
    (a) =>
      `| \`${a.id}\` | ${cell(a.label)} (${cell(a.vendor)}) | ${a.commands.map((c) => `\`${c}\``).join(', ')} | ${a.use} | ${a.checked} |`,
  );

  return `# JARVIS Reference (generated)

> Generated from the code by \`npm run docs:reference\` (tests/unit/reference.test.ts fails when this file is stale). Do not edit by hand. The narrative guide is [BIBLE.md](BIBLE.md).

## Tools (${tools.length})

Every tool goes through the executor: Zod input check → policy tier (SAFE runs, CONFIRM asks Sir, BLOCKED never runs) → guards → audit and activity log. MCP tools from connected servers are added at runtime and are not listed here.

| Tool | Tier | What it does |
|---|---|---|
${tools.join('\n')}

## Settings (${settings.length})

Stored in the local database; changed in Settings. Secrets are separate (below).

| Key | Type | Default | Notes |
|---|---|---|---|
${settings.join('\n')}

## Secrets

Encrypted with Windows DPAPI (Electron safeStorage); the renderer only ever sees "set" and the last 4 characters: ${KNOWN_SECRETS.map((k) => `\`${k}\``).join(', ')} (MCP servers may add their own names).

## IPC channels

- **Invoke** (renderer → main, request/response, Zod-validated both ways, ${INVOKE_CHANNELS.length}): ${INVOKE_CHANNELS.map((c) => `\`${c}\``).join(', ')}
- **Events** (main → renderer, ${EVENT_CHANNELS.length}): ${EVENT_CHANNELS.map((c) => `\`${c}\``).join(', ')}
- **Send** (renderer → main, fire-and-forget): ${SEND_CHANNELS.map((c) => `\`${c}\``).join(', ')}

## AI providers and gateways (${providers.length})

Fixed HTTPS addresses (\`shared/llm-providers.ts\`), never typed by Sir. Models: \`openai\` = GET {base}/models, \`ollama\` = Ollama's /api/tags, \`manual\` = no documented list (Test sends one 1-token request). None is live-tested without Sir's key; the full status matrix is [Integrations.md](Integrations.md).

| Id | Provider | Kind | Address | Models | Tools | Secret | Docs checked |
|---|---|---|---|---|---|---|---|
${providers.join('\n')}

## Agent command-line apps (${agents.length})

Found by file name only (\`shared/agent-clis.ts\`); \`detected\` ones are not used by Jarvis yet.

| Id | App | Commands | Use | Docs checked |
|---|---|---|---|---|
${agents.join('\n')}

## Database migrations

| File | Purpose |
|---|---|
${migrations.join('\n')}
`;
}

describe('docs/REFERENCE.md', () => {
  it('matches the code', () => {
    const fresh = buildReference();
    if (process.env['DOCS_WRITE'] === '1') writeFileSync(OUT, fresh);
    let current = '';
    try {
      current = readFileSync(OUT, 'utf8');
    } catch {
      // missing: fails below
    }
    expect(current, 'docs/REFERENCE.md is stale: run `npm run docs:reference`').toBe(fresh);
  });
});
