import { z } from 'zod';
import { SECRET_NAME_RE } from '@shared/types';
import type { Res } from '@shared/ipc-contract';
import { JarvisError } from '../errors';

/**
 * The official MCP Registry (registry.modelcontextprotocol.io): thousands of servers in one
 * searchable list. Main fetches it (the renderer has no network), keeps only what Jarvis can run
 * safely without a shell (an npm package over stdio, or an HTTPS endpoint with at most a Bearer
 * token), and turns each into a ready McpServerInput: community trust, every tool CONFIRM.
 * Registry text is untrusted: it is length-capped here and only ever rendered as text.
 */
export const REGISTRY_URL = 'https://registry.modelcontextprotocol.io/v0/servers';
const PAGE_SIZE = 30;
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;

type Page = Res<'mcp:registrySearch'>;
export type RegistryEntry = Page['entries'][number];

const Named = z.object({
  name: z.string().max(200),
  description: z.string().max(4000).optional(),
  value: z.string().max(500).optional(),
  isRequired: z.boolean().optional(),
});
const Arg = z.object({ isRequired: z.boolean().optional() });
const PackageSchema = z.object({
  registryType: z.string().max(40),
  identifier: z.string().max(214),
  version: z.string().max(60).optional(),
  transport: z.object({ type: z.string().max(40) }).optional(),
  environmentVariables: z.array(Named).max(100).optional(),
  packageArguments: z.array(Arg).max(100).optional(),
  runtimeArguments: z.array(Arg).max(100).optional(),
});
const RemoteSchema = z.object({
  type: z.string().max(40),
  url: z.string().max(500),
  headers: z.array(Named).max(50).optional(),
});
const ServerSchema = z.object({
  name: z.string().max(200),
  description: z.string().max(4000).optional(),
  version: z.string().max(60),
  repository: z.object({ url: z.string().max(500).optional() }).optional(),
  packages: z.array(PackageSchema).max(20).optional(),
  remotes: z.array(RemoteSchema).max(20).optional(),
});
type Server = z.infer<typeof ServerSchema>;
const ResponseSchema = z.object({
  // Entries are checked one by one below, so a single odd entry can't hide a whole page.
  servers: z.array(z.object({ server: z.unknown() })).max(200),
  metadata: z.object({ nextCursor: z.string().max(300).optional() }).optional(),
});

const NPM_ID = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]{1,60}$/;
/** Env vars that change how node/npx/cmd themselves run: never set from a registry entry. */
const RESERVED_ENV =
  /^(PATH|PATHEXT|COMSPEC|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|LD_PRELOAD|SYSTEMROOT|WINDIR|APPDATA|USERPROFILE|HOME|TEMP|TMP|NPM_CONFIG_.*|ELECTRON_.*)$/;
/** Registry secrets live under their own prefix, so no entry can name Sir's existing keys. */
export const REGISTRY_SECRET_PREFIX = 'reg_';
const BEARER = /^Bearer \{[^}]+\}$/i;

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** "io.github.someone/Brave-Search" → "brave-search": a valid connection name (tool prefix). */
export function slugFor(registryName: string): string {
  const last = registryName.split('/').pop() ?? registryName;
  const slug = last
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 31)
    .replace(/[-_]+$/, '');
  return slug.length >= 2 ? slug : `mcp-${slug || 'server'}`;
}

function secretNameFor(slug: string, suffix: string): string {
  const name = `${REGISTRY_SECRET_PREFIX}${slug}_${suffix}`
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .slice(0, 40);
  return SECRET_NAME_RE.test(name) ? name : 'mcp_secret';
}

const base = {
  args: [] as string[],
  envSecrets: {} as Record<string, string>,
  trustLevel: 'community' as const,
  defaultTier: 'CONFIRM' as const,
  toolOverrides: {},
  enabled: true,
};

/** Loopback, private, link-local and single-label hosts: a registry entry may not point the token there. */
export function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h.includes('.') || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local'))
    return true;
  if (h.includes(':')) return true; // IPv6 literal: never a public MCP host in practice
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

/** Reads a body but gives up past MAX_BYTES, so a huge response is never fully buffered. */
async function readCapped(res: Response): Promise<string> {
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('too large');
  if (!res.body) return '';
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new Error('too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function fromRemote(
  slug: string,
  r: z.infer<typeof RemoteSchema>,
): Pick<RegistryEntry, 'kind' | 'secrets' | 'server'> | null {
  if (r.type !== 'streamable-http' || r.url.includes('{')) return null;
  let url: URL;
  try {
    url = new URL(r.url);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || isPrivateHost(url.hostname))
    return null;
  const headers = r.headers ?? [];
  const auth = headers.find((h) => h.name.toLowerCase() === 'authorization');
  // Any other required header (API keys under custom names, project ids…) isn't supported here.
  if (headers.some((h) => h !== auth && h.isRequired)) return null;
  if (auth?.value && !BEARER.test(auth.value)) return null;
  const secret = auth ? secretNameFor(slug, 'token') : null;
  return {
    kind: 'remote',
    secrets: secret
      ? [
          {
            name: secret,
            label: 'Access token',
            help: clip(auth?.description ?? 'Sent as "Authorization: Bearer <token>".', 200),
          },
        ]
      : [],
    server: {
      ...base,
      name: slug,
      transport: 'http',
      url: url.toString(),
      ...(secret ? { authSecret: secret } : {}),
    },
  };
}

function fromPackage(
  slug: string,
  serverVersion: string,
  p: z.infer<typeof PackageSchema>,
): Pick<RegistryEntry, 'kind' | 'secrets' | 'server'> | null {
  const version = p.version ?? serverVersion;
  if (p.registryType !== 'npm' || (p.transport?.type ?? 'stdio') !== 'stdio') return null;
  // npx runs through cmd.exe on Windows: only plain package names and exact versions get through.
  if (!NPM_ID.test(p.identifier) || !SEMVER.test(version)) return null;
  if ([...(p.packageArguments ?? []), ...(p.runtimeArguments ?? [])].some((a) => a.isRequired))
    return null;
  const required = (p.environmentVariables ?? []).filter((e) => e.isRequired);
  if (required.some((e) => !ENV_NAME.test(e.name) || RESERVED_ENV.test(e.name))) return null;
  const secrets = required.map((e) => ({
    name: secretNameFor(slug, e.name),
    label: e.name,
    help: clip(e.description ?? '', 200),
  }));
  return {
    kind: 'npm',
    secrets,
    server: {
      ...base,
      name: slug,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', `${p.identifier}@${version}`],
      envSecrets: Object.fromEntries(required.map((e, i) => [e.name, secrets[i]?.name ?? ''])),
    },
  };
}

/** One registry server → an installable entry, or null when Jarvis can't run it as-is. */
export function toEntry(s: Server): RegistryEntry | null {
  const slug = slugFor(s.name);
  const install =
    (s.remotes ?? []).map((r) => fromRemote(slug, r)).find((x) => x !== null) ??
    (s.packages ?? []).map((p) => fromPackage(slug, s.version, p)).find((x) => x !== null);
  if (!install) return null;
  const repo = s.repository?.url;
  return {
    id: `${s.name}@${s.version}`,
    name: clip(s.name, 200),
    description: clip(s.description ?? '', 300),
    version: s.version,
    ...(repo?.startsWith('https://') ? { repository: repo } : {}),
    ...install,
  };
}

export async function searchRegistry(
  req: { query: string; cursor?: string | undefined },
  fetchImpl: typeof fetch = fetch,
): Promise<Page> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), version: 'latest' });
  if (req.query) params.set('search', req.query);
  if (req.cursor) params.set('cursor', req.cursor);
  let text: string;
  try {
    const res = await fetchImpl(`${REGISTRY_URL}?${params.toString()}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await readCapped(res);
  } catch (err) {
    throw new JarvisError(
      'TOOL_FAILED',
      `registry: ${err instanceof Error ? err.message : String(err)}`,
      "Couldn't reach the MCP Registry. Check your connection and try again.",
      { cause: err },
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const parsed = ResponseSchema.safeParse(json);
  if (!parsed.success)
    throw new JarvisError(
      'INVALID',
      'registry shape',
      'The MCP Registry sent something unexpected.',
    );
  const entries: RegistryEntry[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const { server } of parsed.data.servers) {
    const s = ServerSchema.safeParse(server);
    const entry = s.success ? toEntry(s.data) : null;
    if (!entry || seen.has(entry.id)) {
      skipped++;
      continue;
    }
    seen.add(entry.id);
    entries.push(entry);
  }
  const next = parsed.data.metadata?.nextCursor;
  return { entries, skipped, ...(next ? { nextCursor: next } : {}) };
}
