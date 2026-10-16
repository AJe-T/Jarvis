import type { PathGuard } from '../../security/path-guard';
import type { Scheduler } from '../../scheduler/scheduler';
import type { Tool } from '../types';
import type { AppIndex } from './app-index';
import { createAppTools } from './apps';
import { createDocumentTool } from './documents';
import { createFileTools } from './files';
import { createMiscTools } from './misc';
import type { OsAdapter } from './os';
import { createShellTool } from './shell';
import { createSystemTools } from './system';
import { createUiAutomationTools } from './ui-automation';

export interface NativeToolDeps {
  os: OsAdapter;
  appIndex: AppIndex;
  guard: PathGuard;
  scheduler: Scheduler;
  roots(): string[];
  protectedPaths(): string[];
  /** Jarvis Terminal mirrors run_powershell (ADR-032). */
  onShellRun?: Parameters<typeof createShellTool>[1];
}

/** API-Guide.md §2.3 v1 native tool catalogue (memory/routines/delegation tools are added by their phases). */
export function createNativeTools(d: NativeToolDeps): Tool[] {
  return [
    ...createSystemTools(d.os),
    ...createAppTools(d.os, d.appIndex),
    ...createUiAutomationTools(d.os),
    ...createFileTools({
      os: d.os,
      guard: d.guard,
      roots: d.roots,
      protectedPaths: d.protectedPaths,
    }),
    createDocumentTool(d.guard),
    ...createMiscTools(d.os, d.scheduler),
    createShellTool(d.os, d.onShellRun),
  ];
}
