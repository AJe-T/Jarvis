import { useCallback, useEffect, useState } from 'react';
import type { Res } from '@shared/ipc-contract';
import { Button } from '../../components/ui/button';
import { Section, TextInput } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useUiStore } from '../../stores/ui-store';
import { SkillsNetwork } from './skills-network';

type SkillView = Res<'skills:list'>[number];

/** Skills (OpenJarvis / agentskills.io): install, review, turn on/off, remove. */
export function SkillsSection(): React.JSX.Element {
  const [skills, setSkills] = useState<SkillView[]>([]);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [justInstalled, setJustInstalled] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const toast = useUiStore((s) => s.toast);
  const load = useCallback(() => void call('skills:list', {}).then(setSkills), []);
  useEffect(load, [load]);

  const run = async (p: Promise<Res<'skills:installGitHub'>>): Promise<void> => {
    setBusy(true);
    try {
      const r = await p;
      setNotes(r.warnings);
      const [first] = r.installed;
      if (r.installed.length > 1)
        toast({
          level: 'info',
          message: `Installed ${r.installed.length} skills, turned off. Switch on the ones you want above.`,
        });
      else if (first) {
        toast({ level: 'info', message: `Installed skill "${first.name}". Review it above.` });
        setJustInstalled(first.name);
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
        title={`Installed skills (${skills.filter((s) => s.enabled).length} on of ${skills.length})`}
      >
        {skills.length === 0 ? (
          <p className="text-sm text-ink-500">No skills installed.</p>
        ) : (
          <SkillsNetwork skills={skills} reload={load} focus={justInstalled} />
        )}
      </Section>
      <Section
        title="Add skills"
        description="A skill is a folder with SKILL.md: instructions that teach Jarvis how to do a kind of task (agentskills.io format, as used by OpenJarvis and Claude). Jarvis sees each skill's name and description and loads the full instructions only when needed. Skills never run code by themselves; every action still asks you as usual. Only install skills you trust."
      >
        <div className="flex flex-wrap items-end gap-2">
          <TextInput
            aria-label="GitHub link to a skill folder, or a repo or folder of skills"
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
        <p className="text-xs text-ink-500">
          A link to a whole repo or folder installs every skill in it (for example
          github.com/anthropics/knowledge-work-plugins), turned off, so only the ones you switch on
          are added to each request.
        </p>
        {notes.length > 0 && (
          <ul role="status" className="max-w-3xl list-disc pl-5 text-sm text-lamp-400">
            {notes.slice(0, 12).map((n) => (
              <li key={n}>{n}</li>
            ))}
            {notes.length > 12 && <li>…and {notes.length - 12} more.</li>}
          </ul>
        )}
      </Section>
    </>
  );
}
