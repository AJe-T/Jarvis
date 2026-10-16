import { describe, expect, it } from 'vitest';
import { AGENT_CLIS } from '@shared/agent-clis';
import { detectAgentClis } from './agent-clis';

const env = {
  PATH: 'C:\\Tools;C:\\Users\\sir\\AppData\\Roaming\\npm',
  APPDATA: 'C:\\Users\\sir\\AppData\\Roaming',
  USERPROFILE: 'C:\\Users\\sir',
  LOCALAPPDATA: 'C:\\Users\\sir\\AppData\\Local',
};
const NPM = 'C:\\Users\\sir\\AppData\\Roaming\\npm';

function detect(files: Record<string, string | true>, known = {}) {
  const read: string[] = [];
  const out = detectAgentClis({
    env,
    exists: (p) => p in files,
    readFile: (p) => {
      read.push(p);
      const f = files[p];
      if (typeof f !== 'string') throw new Error('ENOENT');
      return f;
    },
    known,
  });
  return { out, read, by: (id: string) => out.find((a) => a.id === id) };
}

describe('agent CLI detection (files only, nothing run)', () => {
  it('lists every known agent, installed or not', () => {
    const { out } = detect({});
    expect(out.map((a) => a.id)).toEqual(AGENT_CLIS.map((a) => a.id));
    expect(out.every((a) => !a.installed && a.version === null)).toBe(true);
  });

  it('finds an npm shim on PATH and reads the version from its package.json', () => {
    const { by } = detect({
      [`${NPM}\\gemini.cmd`]: true,
      [`${NPM}\\node_modules\\@google\\gemini-cli\\package.json`]: '{"version":"0.9.1"}',
    });
    expect(by('gemini')).toMatchObject({ installed: true, version: '0.9.1' });
  });

  it("doesn't trust a malformed version or a copy installed outside npm", () => {
    const { by } = detect({
      'C:\\Tools\\opencode.exe': true,
      [`${NPM}\\node_modules\\opencode-ai\\package.json`]: '{"version":"1.0.0"}',
      [`${NPM}\\copilot.cmd`]: true,
      [`${NPM}\\node_modules\\@github\\copilot\\package.json`]: '{"version":"<script>"}',
    });
    expect(by('opencode')).toMatchObject({ installed: true, version: null });
    expect(by('copilot')).toMatchObject({ installed: true, version: null });
  });

  it('a look-alike folder next to npm is not the npm install', () => {
    const out = detectAgentClis({
      env: { ...env, PATH: `"${NPM}-evil"` },
      exists: (p) => p === `${NPM}-evil\\gemini.cmd`,
      readFile: () => '{"version":"9.9.9"}',
    });
    expect(out.find((a) => a.id === 'gemini')).toMatchObject({ installed: true, version: null });
  });

  it('checks documented install folders, and only the explicit Cursor command', () => {
    const { by } = detect({
      'C:\\Users\\sir\\.local\\bin\\aider.exe': true,
      'C:\\Tools\\agent.exe': true,
    });
    expect(by('aider')?.installed).toBe(true);
    expect(by('cursor')?.installed).toBe(false);
  });

  it("prefers paths Jarvis's own finders resolved", () => {
    const { by } = detect({}, { claude: 'D:\\claude\\claude.exe' });
    expect(by('claude')).toMatchObject({ installed: true, path: 'D:\\claude\\claude.exe' });
  });
});
