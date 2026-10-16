import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * ADR-031: REA ("Reverse Engineer Anything", github.com/morluto/rea, MIT) is an MCP server that lets
 * an agent inspect an app without its source: Electron/JS bundles, .NET, native binaries, websites.
 * When Sir asks to build "a feature like the one in X", the Claude Code session Jarvis starts gets REA
 * attached for that session only, and is told to study X first, then build its own version.
 * Nothing of REA is bundled: npx fetches the pinned version on first use.
 */

export const REA_PACKAGE = 'rea-agents@6.4.0';

/** REA's engines field: Node 22.19+ on 22, 24.11+ on 24, or 26 and later. */
export function nodeRunsRea(version: string): boolean {
  const m = /^v?(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return false;
  const [major, minor] = [Number(m[1]), Number(m[2])];
  return (major === 22 && minor >= 19) || (major === 24 && minor >= 11) || major >= 26;
}

export function reaMcpConfig(): { mcpServers: Record<string, unknown> } {
  return {
    mcpServers: {
      rea: {
        command: 'npx',
        args: ['-y', REA_PACKAGE, 'mcp'],
        // The compact schema profile roughly halves the tool list Claude Code has to carry.
        env: { REA_MCP_INPUT_SCHEMA_PROFILE: 'compact' },
      },
    },
  };
}

/** Writes the session's MCP config and returns its path (handed to `claude --mcp-config`). */
export async function writeReaConfig(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'rea-mcp.json');
  await writeFile(path, JSON.stringify(reaMcpConfig(), null, 2), 'utf8');
  return path;
}

export function reaBrief(app: string, brief: string): string {
  return `First study how ${app} does this, using the REA tools (the "rea" MCP server): inspect it without its source code, show me the evidence for how the feature works and what you could not confirm. Then build our own version from that understanding. Do not copy its code, assets or text.\n\n${brief}`;
}

/** `node --version` of the Node on PATH (what npx will use), or null when there is none. */
export function systemNodeVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('node', ['--version'], { windowsHide: true, timeout: 5_000 }, (err, stdout) =>
      resolve(err ? null : stdout.trim()),
    );
  });
}
