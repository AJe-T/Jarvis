import { describe, expect, it } from 'vitest';
import { designFindings } from './design-check';

const TSX = 'src/renderer/src/features/x/x.tsx';
const CSS = 'src/renderer/src/features/x/x.css';

function check(path: string, lines: string[], whole = lines.join('\n')) {
  return designFindings(new Map([[path, [lines]]]), () => whole);
}

const blocks = (f: ReturnType<typeof check>): number =>
  f.filter((x) => x.severity === 'block').length;

describe('Forge design check', () => {
  it('passes interface code that follows the design system', () => {
    expect(
      check(TSX, [
        "import { Mic } from 'lucide-react';",
        '<button className="text-sm bg-surface-1 text-ink-300" tabIndex={0}>',
        '<a href="#section">Jump</a>',
      ]),
    ).toEqual([]);
  });

  it.each([
    ['raw colour', '<p style={{ color: "#ff00ff" }}>'],
    ['rgba colour', "const glow = 'rgba(0, 255, 255, .4)';"],
    ['tailwind arbitrary colour', '<div className="bg-[#123456]">'],
    ['fixed text size', '<span className="text-[11px]">'],
    ['foreign icon library', "import { FaBeer } from 'react-icons/fa';"],
    ['positive tabIndex', '<div tabIndex={2}>'],
  ])('blocks %s in a component', (_name, line) => {
    expect(blocks(check(TSX, [line]))).toBe(1);
  });

  it('blocks a removed focus outline unless the file styles :focus-visible', () => {
    expect(blocks(check(CSS, ['.btn { outline: none; }']))).toBe(1);
    expect(
      blocks(
        check(
          CSS,
          ['.btn { outline: none; }'],
          '.btn{outline:none}\n.btn:focus-visible{outline:2px solid var(--accent)}',
        ),
      ),
    ).toBe(0);
  });

  it('warns (does not block) on reflexes', () => {
    const f = check(CSS, [
      '.card { transition: height 200ms; }',
      '@keyframes spin { to { transform: rotate(1turn); } }',
      '.hero { background: linear-gradient(90deg, #8b5cf6, #3b82f6); }',
      '.t { font-family: Inter, sans-serif; }',
      '.x { color: red !important; }',
    ]);
    expect(blocks(f)).toBe(0);
    expect(f.map((x) => x.problem.split(':')[0])).toEqual([
      'raw colour outside the token sheets',
      'animates a layout property',
      'new motion with no prefers-reduced-motion rule in the file',
      'purple-to-blue gradient',
      'a font outside the system',
      '!important',
    ]);
  });

  it('allows raw colours in the token sheets and motion with a reduced-motion rule', () => {
    expect(check('src/renderer/src/styles/tokens.css', ['--neon-cyan: #00f0ff;'])).toEqual([]);
    expect(
      check(
        CSS,
        ['.o { animation: pulse 2s infinite; }'],
        '@media (prefers-reduced-motion: reduce) {}',
      ),
    ).toEqual([]);
  });

  it('reads only interface files and ignores comments', () => {
    expect(check('src/main/a.ts', ["const c = '#ff00ff';"])).toEqual([]);
    expect(check(TSX, ['// was #ff00ff before'])).toEqual([]);
  });
});

describe('Forge design check: no false alarms seen in real Jarvis code', () => {
  it('lets three.js and canvas code use raw colours', () => {
    const lines = ["const SKY = '#14161c';"];
    expect(check(TSX, lines, "import * as THREE from 'three';\nconst SKY = '#14161c';")).toEqual(
      [],
    );
    expect(check(TSX, lines, "g.fillStyle = 'rgba(4,8,16,0.82)';")).toEqual([]);
  });

  it('accepts outline-none when the same element has a focus style', () => {
    expect(check(TSX, ['className="border outline-none focus:border-accent-edge"'])).toEqual([]);
  });
});
