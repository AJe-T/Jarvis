/**
 * Calculator app (§5.2a): a small expression parser, so nothing is ever eval'd.
 * Grammar: expr = term (± term)* · term = unary ((× ÷ %) unary)* · unary = −unary | power
 * · power = primary (^ unary)? · primary = number [%] | ( expr ). So −3^2 = −9 like most
 * calculators, and "50%" alone is 0.5.
 */
export function evaluate(input: string): number {
  const src = input.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '');
  let i = 0;
  const peek = (): string => {
    while (src[i] === ' ') i++;
    return src[i] ?? '';
  };
  const eat = (c: string): boolean => {
    if (peek() !== c) return false;
    i++;
    return true;
  };

  function primary(): number {
    if (eat('(')) {
      const v = expr();
      if (!eat(')')) throw new Error('missing )');
      return v;
    }
    peek();
    if (src.startsWith('sqrt', i)) {
      i += 4;
      const v = primary();
      if (v < 0) throw new Error('no square root of a negative number');
      return Math.sqrt(v);
    }
    const m = /^\d*\.?\d+(?:e[+-]?\d+)?/i.exec(src.slice(i));
    if (!m) throw new Error(peek() ? `unexpected "${peek()}"` : 'incomplete');
    i += m[0].length;
    let v = Number(m[0]);
    // "50%" is a percentage unless a number follows (then % is the remainder).
    if (peek() === '%' && !/^%\s*[\d(]/.test(src.slice(i))) {
      i++;
      v /= 100;
    }
    return v;
  }
  function power(): number {
    const base = primary();
    return eat('^') ? base ** unary() : base;
  }
  function unary(): number {
    if (eat('-')) return -unary();
    if (eat('+')) return unary();
    return power();
  }
  function term(): number {
    let v = unary();
    for (;;) {
      if (eat('*')) v *= unary();
      else if (eat('/')) v /= unary();
      else if (eat('%')) v %= unary();
      else return v;
    }
  }
  function expr(): number {
    let v = term();
    for (;;) {
      if (eat('+')) v += term();
      else if (eat('-')) v -= term();
      else return v;
    }
  }

  const v = expr();
  if (peek()) throw new Error(`unexpected "${peek()}"`);
  if (!Number.isFinite(v)) throw new Error('not a number (division by zero?)');
  return v;
}

/** Up to 12 significant digits, without float noise (0.1 + 0.2 → 0.3). */
export function formatResult(v: number): string {
  return String(Number.parseFloat(v.toPrecision(12)));
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const TENS = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
const UNITS = 'one|two|three|four|five|six|seven|eight|nine';

/** Spoken operators → symbols ("into" is Indian English for times). */
const SPOKEN_OPS: Array<[RegExp, string]> = [
  [/\bsquare root of\b/g, ' sqrt '],
  [/\bto the power of\b|\braised to(?: the power of)?\b/g, ' ^ '],
  [/\bsquared\b/g, ' ^ 2 '],
  [/\bcubed\b/g, ' ^ 3 '],
  [/\bper ?cent of\b|% of\b/g, ' % * '],
  [/\bper ?cent\b/g, ' % '],
  [/\bmultiplied by\b|\btimes\b|\binto\b|\bx\b/g, ' * '],
  [/\bdivided by\b|\bover\b/g, ' / '],
  [/\bplus\b/g, ' + '],
  [/\bminus\b|\btake away\b/g, ' - '],
  [/\bmod(?:ulo)?\b/g, ' % '],
];

const ASKED =
  /^(?:please\s+)?(?:(?:can|could)\s+you\s+)?(?:what(?:'s|\s+is)|whats|calculate|compute|how much is|solve|evaluate|work out)\s+/;

/**
 * A plain sum asked in words or symbols ("what is 2+2", "fifteen percent of 2400", "12 × 7 =")
 * → the expression, or null for anything else (a question, a date, a phone number).
 */
export function mathQuestion(raw: string): string | null {
  // A sum is short; long messages go to Jarvis (and never meet these patterns).
  if (raw.length > 200) return null;
  let t = raw
    .toLowerCase()
    .trim()
    .replace(/^(?:hey|ok|okay)\s+/, '')
    .replace(/^jarvis\b[,\s]*/, '')
    .replace(/[?!]+$/, '')
    .replace(/\s*=\s*$/, '')
    .replace(/\.$/, '')
    .trim();
  const asked = ASKED.test(t);
  t = t.replace(ASKED, '').replace(/\bthe\b/g, ' ');
  t = t
    .replace(new RegExp(`\\b(${TENS})[\\s-](${UNITS})\\b`, 'g'), (_m, a: string, b: string) =>
      String((NUMBER_WORDS[a] ?? 0) + (NUMBER_WORDS[b] ?? 0)),
    )
    .replace(/\b[a-z]+\b/g, (w) => (w in NUMBER_WORDS ? String(NUMBER_WORDS[w]) : w));
  for (const [re, op] of SPOKEN_OPS) t = t.replace(re, op);
  t = t.replace(/×/g, '*').replace(/÷/g, '/').replace(/\s+/g, ' ').trim();
  if (!/\d/.test(t) || !/^(?:[\d\s.,+\-*/^%()]|sqrt)+$/.test(t)) return null;
  if (!/[+*/^%]|sqrt|\d\s*-/.test(t)) return null; // needs a sum, not just a number
  // Without "what is…", dates and phone numbers (only dashes, slashes and digits) aren't sums.
  if (!asked && /^[\d\s./-]+$/.test(t)) return null;
  try {
    evaluate(t);
  } catch {
    return null;
  }
  return t;
}
