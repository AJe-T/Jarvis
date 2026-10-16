import { useEffect, useState } from 'react';
import type { Res } from '@shared/ipc-contract';
import { call } from '../../lib/api';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { useDraftSetting, useSettingsStore } from '../../stores/settings-store';
import { ROWS, buildBranches, placeTree, type BranchRole, type TreeBranch } from './model-tree';

const ROLE_LABEL: Record<BranchRole, string> = {
  main: 'main brain',
  helper: 'helper',
  fallback: 'fallback',
};
const HEIGHT = ROWS[2] + 40;

const jump = (anchor: TreeBranch['anchor']): void =>
  document
    .getElementById(`brain-${anchor}`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** Curved wire from a parent's bottom edge to a child's top edge. */
const wire = (x1: number, y1: number, x2: number, y2: number): string => {
  const my = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
};

/**
 * Settings → Models & AI: Jarvis at the top, each AI he can use as a branch, the models it runs
 * as leaves. Only what is switched on is wired in; the rest waits in the strip below.
 */
export function ModelTreeView(): React.JSX.Element {
  const still = useReducedMotion();
  const values = useSettingsStore((s) => s.values);
  const [secrets, setSecrets] = useState<Record<string, boolean>>({});
  const [apps, setApps] = useState<Res<'llm:cliStatus'>>([]);
  const provider = useDraftSetting('llm.provider') ?? 'api';
  const cloudProvider = useDraftSetting('llm.cloud.provider') ?? 'openai';
  const cloudModels = useDraftSetting('llm.cloud.models') ?? {};
  const localModel = useDraftSetting('llm.local.model') ?? '';
  const fallbackLocal = useDraftSetting('llm.fallbackLocal') === true;
  const models = {
    default: useDraftSetting('models.default') ?? '',
    deep: useDraftSetting('models.deep') ?? '',
    fast: useDraftSetting('models.fast') ?? '',
    computer: useDraftSetting('models.computer') ?? '',
  };

  // Keys and app sign-ins change outside the draft: re-read them whenever settings are saved.
  useEffect(() => {
    void call('secrets:status', {}).then((s) =>
      setSecrets(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.set]))),
    );
    void call('llm:cliStatus', {})
      .then(setApps)
      .catch(() => setApps([]));
  }, [values]);

  const { on, off } = buildBranches({
    provider,
    cloudProvider,
    cloudModels,
    localModel,
    fallbackLocal,
    models,
    secrets,
    apps: apps.filter((a) => a.installed && a.signedIn).map((a) => ({ id: a.id, label: a.label })),
  });
  const layout = placeTree(on);

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-line bg-surface-1 p-2">
        <svg
          viewBox={`0 0 ${layout.width} ${HEIGHT}`}
          className="mx-auto block w-full"
          style={{ minWidth: Math.min(layout.width, 640), maxHeight: 340 }}
          role="img"
          aria-label={`Jarvis uses ${on.length} AI${on.length === 1 ? '' : 's'}: ${on.map((b) => `${b.label} (${ROLE_LABEL[b.role]})`).join(', ')}`}
        >
          {on.map((b, i) => {
            const p = layout.branches[i];
            if (!p) return null;
            const main = b.role === 'main';
            return (
              <g key={`w-${b.id}`}>
                <path
                  d={wire(layout.root.x, layout.root.y + 26, p.at.x, p.at.y - 18)}
                  fill="none"
                  stroke={b.color}
                  strokeWidth={main ? 2.4 : 1.4}
                  strokeOpacity={main ? 0.9 : 0.55}
                  strokeDasharray={main ? '6 6' : b.role === 'fallback' ? '2 5' : undefined}
                >
                  {main && !still && (
                    <animate
                      attributeName="stroke-dashoffset"
                      from="24"
                      to="0"
                      dur="0.9s"
                      repeatCount="indefinite"
                    />
                  )}
                </path>
                {p.leaves.map((l, j) => (
                  <path
                    key={j}
                    d={wire(p.at.x, p.at.y + 18, l.x, l.y - 16)}
                    fill="none"
                    stroke={b.color}
                    strokeWidth={1.1}
                    strokeOpacity={0.45}
                  />
                ))}
              </g>
            );
          })}
          <g transform={`translate(${layout.root.x},${layout.root.y})`}>
            <circle r={30} fill="var(--accent-glow)" />
            <circle r={22} fill="var(--surface-2)" stroke="var(--accent-600)" strokeWidth={2} />
            <text textAnchor="middle" dy={4} fontSize={11} fontWeight={700} fill="var(--ink-100)">
              JARVIS
            </text>
          </g>
          {on.map((b, i) => {
            const p = layout.branches[i];
            if (!p) return null;
            const w = Math.max(96, b.label.length * 7 + 28);
            return (
              <g key={b.id}>
                <g
                  transform={`translate(${p.at.x},${p.at.y})`}
                  className="cursor-pointer"
                  role="link"
                  tabIndex={0}
                  aria-label={`${b.label}, ${ROLE_LABEL[b.role]}: open its settings`}
                  onClick={() => jump(b.anchor)}
                  onKeyDown={(e) => e.key === 'Enter' && jump(b.anchor)}
                >
                  <rect
                    x={-w / 2}
                    y={-18}
                    width={w}
                    height={36}
                    rx={18}
                    fill="var(--surface-2)"
                    stroke={b.color}
                    strokeWidth={b.role === 'main' ? 2 : 1.2}
                  />
                  <text
                    textAnchor="middle"
                    dy={-1}
                    fontSize={12}
                    fontWeight={600}
                    fill="var(--ink-100)"
                  >
                    {b.label}
                  </text>
                  <text textAnchor="middle" dy={12} fontSize={9} fill={b.color}>
                    {ROLE_LABEL[b.role].toUpperCase()}
                  </text>
                </g>
                {b.leaves.map((l, j) => {
                  const at = p.leaves[j];
                  if (!at) return null;
                  const model = l.model.length > 20 ? `${l.model.slice(0, 19)}…` : l.model;
                  return (
                    <g key={j} transform={`translate(${at.x},${at.y})`}>
                      <title>{`${l.label}: ${l.model}`}</title>
                      <rect
                        x={-66}
                        y={-16}
                        width={132}
                        height={34}
                        rx={8}
                        fill="var(--surface-1)"
                        stroke={b.color}
                        strokeOpacity={0.5}
                      />
                      <text textAnchor="middle" dy={-3} fontSize={9} fill="var(--ink-500)">
                        {l.label}
                      </text>
                      <text
                        textAnchor="middle"
                        dy={10}
                        fontSize={10.5}
                        fontFamily="var(--font-code, monospace)"
                        fill="var(--ink-100)"
                      >
                        {model || 'not set'}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      {off.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-ink-500">Not connected:</span>
          {off.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => jump(b.anchor)}
              className="rounded-full border border-dashed border-line px-2.5 py-0.5 text-ink-300 hover:border-ink-500 hover:text-ink-100"
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
