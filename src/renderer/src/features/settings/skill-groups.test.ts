import { describe, expect, it } from 'vitest';
import { OTHER_GROUP, skillGroup } from './skill-groups';

describe('skillGroup', () => {
  it('files skills by the words in their name and description', () => {
    expect(skillGroup('security-review', 'Checks code for OWASP issues')).toBe('Security');
    expect(skillGroup('frontend-design', 'Distinctive UI components')).toBe('Design & UI');
    expect(skillGroup('python-testing', 'pytest patterns')).toBe('Testing & quality');
    expect(skillGroup('sql-queries', 'Write correct SQL')).toBe('Data & research');
    expect(skillGroup('article-writing', 'Long-form posts in your voice')).toBe(
      'Writing & content',
    );
    expect(skillGroup('invoice-chase', 'Follow up unpaid invoices')).toBe('Business & ops');
    expect(skillGroup('golang-patterns', 'Idiomatic Go')).toBe('Code & dev');
  });

  it('a skill with no telling words lands in Other', () => {
    expect(skillGroup('morning', 'Start the day gently')).toBe(OTHER_GROUP);
  });
});
