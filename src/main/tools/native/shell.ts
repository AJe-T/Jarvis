import { z } from 'zod';
import { defineTool, ok, type Tool } from '../types';
import type { OsAdapter } from './os';

/** Agents.md §B1 tool description guidance; Security.md §5.2 (CONFIRM always + shell guard). */
export function createShellTool(osa: OsAdapter): Tool {
  return defineTool({
    name: 'run_powershell',
    description:
      "Run a short PowerShell script on sir's PC as a standard user. Always requires sir's approval. Use only when no specific tool can do the job. Never use for deleting files, changing system/security settings, installing software, or downloading and running anything. Explain the purpose in the `purpose` field.",
    input: z.object({ script: z.string().min(1).max(10_000), purpose: z.string().min(3).max(300) }),
    tier: 'CONFIRM',
    untrustedOutput: true,
    timeoutMs: 31_000,
    summarize: ({ purpose }) => `Run PowerShell: ${purpose}`,
    confirm: ({ script, purpose }) => ({
      title: 'Run this PowerShell script?',
      actionLabel: 'Run script',
      purpose,
      details: script,
      detailsKind: 'code',
    }),
    guards: ({ script }) => ({ script }),
    async run({ script }, ctx) {
      const r = await osa.ps(script, { timeoutMs: 30_000, signal: ctx.signal });
      const parts = [`Exit code ${r.exitCode}`];
      if (r.stdout) parts.push(`Output:\n${r.stdout}`);
      if (r.stderr) parts.push(`Errors:\n${r.stderr}`);
      return {
        ...ok(parts.join('\n\n')),
        isError: r.exitCode !== 0,
        untrustedSource: 'powershell output',
      };
    },
  });
}
