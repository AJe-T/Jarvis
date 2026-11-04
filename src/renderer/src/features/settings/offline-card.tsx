import { useState } from 'react';
import { Switch } from '../../components/ui/field';
import { confirmAction } from '../../components/ui/confirm-modal';
import { call, cleanError } from '../../lib/api';
import { useSetting, useSettingsStore } from '../../stores/settings-store';

/**
 * Offline mode (src/main/offline.ts). The switch only turns on when main finds the brain, speech
 * to text, the voice and the wake word all on this PC and ready; otherwise a pop-up lists each part
 * still in the cloud (or not downloaded) and where to change it.
 */
export function OfflineModeCard(): React.JSX.Element {
  const enabled = useSetting('offline.enabled') === true;
  const unsaved = useSettingsStore((s) => Object.keys(s.drafts).length > 0);
  const [checking, setChecking] = useState(false);

  async function toggle(next: boolean): Promise<void> {
    if (checking) return;
    if (next && unsaved) {
      await confirmAction({
        title: 'Save your changes first',
        body: 'Offline mode checks your saved settings. Save (or discard) the changes in the bar below, then turn it on.',
        actionLabel: 'OK',
        destructive: false,
        alertOnly: true,
      });
      return;
    }
    setChecking(true);
    try {
      const r = await call('offline:set', { enabled: next });
      if (r.ok) {
        useSettingsStore.setState((s) => ({ values: { ...s.values, 'offline.enabled': next } }));
        return;
      }
      await confirmAction({
        title: 'Offline mode needs everything on this PC',
        body: `Change these first, then turn Offline mode on:\n\n${r.problems
          .map((p) => `• ${p.part}: ${p.fix}`)
          .join('\n\n')}`,
        actionLabel: 'Got it',
        destructive: false,
        alertOnly: true,
      });
    } catch (err) {
      await confirmAction({
        title: 'Offline mode could not be changed',
        body: cleanError(err),
        actionLabel: 'OK',
        destructive: false,
        alertOnly: true,
      });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="grid gap-1">
      <Switch
        label={
          checking
            ? 'Offline mode (checking…)'
            : 'Offline mode: brain, hearing and voice only on this PC'
        }
        checked={enabled}
        onChange={(v) => void toggle(v)}
      />
      <p className="text-xs text-ink-300">
        Turns on only when your main brain is a local model (Ollama or LM Studio on this PC), speech
        to text and Jarvis&apos;s voice are on-device and downloaded, and no realtime conversation
        is chosen. While it is on, Jarvis never falls back to Claude, Deepgram, Edge or the free AI
        pool, and those can&apos;t be chosen until you turn it off. Tools that read the web
        (weather, Wikipedia) still use the internet if it is there.
      </p>
    </div>
  );
}
