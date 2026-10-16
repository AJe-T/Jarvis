import { describe, expect, it } from 'vitest';
import { StagePanelSchema } from '@shared/stage';
import { evaluate, formatResult, mathQuestion } from '@shared/calc';
import { JARVIS_APPS, JARVIS_APP_INFO } from '@shared/jarvis-apps';
import { convert } from './units';
import { APP_ICONS } from '../apps/apps-grid';

describe('Jarvis apps (ADR-040)', () => {
  it('calculates with precedence, brackets, powers, roots, percent and unicode signs', () => {
    expect(evaluate('2 + 3 × 4')).toBe(14);
    expect(evaluate('(2 + 3) * 4')).toBe(20);
    expect(evaluate('2 ^ 3 ^ 2')).toBe(512);
    expect(evaluate('-3 ^ 2')).toBe(-9);
    expect(evaluate('2 ^ -1')).toBe(0.5);
    expect(evaluate('200 × 15%')).toBe(30);
    expect(evaluate('10 % 4')).toBe(2);
    expect(evaluate('sqrt 16 + sqrt(9)')).toBe(7);
    expect(evaluate('1,200 ÷ 4 − 0.5')).toBe(299.5);
    expect(formatResult(evaluate('0.1 + 0.2'))).toBe('0.3');
  });

  it('refuses bad input instead of guessing (and never evals)', () => {
    expect(() => evaluate('2 +')).toThrow();
    expect(() => evaluate('(1 + 2')).toThrow('missing )');
    expect(() => evaluate('1 / 0')).toThrow('division by zero');
    expect(() => evaluate('alert(1)')).toThrow();
  });

  it('understands sums asked in words or symbols', () => {
    expect(mathQuestion('What is 2+2?')).toBe('2+2');
    expect(mathQuestion('Jarvis, what is two plus two')).toBe('2 + 2');
    expect(evaluate(mathQuestion('fifteen percent of 2400') ?? '')).toBe(360);
    expect(evaluate(mathQuestion("what's twenty five times 4") ?? '')).toBe(100);
    expect(evaluate(mathQuestion('calculate 12 into 3') ?? '')).toBe(36);
    expect(evaluate(mathQuestion('what is the square root of 81') ?? '')).toBe(9);
    expect(evaluate(mathQuestion('7 squared') ?? '')).toBe(49);
    expect(mathQuestion('12 × 7 =')).toBe('12 * 7');
  });

  it('leaves questions, single numbers, dates and phone numbers to Jarvis', () => {
    expect(mathQuestion('what is the time')).toBeNull();
    expect(mathQuestion('what is 5')).toBeNull();
    expect(mathQuestion('2026-10-15')).toBeNull();
    expect(mathQuestion('98480-12345')).toBeNull();
    expect(mathQuestion('how much is 3 kg in pounds')).toBeNull();
    expect(mathQuestion('open spotify')).toBeNull();
  });

  it('converts units, temperature included', () => {
    expect(convert(1, 'length', 'mi', 'km')).toBeCloseTo(1.609344);
    expect(convert(100, 'temperature', 'C', 'F')).toBeCloseTo(212);
    expect(convert(0, 'temperature', 'K', 'C')).toBeCloseTo(-273.15);
    expect(convert(1, 'data', 'GiB', 'MB')).toBeCloseTo(1073.741824);
    expect(() => convert(1, 'length', 'm', 'kg')).toThrow('unknown unit');
  });

  it('every app has an icon and opens a panel the stage knows (QR starts empty for typing)', () => {
    for (const id of JARVIS_APPS) {
      const { panel } = JARVIS_APP_INFO[id];
      expect(APP_ICONS[id], id).toBeTruthy();
      expect(StagePanelSchema.safeParse(panel).success || panel.kind === 'qr', id).toBe(true);
    }
  });
});
