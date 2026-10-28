import { describe, expect, it } from 'vitest';
import { forgeEnv } from './env';

describe('forgeEnv', () => {
  it('keeps what Windows, git and Claude Code need, and drops every other token', () => {
    const env = forgeEnv({
      Path: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\me',
      GH_TOKEN: 'ghp_x',
      ANTHROPIC_API_KEY: 'sk-ant-x',
      OPENAI_API_KEY: 'sk-x',
      ELECTRON_RUN_AS_NODE: '1',
    });
    expect(env).toEqual({ PATH: 'C:\\Windows', USERPROFILE: 'C:\\Users\\me' });
  });
});
