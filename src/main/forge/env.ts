/**
 * What Forge's programs (Claude Code, git, npm, the tests) see of Jarvis's environment: what Windows,
 * Node, git over SSH and Claude Code's own sign-in need, never other tokens (GH_TOKEN, cloud keys…).
 * No ANTHROPIC_* (it would move Claude Code onto API billing, ADR-010) and no ELECTRON_RUN_AS_NODE.
 */
const KEEP = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'SystemDrive',
  'windir',
  'ComSpec',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'USERNAME',
  'USERDOMAIN',
  'COMPUTERNAME',
  'HOMEDRIVE',
  'HOMEPATH',
  'HOME',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'CommonProgramFiles',
  'CommonProgramFiles(x86)',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
  'LANG',
  'SSH_AUTH_SOCK',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  // Where git reads its settings (Sir's identity, SSH and URL settings).
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_NOSYSTEM',
];

export function forgeEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  // Windows environment names are case-insensitive (Path vs PATH).
  const byLower = new Map(Object.entries(env).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of KEEP) {
    const v = byLower.get(k.toLowerCase());
    if (v !== undefined) out[k] = v;
  }
  return out;
}
