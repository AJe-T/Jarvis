import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import type { EventPayload, McpServerInput, McpServerView } from '@shared/ipc-contract';
import type { Tier } from '@shared/types';
import type { McpRepo, McpServerRecord } from '../db/repos/mcp-repo';
import { JarvisError, errorMessage } from '../errors';
import { sha256 } from '../lib/util';
import type { Logger } from '../logging/logger';
import { redact } from '../security/redact';
import { defineTool, type Tool, type ToolContent, type ToolOutput } from '../tools/types';

type Status = McpServerView['status'];

interface McpToolInfo {
  name: string;
  description?: string | undefined;
  inputSchema: Record<string, unknown>;
  annotations?:
    { readOnlyHint?: boolean | undefined; destructiveHint?: boolean | undefined } | undefined;
}

interface Conn {
  record: McpServerRecord;
  client: Client | null;
  status: Status;
  error?: string | undefined;
  tools: McpToolInfo[];
  retries: number;
  retryTimer?: ReturnType<typeof setTimeout> | undefined;
  closing: boolean;
  stderrTail: string[];
}

export interface McpManagerDeps {
  repo: McpRepo;
  secret(name: string): string | undefined;
  allowedRoots(): string[];
  userData: string;
  appVersion: string;
  emit(event: 'mcp:status', payload: EventPayload<'mcp:status'>): void;
  logger: Logger;
  callTimeoutMs?: number;
  /** Extra env for stdio servers (tests only). */
  extraEnv?: Record<string, string>;
}

const MAX_RETRIES = 5;
const NAME_LIMIT = 64;

/** API-Guide.md §8: `mcp__<server>__<tool>`, ≤ 64 chars (truncated + hash suffix when longer). */
export function namespacedName(server: string, tool: string): string {
  const full = `mcp__${server}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (full.length <= NAME_LIMIT) return full;
  const hash = sha256(full).slice(0, 6);
  return `${full.slice(0, NAME_LIMIT - 7)}_${hash}`;
}

const URL_KEYS = /^(url|uri|href|link|website|endpoint)$/i;

/** Every string an MCP tool receives goes through the content guard; URL-ish fields through the URL guard. */
function guardsFor(input: unknown): {
  urls: Array<{ url: string; allowPrivate: boolean }>;
  text: string[];
} {
  const urls: Array<{ url: string; allowPrivate: boolean }> = [];
  const text: string[] = [];
  const walk = (v: unknown, key: string): void => {
    if (typeof v === 'string') {
      if (URL_KEYS.test(key)) urls.push({ url: v, allowPrivate: true });
      else text.push(v);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(input, '');
  return { urls, text };
}

function mapContent(server: string, items: unknown[]): ToolContent[] {
  const out: ToolContent[] = [];
  for (const raw of items) {
    const c = raw as {
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
      uri?: string;
      resource?: { text?: string; uri?: string };
    };
    if (c.type === 'text' && typeof c.text === 'string') out.push({ type: 'text', text: c.text });
    else if (
      c.type === 'image' &&
      c.data &&
      (c.mimeType === 'image/png' || c.mimeType === 'image/jpeg')
    )
      out.push({ type: 'image', source: { type: 'base64', media_type: c.mimeType, data: c.data } });
    else if (c.type === 'resource')
      out.push({ type: 'text', text: c.resource?.text ?? `[resource ${c.resource?.uri ?? ''}]` });
    else if (c.type === 'resource_link') out.push({ type: 'text', text: `[link ${c.uri ?? ''}]` });
    else out.push({ type: 'text', text: `[${server} returned ${c.type} content]` });
  }
  return out.length ? out : [{ type: 'text', text: '(no content)' }];
}

/** MCP client manager: spawn/connect, list tools, call them, report status, reconnect with backoff. */
export function createMcpManager(d: McpManagerDeps) {
  const log = d.logger.child({ module: 'mcp' });
  const conns = new Map<string, Conn>();

  function publish(c: Conn): void {
    d.emit('mcp:status', {
      server: c.record.name,
      status: c.status,
      ...(c.status === 'ready' ? { toolCount: c.tools.length } : {}),
      ...(c.error ? { error: c.error } : {}),
    });
  }

  function expandArgs(args: string[]): string[] {
    return args.flatMap((a) => {
      if (a === '{allowedRoots}') return d.allowedRoots();
      return [a.replace('{browserProfile}', join(d.userData, 'browser-profile'))];
    });
  }

  function secretOrThrow(name: string): string {
    const v = d.secret(name);
    if (!v)
      throw new JarvisError(
        'INVALID',
        `missing secret ${name}`,
        `Add the secret "${name}" for this connection first.`,
      );
    return v;
  }

  function transportFor(c: Conn) {
    const r = c.record;
    if (r.transport === 'http') {
      if (!r.url) throw new JarvisError('INVALID', 'no url', 'This connection has no URL.');
      const headers: Record<string, string> = r.authSecret
        ? { Authorization: `Bearer ${secretOrThrow(r.authSecret)}` }
        : {};
      return new StreamableHTTPClientTransport(new URL(r.url), { requestInit: { headers } });
    }
    if (!r.command)
      throw new JarvisError('INVALID', 'no command', 'This connection has no command.');
    // Security.md §10: only the env vars this server needs; never the Anthropic key.
    const env: Record<string, string> = { ...(d.extraEnv ?? {}) };
    for (const [envVar, secretName] of Object.entries(r.envSecrets))
      env[envVar] = secretOrThrow(secretName);
    const t = new StdioClientTransport({
      command: r.command,
      args: expandArgs(r.args),
      env,
      stderr: 'pipe',
    });
    t.stderr?.on('data', (chunk: Buffer) => {
      c.stderrTail.push(...redact(chunk.toString('utf8')).split(/\r?\n/).filter(Boolean));
      c.stderrTail.splice(0, Math.max(0, c.stderrTail.length - 20));
    });
    return t;
  }

  async function connect(c: Conn): Promise<void> {
    if (!c.record.enabled) {
      c.status = 'disabled';
      publish(c);
      return;
    }
    c.status = 'connecting';
    c.error = undefined;
    c.closing = false;
    publish(c);
    try {
      const transport = transportFor(c);
      const client = new Client({ name: 'jarvis', version: d.appVersion });
      client.onclose = () => {
        if (c.closing || c.client !== client) return;
        c.client = null;
        c.tools = [];
        c.status = 'error';
        c.error = `The ${c.record.name} server stopped.${c.stderrTail.length ? ` ${c.stderrTail.slice(-2).join(' ')}` : ''}`;
        publish(c);
        scheduleReconnect(c);
      };
      // The SDK's own transport classes don't satisfy its Transport type under exactOptionalPropertyTypes.
      await client.connect(transport as unknown as Transport, { timeout: 60_000 });
      const { tools } = await client.listTools(undefined, { timeout: 30_000 });
      c.client = client;
      c.tools = tools;
      c.status = 'ready';
      c.retries = 0;
      publish(c);
      log.info({ server: c.record.name, tools: c.tools.length }, 'mcp server ready');
    } catch (err) {
      c.status = 'error';
      c.error =
        err instanceof JarvisError && err.userMessage
          ? err.userMessage
          : `${errorMessage(err)}${c.stderrTail.length ? ` — ${c.stderrTail.slice(-2).join(' ')}` : ''}`;
      c.client = null;
      publish(c);
      log.warn({ server: c.record.name, err: c.error }, 'mcp connect failed');
      if (!(err instanceof JarvisError)) scheduleReconnect(c);
    }
  }

  /** 1 s → 2 → 4 → 8 → 16 (≤ 30 s), max 5 tries, then stay in error until Sir retries. */
  function scheduleReconnect(c: Conn): void {
    if (c.closing || c.retries >= MAX_RETRIES) return;
    const delay = Math.min(30_000, 1000 * 2 ** c.retries);
    c.retries++;
    clearTimeout(c.retryTimer);
    c.retryTimer = setTimeout(() => void connect(c), delay);
  }

  async function disconnect(c: Conn): Promise<void> {
    c.closing = true;
    clearTimeout(c.retryTimer);
    const client = c.client;
    c.client = null;
    c.tools = [];
    // App-flow.md §13: closing the client sends SIGTERM to stdio servers; kill after 3 s if needed.
    await Promise.race([
      client?.close().catch(() => undefined),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  }

  function tierFor(c: Conn, tool: string): Tier {
    return c.record.toolOverrides[tool] ?? c.record.defaultTier;
  }

  function toTool(c: Conn, info: McpToolInfo): Tool {
    const server = c.record.name;
    const timeoutMs = d.callTimeoutMs ?? 60_000;
    return defineTool<Record<string, unknown>>({
      name: namespacedName(server, info.name),
      description: `[${server}] ${(info.description ?? info.name).slice(0, 900)}`,
      input: z.record(z.string(), z.unknown()),
      jsonSchema: info.inputSchema,
      source: 'mcp',
      tier: tierFor(c, info.name),
      destructive: info.annotations?.destructiveHint === true,
      untrustedOutput: true,
      externalFacing: tierFor(c, info.name) !== 'SAFE',
      timeoutMs: timeoutMs + 1000,
      summarize: (input) => {
        const hint = ['url', 'query', 'path', 'name', 'title', 'element', 'owner', 'repo']
          .map((k) => input[k])
          .find((v) => typeof v === 'string');
        return `${server}: ${info.name.replace(/_/g, ' ')}${hint ? ` (${String(hint).slice(0, 60)})` : ''}`;
      },
      confirm: (input) => ({
        details: JSON.stringify(input, null, 2).slice(0, 4000),
        detailsKind: 'code',
      }),
      guards: (input) => guardsFor(input),
      async run(input, ctx): Promise<ToolOutput> {
        if (!c.client || c.status !== 'ready')
          return {
            content: [
              {
                type: 'text',
                text: `The ${server} connection is not ready (${c.error ?? c.status}).`,
              },
            ],
            isError: true,
          };
        try {
          const res = await c.client.callTool({ name: info.name, arguments: input }, undefined, {
            timeout: timeoutMs,
            signal: ctx.signal,
          });
          const content = Array.isArray(res.content) ? (res.content as unknown[]) : [];
          return {
            content: mapContent(server, content),
            isError: res.isError === true,
            untrustedSource: `mcp:${server}/${info.name}`,
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `${server} failed: ${errorMessage(err)}` }],
            isError: true,
          };
        }
      },
    });
  }

  /** Claude-Desktop-compatible export (secret references only, never values). */
  function writeMcpJson(): void {
    const mcpServers: Record<string, unknown> = {};
    for (const r of d.repo.all()) {
      mcpServers[r.name] = {
        ...(r.transport === 'stdio' ? { command: r.command, args: r.args } : { url: r.url }),
        ...(Object.keys(r.envSecrets).length
          ? {
              env: Object.fromEntries(
                Object.entries(r.envSecrets).map(([k, v]) => [k, `secret:${v}`]),
              ),
            }
          : {}),
        jarvis: {
          trust: r.trustLevel,
          defaultTier: r.defaultTier,
          toolOverrides: r.toolOverrides,
          enabled: r.enabled,
          ...(r.authSecret ? { authSecret: `secret:${r.authSecret}` } : {}),
        },
      };
    }
    try {
      mkdirSync(d.userData, { recursive: true });
      writeFileSync(join(d.userData, 'mcp.json'), JSON.stringify({ mcpServers }, null, 2));
    } catch (err) {
      log.warn({ err: errorMessage(err) }, 'could not write mcp.json');
    }
  }

  function conn(id: string): Conn {
    const c = conns.get(id);
    if (!c)
      throw new JarvisError('NOT_FOUND', 'no such server', 'That connection no longer exists.');
    return c;
  }

  function view(c: Conn): McpServerView {
    return {
      ...c.record,
      status: c.status,
      ...(c.error ? { error: c.error } : {}),
      tools: c.tools.map((t) => ({
        name: t.name,
        description: (t.description ?? '').slice(0, 300),
        tier: tierFor(c, t.name),
      })),
    };
  }

  return {
    async start(): Promise<void> {
      for (const record of d.repo.all())
        conns.set(record.id, {
          record,
          client: null,
          status: 'disabled',
          tools: [],
          retries: 0,
          closing: false,
          stderrTail: [],
        });
      await Promise.all([...conns.values()].map((c) => connect(c)));
    },

    tools(): Tool[] {
      return [...conns.values()]
        .filter((c) => c.status === 'ready')
        .flatMap((c) => c.tools.map((t) => toTool(c, t)));
    },

    list(): McpServerView[] {
      return [...conns.values()].map(view).sort((a, b) => a.name.localeCompare(b.name));
    },

    integrationsSummary(): string {
      return [...conns.values()]
        .filter((c) => c.record.enabled)
        .map(
          (c) =>
            `${c.record.name} (${c.status === 'ready' ? `${c.tools.length} tools` : c.status})`,
        )
        .join(', ');
    },

    async add(input: McpServerInput): Promise<McpServerView> {
      if (d.repo.byName(input.name))
        throw new JarvisError(
          'INVALID',
          'duplicate',
          `A connection called "${input.name}" already exists.`,
        );
      const record = d.repo.insert(input);
      const c: Conn = {
        record,
        client: null,
        status: 'disabled',
        tools: [],
        retries: 0,
        closing: false,
        stderrTail: [],
      };
      conns.set(record.id, c);
      writeMcpJson();
      await connect(c);
      return view(c);
    },

    async update(
      id: string,
      patch: { [K in keyof McpServerInput]?: McpServerInput[K] | undefined },
    ): Promise<void> {
      const c = conn(id);
      const defined = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      ) as Partial<McpServerInput>;
      const merged = { ...c.record, ...defined };
      const { id: _id, ...input } = merged;
      await disconnect(c);
      c.record = d.repo.update(id, input);
      c.retries = 0;
      writeMcpJson();
      await connect(c);
    },

    async remove(id: string): Promise<void> {
      const c = conn(id);
      await disconnect(c);
      conns.delete(id);
      d.repo.remove(id);
      writeMcpJson();
      d.emit('mcp:status', { server: c.record.name, status: 'disabled' });
    },

    async restart(id: string): Promise<void> {
      const c = conn(id);
      await disconnect(c);
      c.retries = 0;
      c.stderrTail = [];
      await connect(c);
    },

    async shutdown(): Promise<void> {
      await Promise.all([...conns.values()].map((c) => disconnect(c)));
    },

    find: (name: string) => [...conns.values()].find((c) => c.record.name === name),
  };
}

export type McpManager = ReturnType<typeof createMcpManager>;
