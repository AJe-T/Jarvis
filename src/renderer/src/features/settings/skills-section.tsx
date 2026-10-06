import { useCallback, useEffect, useState } from 'react';
import type { Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { Section, Switch, TextInput } from '../../components/ui/field';
import { confirmAction } from '../../components/ui/confirm-modal';
import { Markdown } from '../../components/jarvis/chat-message';
import { call, cleanError } from '../../lib/api';
import { useUiStore } from '../../stores/ui-store';

type SkillView = Res<'skills:list'>[number];

/** Skills (OpenJarvis / agentskills.io): install, review, turn on/off, remove. */
export function SkillsSection(): React.JSX.Element {
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ name: string; markdown: string } | null>(null);
  const toast = useUiStore((s) => s.toast);
  const load = useCallback(() => void call('skills:list', {}).then(setSkills), []);
  useEffect(load, [load]);

  const run = async (p: Promise<{ skill: SkillView | null }>): Promise<void> => {
    setBusy(true);
    try {
      const r = await p;
      if (r.skill) {
        toast({ level: 'info', message: `Installed skill "${r.skill.name}". Review it below.` });
        setPreview({
          name: r.skill.name,
          markdown: (await call('skills:read', { name: r.skill.name })).markdown,
        });
      }
      load();
    } catch (err) {
      toast({ level: 'error', message: cleanError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section
        title="Skills"
        description="A skill is a folder with SKILL.md: instructions that teach Jarvis how to do a kind of task (agentskills.io format, as used by OpenJarvis and Claude). Jarvis sees each skill's name and description and loads the full instructions only when needed. Skills never run code by themselves; every action still asks you as usual. Only install skills you trust."
      >
        <div className="flex flex-wrap items-end gap-2">
          <TextInput
            aria-label="GitHub link to a skill folder"
            placeholder="https://github.com/owner/repo/tree/main/skills/some-skill"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="min-w-[24rem] flex-1"
          />
          <Button
            disabled={busy || !url.startsWith('https://github.com/')}
            onClick={() => void run(call('skills:installGitHub', { url }))}
          >
            Install from GitHub
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void run(call('skills:installFolder', {}))}
          >
            Install from folder…
          </Button>
        </div>
      </Section>
      <Section title="Installed skills">
        <ul className="flex max-w-3xl flex-col gap-2">
          {skills.length === 0 && <li className="text-sm text-ink-500">No skills installed.</li>}
          {skills.map((s) => (
            <li
              key={s.name}
              className="flex items-start gap-3 rounded-md border border-night-600 p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink-100">{s.name}</p>
                <p className="text-sm text-ink-300">{s.description}</p>
                <p className="mt-1 text-xs text-ink-500">
                  {s.files.length} extra file(s){s.license ? ` · ${s.license}` : ''}
                </p>
              </div>
              <Switch
                label={`Use ${s.name}`}
                checked={s.enabled}
                onChange={(on) =>
                  void call('skills:setEnabled', { name: s.name, enabled: on }).then(load)
                }
              />
              <Button
                variant="ghost"
                onClick={() =>
                  void call('skills:read', { name: s.name }).then((r) =>
                    setPreview({ name: s.name, markdown: r.markdown }),
                  )
                }
              >
                View
              </Button>
              <Button
                variant="ghost"
                onClick={() =>
                  void confirmAction({
                    title: `Remove the skill "${s.name}"?`,
                    body: 'Its folder is deleted from Jarvis. You can install it again later.',
                    actionLabel: 'Remove',
                    destructive: true,
                  }).then((yes) => yes && call('skills:remove', { name: s.name }).then(load))
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        {preview && (
          <div className="max-w-3xl rounded-md border border-night-600 bg-night-800 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-semibold text-ink-100">{preview.name} / SKILL.md</p>
              <Button variant="ghost" onClick={() => setPreview(null)}>
                Close
              </Button>
            </div>
            <div className="prose-sm max-h-96 overflow-y-auto text-sm text-ink-300">
              <Markdown text={preview.markdown} />
            </div>
          </div>
        )}
      </Section>
    </>
  );
}
