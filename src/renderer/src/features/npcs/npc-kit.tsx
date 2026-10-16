import clsx from 'clsx';
import type { CSSProperties } from 'react';
import type { Npc, NpcColor, NpcState } from '@shared/npcs';

/** Each NPC's colour (rings, glows, stripes; never body text, so both themes stay readable). */
export const NPC_HEX: Record<NpcColor, string> = {
  cyan: '#22d3ee',
  violet: '#a78bfa',
  amber: '#fbbf24',
  emerald: '#34d399',
  rose: '#fb7185',
  sky: '#38bdf8',
  lime: '#a3e635',
  orange: '#fb923c',
  fuchsia: '#e879f9',
  teal: '#2dd4bf',
};

export const npcStyle = (c: NpcColor): CSSProperties => ({ '--npc': NPC_HEX[c] }) as CSSProperties;

export const STATE_LABEL: Record<NpcState, string> = {
  idle: 'At desk',
  working: 'Working…',
  meeting: 'In a meeting',
  off: 'Switched off',
};

const STATE_DOT: Record<NpcState, string> = {
  idle: 'bg-ok-400',
  working: 'bg-accent-500 dot-breathe',
  meeting: 'bg-lamp-400',
  off: 'bg-ink-500',
};

export function StateDot({ state }: { state: NpcState }): React.JSX.Element {
  return (
    <span
      aria-label={STATE_LABEL[state]}
      title={STATE_LABEL[state]}
      className={clsx('inline-block size-2 shrink-0 rounded-pill', STATE_DOT[state])}
    />
  );
}

/** Round emoji badge in the NPC's colour. */
export function NpcBadge({
  npc,
  size = 'md',
  state,
}: {
  npc: Pick<Npc, 'emoji' | 'color' | 'name'>;
  size?: 'sm' | 'md' | 'lg';
  state?: NpcState;
}): React.JSX.Element {
  return (
    <span className="relative inline-flex shrink-0" aria-hidden>
      <span
        style={npcStyle(npc.color)}
        className={clsx(
          'grid place-items-center rounded-pill border-2 border-(--npc) bg-surface-2 shadow-[0_0_12px_-4px_var(--npc)]',
          size === 'sm' && 'size-7 text-sm',
          size === 'md' && 'size-9 text-lg',
          size === 'lg' && 'size-14 text-3xl',
          state === 'off' && 'opacity-50 grayscale',
        )}
      >
        {npc.emoji}
      </span>
      {state && (
        <span className="absolute -right-0.5 -bottom-0.5 rounded-pill bg-app p-0.5">
          <StateDot state={state} />
        </span>
      )}
    </span>
  );
}

/** Jarvis in the team chat and the office: the head of the team. */
export const JARVIS_BADGE = { emoji: '◉', color: 'cyan' as NpcColor, name: 'Jarvis' };
