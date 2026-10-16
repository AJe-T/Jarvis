import { homedir } from 'node:os';
import { newId } from '../lib/util';
import { checkShellScript } from '../security/shell-guard';
import type { PsOptions, PsResult } from '../tools/powershell';

/**
 * ADR-032 Jarvis Terminal: a light PowerShell console in its own window. Sir types commands; what
 * Jarvis runs through run_powershell (after Sir approves it) shows up here too. Every command is
 * checked by the shell guard first (Security.md §5.2), runs as the standard user with a time limit,
 * and starts in the folder the last one ended in, so `cd` works across commands.
 */

export interface TermEntry {
  id: string;
  by: 'you' | 'jarvis';
  command: string;
  output: string;
  exitCode: number | null;
  cwd: string;
  at: string;
  ms: number;
}

const CWD_MARK = '<<JARVIS_CWD>>';
const MAX_ENTRIES = 200;
const RUN_TIMEOUT_MS = 60_000;

/** Splits the folder the command ended in off its output (the marker line Jarvis appends). */
export function splitCwd(stdout: string): { output: string; cwd: string | null } {
  const lines = stdout.replace(/\r\n/g, '\n').split('\n');
  const i = lines.findLastIndex((l) => l.startsWith(CWD_MARK));
  if (i < 0) return { output: stdout.trimEnd(), cwd: null };
  const cwd = lines[i]?.slice(CWD_MARK.length).trim() || null;
  lines.splice(i, 1);
  return { output: lines.join('\n').trimEnd(), cwd };
}

export function createTerminal(deps: {
  ps(script: string, opts?: PsOptions): Promise<PsResult>;
  audit?(command: string): void;
  home?: string;
}) {
  const entries: TermEntry[] = [];
  let cwd = deps.home ?? homedir();
  let running: AbortController | null = null;
  const listeners = new Set<(e: TermEntry) => void>();

  function add(e: TermEntry): TermEntry {
    entries.push(e);
    entries.splice(0, Math.max(0, entries.length - MAX_ENTRIES));
    for (const l of listeners) l(e);
    return e;
  }

  return {
    async run(command: string): Promise<TermEntry> {
      const at = new Date();
      const base = { id: newId('term_'), by: 'you' as const, command, cwd, at: at.toISOString() };
      const verdict = checkShellScript(command);
      if (verdict.blocked)
        return add({
          ...base,
          output: `Blocked by Jarvis's safety rules: ${verdict.reasons.join('; ')}.`,
          exitCode: null,
          ms: 0,
        });
      deps.audit?.(command);
      running?.abort();
      const controller = new AbortController();
      running = controller;
      try {
        const r = await deps.ps(
          `Set-Location -LiteralPath $P.cwd\n${command}\n"${CWD_MARK}$((Get-Location).Path)"`,
          { params: { cwd }, timeoutMs: RUN_TIMEOUT_MS, signal: controller.signal },
        );
        const { output, cwd: next } = splitCwd(r.stdout);
        if (next) cwd = next;
        const text = [output, r.stderr.trim()].filter(Boolean).join('\n');
        return add({ ...base, output: text, exitCode: r.exitCode, ms: Date.now() - at.getTime() });
      } catch (err) {
        const why = controller.signal.aborted ? 'Stopped.' : String(err);
        return add({ ...base, output: why, exitCode: null, ms: Date.now() - at.getTime() });
      } finally {
        if (running === controller) running = null;
      }
    },
    /** Stops the command that is running, if any. */
    stop(): void {
      running?.abort();
    },
    /** A script Jarvis ran with run_powershell (already approved by Sir). */
    record(command: string, r: PsResult, ms: number): void {
      add({
        id: newId('term_'),
        by: 'jarvis',
        command,
        output: [r.stdout.trimEnd(), r.stderr.trim()].filter(Boolean).join('\n'),
        exitCode: r.exitCode,
        cwd: '',
        at: new Date().toISOString(),
        ms,
      });
    },
    history: (): TermEntry[] => [...entries],
    clear(): void {
      entries.length = 0;
    },
    cwd: (): string => cwd,
    /** Every new entry (the Terminal window shows Jarvis's runs as they happen). */
    onEntry(l: (e: TermEntry) => void): () => void {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export type Terminal = ReturnType<typeof createTerminal>;
