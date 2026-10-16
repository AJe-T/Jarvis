/**
 * Coding agents and AI command-line apps Jarvis knows about. Detection only looks for these fixed
 * command names on PATH (plus a few documented install folders): it never runs them, never reads
 * their sign-in files, and never searches other folders (Security.md §16.11).
 * `use` says what Jarvis does with each today; 'detected' ones are listed but not wired in yet
 * (each needs its headless mode verified on Sir's PC first, docs/Integrations.md).
 * ⚠️ Command names and install commands checked against each project's docs on `checked`.
 */

export interface AgentCliDef {
  id: string;
  label: string;
  vendor: string;
  /** Command names to look for on PATH (no extension; .exe and .cmd are tried). */
  commands: readonly string[];
  /** Documented install folders outside PATH: [environment variable, path below it]. */
  folders?: ReadonlyArray<readonly ['LOCALAPPDATA' | 'USERPROFILE' | 'APPDATA', string]>;
  /** npm package: when installed with npm, the version is read from its package.json. */
  npmPackage?: string;
  install: string;
  docsUrl: string;
  /**
   * 'main-brain' = can be Jarvis's own connection; 'answer-brain' = a sub-agent / NPC that only
   * answers (no tools); 'detected' = shown here, not used by Jarvis yet.
   */
  use: 'main-brain' | 'answer-brain' | 'detected';
  note?: string;
  checked: string;
}

export const AGENT_CLIS = [
  {
    id: 'claude',
    label: 'Claude Code',
    vendor: 'Anthropic',
    commands: ['claude'],
    folders: [['USERPROFILE', '.local\\bin']],
    npmPackage: '@anthropic-ai/claude-code',
    install: 'Installer from claude.com/claude-code',
    docsUrl: 'https://code.claude.com/docs/en/setup',
    use: 'main-brain',
    checked: '2026-10-16',
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    vendor: 'OpenAI',
    commands: ['codex'],
    npmPackage: '@openai/codex',
    install: 'npm i -g @openai/codex',
    docsUrl: 'https://developers.openai.com/codex/cli',
    use: 'answer-brain',
    checked: '2026-10-16',
  },
  {
    id: 'antigravity',
    label: 'Antigravity CLI',
    vendor: 'Google',
    commands: ['agy'],
    folders: [['LOCALAPPDATA', 'agy\\bin']],
    install: 'Installer from antigravity.google',
    docsUrl: 'https://antigravity.google',
    use: 'answer-brain',
    checked: '2026-10-16',
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    vendor: 'Google',
    commands: ['gemini'],
    npmPackage: '@google/gemini-cli',
    install: 'npm install -g @google/gemini-cli',
    docsUrl: 'https://github.com/google-gemini/gemini-cli',
    use: 'detected',
    checked: '2026-10-16',
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot CLI',
    vendor: 'GitHub',
    commands: ['copilot'],
    npmPackage: '@github/copilot',
    install: 'winget install GitHub.Copilot (or npm install -g @github/copilot)',
    docsUrl:
      'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli',
    use: 'detected',
    checked: '2026-10-16',
  },
  {
    id: 'cursor',
    label: 'Cursor CLI',
    vendor: 'Cursor',
    // The docs also call it "agent", a name other tools use too, so only the explicit one is trusted.
    commands: ['cursor-agent'],
    install: "In PowerShell: irm 'https://cursor.com/install?win32=true' | iex",
    docsUrl: 'https://cursor.com/docs/cli/installation',
    use: 'detected',
    checked: '2026-10-16',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    vendor: 'SST',
    commands: ['opencode'],
    npmPackage: 'opencode-ai',
    install: 'npm install -g opencode-ai',
    docsUrl: 'https://opencode.ai/docs',
    use: 'detected',
    checked: '2026-10-16',
  },
  {
    id: 'aider',
    label: 'Aider',
    vendor: 'Aider',
    commands: ['aider'],
    folders: [['USERPROFILE', '.local\\bin']],
    install: 'powershell -ExecutionPolicy ByPass -c "irm https://aider.chat/install.ps1 | iex"',
    docsUrl: 'https://aider.chat/docs/install.html',
    use: 'detected',
    checked: '2026-10-16',
  },
  {
    id: 'goose',
    label: 'Goose',
    vendor: 'Block / AAIF',
    commands: ['goose'],
    install: 'Windows download or install script from goose-docs.ai',
    docsUrl: 'https://goose-docs.ai/docs/getting-started/installation',
    use: 'detected',
    checked: '2026-10-16',
  },
  {
    id: 'kimi',
    label: 'Kimi Code CLI',
    vendor: 'Moonshot AI',
    commands: ['kimi'],
    folders: [['USERPROFILE', '.local\\bin']],
    install: 'uv tool install --python 3.13 kimi-cli',
    docsUrl: 'https://moonshotai.github.io/kimi-cli/',
    use: 'detected',
    note: 'Windows support is not confirmed in its docs.',
    checked: '2026-10-16',
  },
] as const satisfies readonly AgentCliDef[];

export type AgentCliId = (typeof AGENT_CLIS)[number]['id'];
export const AGENT_CLI_IDS = AGENT_CLIS.map((a) => a.id) as [AgentCliId, ...AgentCliId[]];
