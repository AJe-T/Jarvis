import { describe, expect, it } from 'vitest';
import { COVERS, coverClass, readMeta, withFrontmatter } from './page-meta';

describe('Spaces page meta', () => {
  it('adds a key to a page with no frontmatter', () => {
    expect(withFrontmatter('', 'icon', '📈')).toBe('---\nicon: 📈\n---\n');
  });

  it('replaces one key and keeps the others', () => {
    const fm = '---\ntags:\n  - money\nicon: 📚\n---\n';
    const next = withFrontmatter(fm, 'icon', '💰');
    expect(next).toContain('icon: 💰');
    expect(next).toContain('- money');
    expect(next).not.toContain('📚');
  });

  it('removes the block when the last key goes', () => {
    expect(withFrontmatter('---\ncover: grid\n---\n', 'cover', undefined)).toBe('');
  });

  it('leaves unreadable YAML alone instead of overwriting it', () => {
    const broken = '---\n: : [\n---\n';
    expect(withFrontmatter(broken, 'icon', '⭐')).toBe(broken);
  });

  it('reads icon and cover back, ignoring other keys and bad YAML', () => {
    expect(readMeta('---\nicon: 💰\ncover: hazard\ntags: [a]\n---\n')).toEqual({
      icon: '💰',
      cover: 'hazard',
    });
    expect(readMeta('')).toEqual({});
    expect(readMeta('---\n: : [\n---\n')).toEqual({});
  });

  it('uses the chosen cover, else a stable one from the name', () => {
    expect(coverClass('Budget', 'hazard')).toBe('cover cover-hazard');
    expect(coverClass('Budget', 'not-a-cover')).toBe(coverClass('Budget'));
    expect(COVERS.map((c) => `cover cover-${c}`)).toContain(coverClass('Anything'));
  });
});
