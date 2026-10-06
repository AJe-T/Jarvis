import { describe, expect, it } from 'vitest';
import { openDatabase, migrate } from './connection';
import { keywords, toFtsQuery } from './fts-query';

describe('fts-query', () => {
  it('drops stopwords and punctuation', () => {
    expect(keywords('What did we decide about the GST toggle?')).toEqual([
      'decide',
      'gst',
      'toggle',
    ]);
  });

  it('quotes terms so FTS operators are inert', () => {
    expect(toFtsQuery('rate NEAR calculator OR "x" AND NOT y*')).toBe(
      '"rate" OR "near" OR "calculator"',
    );
  });

  it('returns null for an empty or all-stopword query', () => {
    expect(toFtsQuery('')).toBeNull();
    expect(toFtsQuery('what is the')).toBeNull();
  });

  it('produces queries SQLite accepts', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    const q = toFtsQuery('weird "quotes" ( ) * ^ - : NEAR/3 {col}');
    expect(() =>
      db.prepare('SELECT * FROM messages_fts WHERE messages_fts MATCH ?').all(q),
    ).not.toThrow();
  });
});
