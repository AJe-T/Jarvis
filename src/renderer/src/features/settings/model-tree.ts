import { CLOUD_PROVIDERS, type CloudProviderId } from '@shared/llm-providers';

/**
 * The Models tree: Jarvis at the top, every AI he can use as a branch, and the models each one
 * runs as leaves. Built from settings only (no network), so it redraws as Sir edits.
 */
export type BranchRole = 'main' | 'helper' | 'fallback';

export interface TreeLeaf {
  label: string;
  model: string;
}

export interface TreeBranch {
  id: string;
  label: string;
  color: string;
  role: BranchRole;
  /** Settings section anchor to jump to when the branch is clicked. */
  anchor: 'connection' | 'subscriptions';
  leaves: TreeLeaf[];
}

export interface TreeInput {
  provider: 'api' | 'subscription' | 'local' | 'cloud';
  cloudProvider: CloudProviderId;
  cloudModels: Partial<Record<CloudProviderId, string>>;
  localModel: string;
  fallbackLocal: boolean;
  models: { default: string; deep: string; fast: string; computer: string };
  /** Secret name → saved. */
  secrets: Record<string, boolean>;
  /** Subscription apps that are installed and signed in. */
  apps: Array<{ id: string; label: string }>;
}

const COLORS: Record<string, string> = {
  claude: '#d97757',
  openai: '#10a37f',
  gemini: '#4285f4',
  deepseek: '#4d6bfe',
  xai: '#cbd5e1',
  mistral: '#fa520f',
  groq: '#f55036',
  openrouter: '#8b5cf6',
  together: '#3b82f6',
  huggingface: '#ffd21e',
  vercel: '#e5e7eb',
  requesty: '#6366f1',
  deepinfra: '#5b8def',
  fireworks: '#a855f7',
  ollamacloud: '#f5f5f4',
  local: '#22d3ee',
  chatgpt: '#10a37f',
  antigravity: '#fbbc04',
};

export function buildBranches(t: TreeInput): { on: TreeBranch[]; off: TreeBranch[] } {
  const all: Array<TreeBranch & { enabled: boolean }> = [];
  const claudeMain = t.provider === 'api' || t.provider === 'subscription';
  all.push({
    id: 'claude',
    label: t.provider === 'subscription' ? 'Claude (your plan)' : 'Claude',
    color: COLORS.claude ?? '#d97757',
    role: 'main',
    anchor: 'connection',
    enabled: t.provider === 'subscription' || (t.provider === 'api' && !!t.secrets.anthropic),
    leaves: claudeMain
      ? [
          { label: 'Conversation', model: t.models.default },
          { label: 'Deep thinking', model: t.models.deep },
          { label: 'Background', model: t.models.fast },
          { label: 'Computer control', model: t.models.computer },
        ]
      : [],
  });
  for (const p of CLOUD_PROVIDERS) {
    const model = t.cloudModels[p.id] ?? '';
    const main = t.provider === 'cloud' && t.cloudProvider === p.id;
    all.push({
      id: p.id,
      label: p.label.replace(/\s*\(.*\)$/, ''),
      color: COLORS[p.id] ?? '#94a3b8',
      role: main ? 'main' : 'helper',
      anchor: 'connection',
      enabled: !!t.secrets[p.secret] && (main || model !== ''),
      leaves: model ? [{ label: main ? 'Conversation' : 'Sub-tasks', model }] : [],
    });
  }
  const localMain = t.provider === 'local';
  all.push({
    id: 'local',
    label: 'Local model',
    color: COLORS.local ?? '#22d3ee',
    role: localMain ? 'main' : 'fallback',
    anchor: 'connection',
    enabled: t.localModel !== '' && (localMain || (t.provider === 'api' && t.fallbackLocal)),
    leaves: t.localModel
      ? [{ label: localMain ? 'Conversation' : 'When Claude is down', model: t.localModel }]
      : [],
  });
  for (const a of t.apps)
    all.push({
      id: a.id,
      label: a.label,
      color: COLORS[a.id] ?? '#94a3b8',
      role: 'helper',
      anchor: 'subscriptions',
      enabled: true,
      leaves: [{ label: 'Sub-tasks', model: 'your plan' }],
    });
  // The main brain is drawn first, in the middle of the eye line.
  const rank = { main: 0, fallback: 1, helper: 2 } as const;
  const strip = ({ enabled: _e, ...b }: TreeBranch & { enabled: boolean }): TreeBranch => b;
  return {
    on: all
      .filter((b) => b.enabled)
      .sort((a, b) => rank[a.role] - rank[b.role])
      .map(strip),
    off: all.filter((b) => !b.enabled).map(strip),
  };
}

export interface Placed {
  x: number;
  y: number;
}

/** Column width per leaf and the three row heights of the drawing. */
export const COL = 150;
export const ROWS = [44, 150, 250] as const;

/** Leaves spread in columns; each branch sits over the middle of its own leaves. */
export function placeTree(branches: TreeBranch[]): {
  width: number;
  root: Placed;
  branches: Array<{ at: Placed; leaves: Placed[] }>;
} {
  const cols = branches.reduce((n, b) => n + Math.max(1, b.leaves.length), 0);
  const width = Math.max(cols * COL, 520);
  const pad = (width - cols * COL) / 2;
  let col = 0;
  const placed = branches.map((b) => {
    const span = Math.max(1, b.leaves.length);
    const leaves = b.leaves.map((_, i) => ({ x: pad + (col + i + 0.5) * COL, y: ROWS[2] }));
    const at = { x: pad + (col + span / 2) * COL, y: ROWS[1] };
    col += span;
    return { at, leaves };
  });
  return { width, root: { x: width / 2, y: ROWS[0] }, branches: placed };
}
