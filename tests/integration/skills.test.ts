import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSkillMd } from '@main/skills/skills';
import { idle, setupServices } from './helpers';

const SKILL = `---
name: meeting-notes
description: Turn a messy transcript into tidy meeting notes with decisions and action items.
license: MIT
---
# Meeting notes
1. Read the transcript.
2. List decisions, then action items with owners.
See template.md for the layout.
`;

function skillFolder(dir: string, md = SKILL): string {
  const folder = join(dir, 'src-skill');
  mkdirSync(join(folder, 'assets'), { recursive: true });
  writeFileSync(join(folder, 'SKILL.md'), md);
  writeFileSync(join(folder, 'template.md'), '## Decisions\n## Actions');
  writeFileSync(join(folder, 'assets', 'logo.png'), Buffer.from([0x89, 0x50]));
  return folder;
}

describe('skills (OpenJarvis / agentskills.io format)', () => {
  it('validates SKILL.md frontmatter', () => {
    expect(parseSkillMd(SKILL).name).toBe('meeting-notes');
    expect(() => parseSkillMd('---\nname: Bad Name\ndescription: x\n---\n')).toThrow();
    expect(() => parseSkillMd('# no frontmatter')).toThrow();
  });

  it('installs from a folder (text files only), lists it in context, loads it on demand', async () => {
    const t = setupServices({
      rules: [
        {
          match: 'notes',
          steps: [
            {
              tools: [
                { name: 'use_skill', input: { name: 'meeting-notes' } },
                { name: 'read_skill_file', input: { name: 'meeting-notes', path: 'template.md' } },
                {
                  name: 'read_skill_file',
                  input: { name: 'meeting-notes', path: '../../secrets.bin' },
                },
              ],
            },
            { text: 'Here are the notes, sir.' },
          ],
        },
      ],
    });
    const s = t.services;
    const skill = await s.skills.installFromFolder(skillFolder(t.dir));
    expect(skill.files).toEqual(['template.md']); // the PNG was skipped
    await s.refreshSkills();
    s.orchestrator.send({ text: 'make meeting notes', source: 'text' });
    await idle(s);
    const chat = t.llm.calls.filter((c) => JSON.stringify(c.system).includes('You are JARVIS'));
    expect(JSON.stringify(chat[0]?.system)).toContain(
      'meeting-notes — Turn a messy transcript into tidy meeting notes',
    );
    const results = JSON.stringify(chat.at(-1)?.messages.at(-1)?.content);
    expect(results).toContain('<skill name=\\"meeting-notes\\" installed_by=\\"sir\\">');
    expect(results).toContain('## Decisions');
    expect(results).toMatch(/outside the skill|Only text files/);
  });

  it('a turned-off skill is hidden from context and refuses to load', async () => {
    const t = setupServices({
      rules: [
        {
          match: 'notes',
          steps: [
            { tools: [{ name: 'use_skill', input: { name: 'meeting-notes' } }] },
            { text: 'ok' },
          ],
        },
      ],
    });
    const s = t.services;
    await s.skills.installFromFolder(skillFolder(t.dir));
    s.skills.setEnabled('meeting-notes', false);
    await s.refreshSkills();
    s.orchestrator.send({ text: 'notes please', source: 'text' });
    await idle(s);
    const chat = t.llm.calls.filter((c) => JSON.stringify(c.system).includes('You are JARVIS'));
    expect(JSON.stringify(chat[0]?.system)).toContain('none installed');
    expect(JSON.stringify(chat.at(-1)?.messages.at(-1)?.content)).toContain('turned off');
  });

  it('installs from a public GitHub folder via the contents API', async () => {
    const files: Record<string, string> = {
      'https://raw.example/SKILL.md': SKILL,
      'https://raw.example/template.md': '## Template',
    };
    const fetch = (async (url: string) => {
      if (url.startsWith('https://api.github.com/repos/acme/skills/contents/skills/meeting-notes'))
        return Response.json([
          {
            type: 'file',
            path: 'skills/meeting-notes/SKILL.md',
            size: 200,
            download_url: 'https://raw.example/SKILL.md',
          },
          {
            type: 'file',
            path: 'skills/meeting-notes/template.md',
            size: 20,
            download_url: 'https://raw.example/template.md',
          },
          {
            type: 'file',
            path: 'skills/meeting-notes/run.exe',
            size: 20,
            download_url: 'https://raw.example/run.exe',
          },
        ]);
      const body = files[url];
      return body ? new Response(body) : new Response('nope', { status: 404 });
    }) as typeof globalThis.fetch;
    const t = setupServices(undefined, { fetch });
    const skill = await t.services.skills.installFromGitHub(
      'https://github.com/acme/skills/tree/main/skills/meeting-notes',
    );
    expect(skill.name).toBe('meeting-notes');
    expect(skill.files).toEqual(['template.md']);
    await expect(t.services.skills.installFromGitHub('https://evil.example/x')).rejects.toThrow();
  });
});
