import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from '../../db/connection';
import { createSettingsRepo } from '../../db/repos/settings-repo';
import { logger } from '../../logging/logger';
import { createSettingsService } from '../../settings/settings-service';
import type { Tool, ToolOutput } from '../types';
import { createModeTools } from './modes';

const ctx = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};
const text = (o: ToolOutput): string => o.content.map((c) => ('text' in c ? c.text : '')).join(' ');

function setup(now = 1_000_000) {
  const db = openDatabase(':memory:');
  migrate(db);
  const settings = createSettingsService(createSettingsRepo(db));
  const tools = createModeTools({ settings, now: () => now });
  const tool = (name: string): Tool => tools.find((t) => t.name === name) as Tool;
  const run = (name: string, input: unknown): Promise<ToolOutput> =>
    tool(name).run(tool(name).input.parse(input), ctx);
  return { settings, tool, run };
}

describe('set_personality and quiet_mode', () => {
  it('switches the personality setting and rejects unknown ones', async () => {
    const t = setup();
    expect(t.settings.get('persona')).toBe('butler');
    expect(text(await t.run('set_personality', { personality: 'concise' }))).toBe(
      'Personality is now Concise.',
    );
    expect(t.settings.get('persona')).toBe('concise');
    expect(() => t.tool('set_personality').input.parse({ personality: 'evil' })).toThrow();
    expect(t.tool('set_personality').tier).toBe('SAFE');
  });

  it('sets quiet mode for N minutes and turns it off with 0', async () => {
    const t = setup(1_000_000);
    const out = await t.run('quiet_mode', { minutes: 45 });
    expect(t.settings.get('quiet.until')).toBe(1_000_000 + 45 * 60_000);
    expect(text(out)).toMatch(/^Quiet mode on until /);
    await t.run('quiet_mode', { minutes: 0 });
    expect(t.settings.get('quiet.until')).toBe(0);
    expect(() => t.tool('quiet_mode').input.parse({ minutes: 100_000 })).toThrow();
  });
});
