import { describe, expect, it } from 'vitest';
import { AUTOMATION_TEMPLATES } from './automation-templates';
import { ScheduleSchema } from './schedule';

describe('automation templates', () => {
  it('all have a unique id and name, a valid schedule and a prompt the save accepts', () => {
    const ids = AUTOMATION_TEMPLATES.map((t) => t.id);
    const names = AUTOMATION_TEMPLATES.map((t) => t.name);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    for (const t of AUTOMATION_TEMPLATES) {
      expect(ScheduleSchema.safeParse(t.schedule).success, t.id).toBe(true);
      expect(t.prompt.length, t.id).toBeGreaterThanOrEqual(5);
      expect(t.prompt.length, t.id).toBeLessThanOrEqual(2000);
      expect(t.name.length, t.id).toBeLessThanOrEqual(60);
    }
  });

  it('offers meeting prep before each calendar event, and the two other event templates', () => {
    const byId = new Map(AUTOMATION_TEMPLATES.map((t) => [t.id, t]));
    expect(byId.get('meeting-prep')?.schedule).toEqual({ type: 'beforeEvent', minutes: 10 });
    expect(byId.get('meeting-prep')?.prompt).toMatch(/search_memory/);
    expect(byId.get('overdue-nudge')?.schedule).toEqual({ type: 'taskOverdue' });
    expect(byId.get('new-download')?.schedule.type).toBe('newFile');
  });
});
