import type { McpServerInput } from '@shared/ipc-contract';
import type { SecretNeed } from '@shared/mcp-presets';

/** A server picked from the catalogue or the registry, waiting for its keys and "Connect". */
export interface Candidate {
  label: string;
  description: string;
  secrets: SecretNeed[];
  server: McpServerInput;
  /** Registry servers may clash with an existing name, so Sir can rename them. */
  renamable?: boolean;
  /** Where the code lives (registry entries), shown so Sir can check it first. */
  source?: string;
}

export const NAME_RE = /^[a-z][a-z0-9_-]{1,30}$/;
