import { describe, expect, it } from 'vitest';
import { isProtected, parseNameStatus, reviewDiff, splitPatch } from './protected';

const patchOf = (path: string, added: string[], removed: string[] = []): string =>
  [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,2 +1,2 @@',
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
  ].join('\n');

describe('Forge protected paths', () => {
  it('covers the safety code, the rules and Forge itself, in any case or separator', () => {
    expect(isProtected('src/main/security/policy-engine.ts')).toBe(true);
    expect(isProtected('src\\main\\Security\\guards.ts')).toBe(true);
    expect(isProtected('./src/main/forge/boss.ts')).toBe(true);
    expect(isProtected('package.json')).toBe(true);
    expect(isProtected('.claude/settings.json')).toBe(true);
    expect(isProtected('docs/Security.md')).toBe(true);
    expect(isProtected('src/main/tools/everyday/video.ts')).toBe(false);
    expect(isProtected('docs/BIBLE.md')).toBe(false);
    // A file whose name only starts like a protected file is not protected.
    expect(isProtected('package.json.bak')).toBe(false);
  });

  it('protects test setup, env files and tsconfig variants by prefix', () => {
    for (const p of [
      'tests/setup.ts',
      '.env',
      '.env.local',
      'tsconfig.e2e.json',
      'src/shared/forge.ts',
    ])
      expect(isProtected(p)).toBe(true);
    expect(isProtected('src/.envelope.ts')).toBe(false);
  });

  it('a file Sir approved by name is allowed; approving a file never opens its folder', () => {
    expect(isProtected('src/main/security/guards.ts', ['src/main/security/guards.ts'])).toBe(false);
    expect(isProtected('src/main/security/redact.ts', ['src/main/security/guards.ts'])).toBe(true);
    expect(isProtected('src/main/security/redact.ts', ['src/main/security/'])).toBe(true);
  });
});

describe('Forge diff review', () => {
  it('parses NUL-separated git name-status, renames and non-ASCII names included', () => {
    expect(
      parseNameStatus('M\0src/a.ts\0R096\0src/old.test.ts\0src/new.ts\0D\0tests/é.test.ts\0'),
    ).toEqual([
      { status: 'M', path: 'src/a.ts' },
      { status: 'R', path: 'src/new.ts', from: 'src/old.test.ts' },
      { status: 'D', path: 'tests/é.test.ts' },
    ]);
  });

  it('reads "++" and "--" lines inside a hunk as content, not headers', () => {
    const p = patchOf('a.test.ts', ["++n; test.skip('x', () => {});"], ['-- old']);
    expect(splitPatch(p).get('a.test.ts')).toEqual({
      added: ["++n; test.skip('x', () => {});"],
      removed: ['-- old'],
    });
    expect(reviewDiff([{ status: 'M', path: 'a.test.ts' }], p)[0]?.severity).toBe('block');
  });

  it('blocks removed test cases, .fails, bracket and next-line skips', () => {
    const verdict = (added: string[], removed: string[] = []) =>
      reviewDiff([{ status: 'M', path: 'a.test.ts' }], patchOf('a.test.ts', added, removed)).map(
        (f) => f.severity,
      );
    expect(verdict([], ["it('one', () => {});"])).toEqual(['block']);
    expect(verdict(["it.fails('x', () => {})"])).toEqual(['block']);
    expect(verdict(["it['skip']('x', () => {})"])).toEqual(['block']);
    expect(verdict(['  .skip(', "  'x',"])).toEqual(['block']);
    // A regex .test( is not a test case.
    expect(verdict([], ['expect(/a/.test(s)).toBe(true);'])).toEqual(['warn']);
  });

  it('blocks switching checks off for a file, warns for one line, in any file', () => {
    const verdict = (line: string) =>
      reviewDiff([{ status: 'M', path: 'src/a.ts' }], patchOf('src/a.ts', [line])).map(
        (f) => f.severity,
      );
    expect(verdict('// @ts-nocheck')).toEqual(['block']);
    expect(verdict('/* eslint-disable */')).toEqual(['block']);
    expect(verdict('// eslint-disable-next-line no-console')).toEqual(['warn']);
    expect(verdict('// @ts-expect-error old types')).toEqual(['warn']);
  });

  it('splits a patch into added and removed lines per file', () => {
    const files = splitPatch(patchOf('a.test.ts', ['new'], ['old']));
    expect(files.get('a.test.ts')).toEqual({ added: ['new'], removed: ['old'] });
  });

  it('blocks protected changes, deleted tests and tests renamed away', () => {
    const findings = reviewDiff(
      [
        { status: 'M', path: 'src/main/security/guards.ts' },
        { status: 'D', path: 'src/main/foo.test.ts' },
        { status: 'R', path: 'src/main/bar.ts', from: 'src/main/bar.test.ts' },
        { status: 'M', path: 'src/main/ok.ts' },
      ],
      '',
    );
    expect(findings.map((f) => [f.severity, f.path])).toEqual([
      ['block', 'src/main/security/guards.ts'],
      ['block', 'src/main/foo.test.ts'],
      ['block', 'src/main/bar.test.ts'],
    ]);
  });

  it('a rename out of a protected folder still counts as touching it', () => {
    const findings = reviewDiff(
      [{ status: 'R', path: 'src/main/util/guards.ts', from: 'src/main/security/guards.ts' }],
      '',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.path).toBe('src/main/security/guards.ts');
  });

  it('blocks skipped, todo and .only tests; warns when assertions disappear', () => {
    for (const line of [
      "it.skip('x', () => {})",
      "describe.only('x', () => {})",
      "xit('x')",
      "test.todo('x')",
    ])
      expect(
        reviewDiff([{ status: 'M', path: 'a.test.ts' }], patchOf('a.test.ts', [line])).map(
          (f) => f.severity,
        ),
      ).toEqual(['block']);
    const fewer = reviewDiff(
      [{ status: 'M', path: 'a.test.ts' }],
      patchOf('a.test.ts', ['expect(a).toBe(1);'], ['expect(a).toBe(1);', 'expect(b).toBe(2);']),
    );
    expect(fewer).toEqual([
      { path: 'a.test.ts', severity: 'warn', problem: '1 assertion fewer than before' },
    ]);
  });

  it('ignores skip words outside test files and ordinary test changes', () => {
    expect(
      reviewDiff(
        [
          { status: 'M', path: 'src/a.ts' },
          { status: 'A', path: 'src/b.test.ts' },
        ],
        patchOf('src/a.ts', ['it.skip()']) +
          '\n' +
          patchOf('src/b.test.ts', ["it('works', () => expect(1).toBe(1));"]),
      ),
    ).toEqual([]);
  });
});
