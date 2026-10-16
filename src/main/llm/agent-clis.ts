import { readFileSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, relative, resolve } from 'node:path';
import { AGENT_CLIS, type AgentCliDef, type AgentCliId } from '@shared/agent-clis';

export interface AgentCliStatus {
  id: AgentCliId;
  label: string;
  vendor: string;
  use: AgentCliDef['use'];
  installed: boolean;
  path: string | null;
  /** From the npm package's package.json; null when not installed with npm (nothing is run). */
  version: string | null;
  install: string;
  docsUrl: string;
  note: string | null;
}

interface DetectDeps {
  env?: NodeJS.ProcessEnv;
  exists?: (p: string) => boolean;
  readFile?: (p: string) => string;
  /** Paths Jarvis's own finders already resolved (Claude Code, Codex, Antigravity). */
  known?: Partial<Record<AgentCliId, string | null>>;
}

const EXTS = ['.exe', '.cmd'];

/** A real file (a folder named "claude.exe" doesn't count). */
const isFile = (p: string): boolean => statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
const VERSION_RE = /^\d+\.\d+\.\d+[0-9A-Za-z.+-]{0,40}$/;

/** First match of the def's commands in its documented folders, then on PATH. */
export function findAgentCli(
  def: AgentCliDef,
  env: NodeJS.ProcessEnv,
  exists: (p: string) => boolean,
): string | null {
  const folders = (def.folders ?? []).flatMap(([v, sub]) => (env[v] ? [join(env[v], sub)] : []));
  const path = (env['PATH'] ?? env['Path'] ?? '')
    .split(delimiter)
    .map((d) => d.replaceAll('"', '').trim())
    .filter(Boolean);
  for (const dir of [...folders, ...path])
    for (const cmd of def.commands)
      for (const ext of EXTS) {
        const p = join(dir, cmd + ext);
        if (exists(p)) return p;
      }
  return null;
}

/** Version of an npm-installed CLI, read from %APPDATA%\npm\node_modules\<pkg>\package.json. */
export function npmVersion(
  def: AgentCliDef,
  found: string,
  env: NodeJS.ProcessEnv,
  readFile: (p: string) => string,
): string | null {
  const appData = env['APPDATA'];
  if (!def.npmPackage || !appData) return null;
  const npmDir = join(appData, 'npm');
  // Only when this copy is the npm one: a native install elsewhere may be a different version.
  const rel = relative(npmDir.toLowerCase(), resolve(found).toLowerCase());
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  try {
    const pkg = JSON.parse(
      readFile(join(npmDir, 'node_modules', ...def.npmPackage.split('/'), 'package.json')),
    ) as { version?: unknown };
    return typeof pkg.version === 'string' && VERSION_RE.test(pkg.version) ? pkg.version : null;
  } catch {
    return null;
  }
}

/** Which agent CLIs are on this PC. Looks for files only; runs nothing, reads no sign-in data. */
export function detectAgentClis(deps: DetectDeps = {}): AgentCliStatus[] {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? isFile;
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, 'utf8'));
  return AGENT_CLIS.map((def) => {
    const known = deps.known?.[def.id];
    const path = known ?? findAgentCli(def, env, exists);
    return {
      id: def.id,
      label: def.label,
      vendor: def.vendor,
      use: def.use,
      installed: path !== null,
      path,
      version: path ? npmVersion(def, path, env, readFile) : null,
      install: def.install,
      docsUrl: def.docsUrl,
      note: (def as AgentCliDef).note ?? null,
    };
  });
}
