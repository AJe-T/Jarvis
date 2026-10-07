import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { Section } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useSetting } from '../../stores/settings-store';
import { useUiStore } from '../../stores/ui-store';
import { SettingSwitch, saveSetting } from './settings-controls';
import { ModelDownload, useModels } from './voice-engines';

export function MemorySection(): React.JSX.Element {
  const vault = useSetting('vault.path') ?? '';
  const [busy, setBusy] = useState(false);
  const toast = useUiStore((s) => s.toast);
  const models = useModels();

  async function changeVault(): Promise<void> {
    const r = await call('app:pickFolder', { title: 'Choose the JarvisBrain vault folder' });
    if (!r.path || r.path === vault) return;
    const okd = await confirmAction({
      title: "Use this folder as Jarvis's memory?",
      body: `${r.path}\n\nJarvis creates its folders there if needed. The old vault is left untouched.`,
      actionLabel: 'Use folder',
      destructive: false,
    });
    if (okd) await saveSetting('vault.path', r.path);
  }

  async function rebuild(): Promise<void> {
    setBusy(true);
    try {
      const r = await call('memory:rebuildIndex', {});
      toast({ level: 'info', message: `Index rebuilt from ${r.files} notes.` });
    } catch (err) {
      toast({ level: 'error', message: cleanError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Section
        title="Memory vault"
        description="Jarvis's long-term memory is an Obsidian vault of Markdown notes. You can edit them; Jarvis notices within seconds."
      >
        <p className="rounded-sm bg-surface-2 px-3 py-2 font-code text-sm break-all">{vault}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void call('memory:openInObsidian', {})}>Open in Obsidian</Button>
          <Button onClick={() => void changeVault()}>Choose another folder…</Button>
          <Button variant="ghost" disabled={busy} onClick={() => void rebuild()}>
            Rebuild index
          </Button>
        </div>
      </Section>
      <Section
        title="Semantic search"
        description="Finds memories and past conversations by meaning, not just matching words (an idea from isair/jarvis). Runs on this PC with a 24 MB model; nothing is sent anywhere."
      >
        <ModelDownload id="minilm-embed" models={models} />
        <SettingSwitch
          k="memory.semanticSearch"
          label="Use semantic search when the model is downloaded"
        />
      </Section>
    </>
  );
}
