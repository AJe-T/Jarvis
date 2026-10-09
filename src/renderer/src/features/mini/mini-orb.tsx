import { useEffect, useState } from 'react';
import type { AssistantState } from '@shared/types';
import { DEFAULT_ORB_STYLE, ORB_STYLES, type OrbStyleId } from '@shared/orb-styles';
import { Orb } from '../../components/jarvis/orb';
import { applyTheme } from '../../components/jarvis/theme-sync';
import { call } from '../../lib/api';

/** Design-system.md §4.3 mini mode: orb only, drag to move, click to expand, caption while replying. */
export function MiniOrb(): React.JSX.Element {
  const [state, setState] = useState<AssistantState>('IDLE');
  const [mic, setMic] = useState(0);
  const [music, setMusic] = useState(0);
  const [caption, setCaption] = useState('');
  const [orbStyle, setOrbStyle] = useState<OrbStyleId>(DEFAULT_ORB_STYLE);

  // The mini window has no settings store: read the theme and accent once when it opens.
  useEffect(() => {
    void call('settings:getAll', {}).then((v) => {
      const choice = v['appearance.theme'];
      const light = window.matchMedia('(prefers-color-scheme: light)').matches;
      const theme = choice === 'light' || choice === 'dark' ? choice : light ? 'light' : 'dark';
      const accent = v['appearance.accent'];
      applyTheme(theme, typeof accent === 'string' ? accent : '');
      const style = ORB_STYLES.find((s) => s.id === v['appearance.orbStyle']);
      if (style) setOrbStyle(style.id);
    });
  }, []);

  useEffect(() => {
    const on = window.jarvis.on;
    const subs = [
      on('assistant:state', (p) => {
        setState(p.state);
        if (p.state === 'IDLE' || p.state === 'LISTENING') setTimeout(() => setCaption(''), 4000);
      }),
      on('voice:level', (p) => setMic(p.rms)),
      on('music:level', (p) => setMusic(p.rms)),
      on('chat:delta', (p) =>
        setCaption((c) => (c + p.textDelta).replace(/<\/?spoken>/g, '').slice(-140)),
      ),
      on('chat:message', (p) => {
        if (p.message.role === 'user') setCaption('');
      }),
    ];
    return () => subs.forEach((u) => u());
  }, []);

  return (
    <div
      className="flex h-screen items-center justify-end gap-2 pr-1"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {caption && (
        <p
          className="fade-in line-clamp-2 max-w-[200px] rounded-lg border border-line-strong bg-surface-1 px-3 py-2 text-sm text-ink-100 shadow-pop"
          aria-live="polite"
        >
          {caption}
        </p>
      )}
      <button
        type="button"
        aria-label="Open Jarvis"
        title="Open Jarvis (drag the edge to move)"
        onClick={() => void call('app:setMiniMode', { on: false })}
        // §5.4: the orb on a small solid disc.
        className="rounded-pill border border-line-strong bg-surface-1 p-1.5 shadow-pop"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Orb
          state={state}
          level={state === 'LISTENING' ? mic : music}
          size="md"
          orbStyle={orbStyle}
        />
      </button>
    </div>
  );
}
