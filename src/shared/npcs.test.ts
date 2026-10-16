import { describe, expect, it } from 'vitest';
import { NPC_TEMPLATES, NpcInputSchema, parseMentions } from './npcs';

const team = [
  { id: 'n1', name: 'Maya' },
  { id: 'n2', name: 'Market Head' },
  { id: 'n3', name: 'Ledger' },
];

describe('parseMentions', () => {
  it('finds tagged NPCs and Jarvis, case-insensitively', () => {
    expect(parseMentions('@maya draft a post, @LEDGER check costs', team)).toEqual(['n1', 'n3']);
    expect(parseMentions('@Jarvis what do you think?', team)).toEqual(['jarvis']);
    expect(parseMentions('@April thoughts?', team, 'April')).toEqual(['jarvis']);
  });

  it('matches multi-word names with or without the space, and @all', () => {
    expect(parseMentions('@Market Head plan it', team)).toEqual(['n2']);
    expect(parseMentions('@markethead plan it', team)).toEqual(['n2']);
    expect(parseMentions('@all standup please', team).sort()).toEqual(['n1', 'n2', 'n3']);
  });

  it('does not match a longer word or an email', () => {
    expect(parseMentions('@mayank hi', team)).toEqual([]);
    expect(parseMentions('mail me at me@ledger.com', team)).toEqual([]);
    expect(parseMentions('no tags here', team)).toEqual([]);
  });
});

describe('templates', () => {
  it('are all valid NPCs', () => {
    for (const t of NPC_TEMPLATES)
      expect(
        NpcInputSchema.safeParse({ ...t, brain: 'jarvis', enabled: true, templateId: t.id })
          .success,
      ).toBe(true);
  });
});
