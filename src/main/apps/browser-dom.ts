/**
 * Scripts Jarvis Browser runs inside the open page (idea from camofox-browser: an accessibility-style
 * outline with stable element refs instead of raw HTML, ~90% smaller). They run in an ISOLATED world:
 * the page shares the DOM but can't see or change these variables, so it can't tamper with the refs.
 * Only visible text and controls are listed (hidden text is a classic injection trick; Security.md §6.7).
 * Plain JavaScript strings, so bundling can't change them.
 */

/** One control in the outline; main keeps these to judge and describe actions on them. */
export interface RefInfo {
  ref: string;
  role: string;
  name: string;
  tag: string;
  /** input type; a <button> in a form is 'submit' (its default); otherwise '' */
  type: string;
  /** Everything the control says about itself (label, visible text, title, value), for judging risk. */
  text?: string;
  href?: string;
  /** Typing here is refused: passwords, card numbers, one-time codes, PINs. */
  secret?: boolean;
}

export interface Snapshot {
  url: string;
  title: string;
  lines: string[];
  refs: RefInfo[];
  truncated: boolean;
}

/** Outline caps: enough for a real page, small for the model. */
export const SNAPSHOT_MAX_LINES = 600;
export const SNAPSHOT_MAX_CHARS = 24_000;

/**
 * Helpers kept in the isolated world (window.__jarvisLib) so later actions judge a control exactly
 * as the snapshot did.
 */
const LIB_JS = `
  const clean = (s, n) => (s || '').replace(/\\s+/g, ' ').trim().slice(0, n);
  const labelText = (el) => {
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = by.split(/\\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' '); if (clean(t, 80)) return t; }
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return l.innerText; }
    const wrap = el.closest('label'); if (wrap) return wrap.innerText;
    return '';
  };
  const buttonValue = (el) => (el.tagName === 'INPUT' && /^(submit|button|reset)$/i.test(el.type) ? el.value : '');
  const nameOf = (el) => clean(el.getAttribute('aria-label') || labelText(el) || el.getAttribute('placeholder') ||
    el.getAttribute('title') || el.getAttribute('alt') || buttonValue(el) ||
    el.innerText || el.querySelector('img[alt]')?.getAttribute('alt') || '', 80);
  // Judged on everything the control shows or claims, so an aria-label can't hide a visible "Pay".
  const textOf = (el) => clean([el.getAttribute('aria-label'), labelText(el), el.innerText, el.getAttribute('title'),
    el.getAttribute('alt'), buttonValue(el)].filter(Boolean).join(' '), 300);
  const typeOf = (el) => {
    if (el.tagName === 'INPUT') return (el.type || 'text').toLowerCase();
    // A <button> in a form submits it unless it says otherwise.
    if (el.tagName === 'BUTTON') return el.form ? (el.getAttribute('type') || 'submit').toLowerCase() : 'button';
    return '';
  };
  const secretOf = (el) => {
    const t = (el.getAttribute('type') || '').toLowerCase(), ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    const id = ((el.getAttribute('name') || '') + ' ' + (el.id || '')).toLowerCase();
    return t === 'password' || /password|one-time-code|cc-(number|csc|exp)/.test(ac) ||
      /pass|otp|cvv|cvc|(^|[^a-z])pin([^a-z]|$)|ssn|card.?(no|num)/.test(id);
  };
  window.__jarvisLib = { clean, nameOf, textOf, typeOf, secretOf };
`;

export const SNAPSHOT_JS = `(() => {
  const MAX_LINES = ${SNAPSHOT_MAX_LINES}, MAX_CHARS = ${SNAPSHOT_MAX_CHARS};
  ${LIB_JS}
  const state = (window.__jarvisRefs = []);
  const lines = []; const refs = []; let chars = 0; let truncated = false;
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','SVG','CANVAS','IFRAME','OBJECT','HEAD']);
  const ROLES = { A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', SUMMARY: 'button' };
  const INPUT_ROLES = { checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button', reset: 'button',
    image: 'button', range: 'slider', search: 'searchbox', file: 'file' };
  const INNER = 'a[href],button,input,select,textarea,[role],[onclick],[tabindex],[contenteditable],h1,h2,h3,h4,h5,h6';
  const visible = (el) => {
    if (el.getAttribute('aria-hidden') === 'true' || el.hidden) return false;
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    // display:contents has no box of its own; its children do.
    if (st.display === 'contents') return true;
    // Custom switches hide the real checkbox (opacity 0) under a styled label: keep it.
    const toggle = el.tagName === 'INPUT' && /^(checkbox|radio)$/i.test(el.type);
    if (!toggle && Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return toggle || (r.width > 1 && r.height > 1);
  };
  const roleOf = (el) => {
    const aria = el.getAttribute('role');
    if (aria && /^(button|link|checkbox|radio|tab|menuitem|option|switch|textbox|combobox|searchbox|slider)$/.test(aria)) return aria;
    if (el.tagName === 'A') return el.hasAttribute('href') ? 'link' : '';
    if (el.tagName === 'INPUT') { const t = (el.type || 'text').toLowerCase(); return t === 'hidden' ? '' : INPUT_ROLES[t] || 'textbox'; }
    if (ROLES[el.tagName]) return ROLES[el.tagName];
    if (el.isContentEditable && el.getAttribute('contenteditable') !== null) return 'textbox';
    // Custom controls (click handler in markup, or focusable on purpose), but never a container of
    // other controls: a <main tabindex=0> or <div id=app onclick> must not swallow its content.
    const custom = el.hasAttribute('onclick') || (el.hasAttribute('tabindex') && Number(el.getAttribute('tabindex')) >= 0);
    if (custom && !el.querySelector(INNER)) return 'button';
    return '';
  };
  const push = (line) => {
    if (truncated) return;
    if (lines.length >= MAX_LINES || chars + line.length > MAX_CHARS) { truncated = true; return; }
    lines.push(line); chars += line.length + 1;
  };
  let textBuf = ''; let quiet = 0;
  const flushText = () => { const t = clean(textBuf, 300); textBuf = ''; if (t.length > 1) push('- text: ' + t); };
  const control = (child, role) => {
    flushText();
    const ref = 'e' + (state.length + 1);
    state.push(child);
    const name = nameOf(child);
    const info = { ref, role, name, tag: child.tagName.toLowerCase(), type: typeOf(child), text: textOf(child) };
    if (role === 'link') info.href = clean(child.href, 300);
    if (secretOf(child)) info.secret = true;
    refs.push(info);
    let line = '- ' + role + (name ? ' "' + name + '"' : '') + ' [' + ref + ']';
    if (role === 'link' && info.href) line += ' -> ' + info.href;
    if (role === 'checkbox' || role === 'radio' || role === 'switch') line += child.checked || child.getAttribute('aria-checked') === 'true' ? ' (checked)' : '';
    if (role === 'textbox' || role === 'searchbox') line += info.secret ? ' (secret field)' : ' value="' + clean(child.value ?? child.innerText, 60) + '"';
    if (role === 'combobox' && child.tagName === 'SELECT') {
      const opts = Array.from(child.options).map((o) => clean(o.text, 30)).slice(0, 15);
      line += ' value="' + clean(child.options[child.selectedIndex]?.text, 40) + '" options: ' + opts.join(' | ');
    }
    if (child.disabled) line += ' (disabled)';
    push(line);
  };
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (truncated) return;
      if (child.nodeType === 3) { if (!quiet) textBuf += ' ' + child.nodeValue; continue; }
      if (child.nodeType !== 1 || SKIP.has(child.tagName)) continue;
      if (!visible(child)) continue;
      const role = roleOf(child);
      if (role) { control(child, role); continue; }
      if (/^H[1-6]$/.test(child.tagName)) {
        // The heading's words once, then its links (search results and cards are <h3><a>).
        flushText();
        push('- heading "' + clean(child.innerText, 120) + '" (' + child.tagName.toLowerCase() + ')');
        quiet++; walk(child); quiet--;
        continue;
      }
      const block = /^(P|DIV|LI|SECTION|ARTICLE|TR|TD|TH|DD|DT|BLOCKQUOTE|PRE|HEADER|FOOTER|NAV|MAIN|ASIDE|FORM|UL|OL|TABLE)$/.test(child.tagName);
      if (block) flushText();
      walk(child);
      if (block) flushText();
    }
  };
  if (document.body) walk(document.body);
  flushText();
  return { url: location.href, title: document.title, lines, refs, truncated };
})()`;

const call = (body: string, args: Record<string, unknown>): string =>
  `(() => { const A = ${JSON.stringify(args)}; const L = window.__jarvisLib;
  const el = (window.__jarvisRefs || [])[Number(String(A.ref).slice(1)) - 1];
  if (!L || !el || !el.isConnected) return { error: 'stale' };
  ${body} })()`;

/**
 * Scrolls the control into view, waits for layout to settle, and returns the middle of it for a real
 * (trusted) mouse click, with what the control says about itself NOW. Refuses when something else is
 * on top of that point (an overlay, a cookie banner, a frame laid over a button).
 */
export const pointJs = (ref: string): string =>
  call(
    `el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  return new Promise((done) => setTimeout(() => {
    if (!el.isConnected) return done({ error: 'stale' });
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return done({ error: 'hidden' });
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
    let hit = document.elementFromPoint(x, y);
    while (hit && hit.shadowRoot) { const inner = hit.shadowRoot.elementFromPoint(x, y); if (!inner || inner === hit) break; hit = inner; }
    const labels = el.labels ? Array.from(el.labels) : [];
    const mine = hit && (hit === el || el.contains(hit) || labels.some((l) => l.contains(hit)));
    if (!mine) return done({ error: 'covered' });
    done({ x, y, name: L.nameOf(el), type: L.typeOf(el), text: L.textOf(el) });
  }, 60));`,
    { ref },
  );

/** Focuses a text field (optionally selecting what is in it) so typed text replaces it. */
export const focusJs = (ref: string, clear: boolean): string =>
  call(
    `if (L.secretOf(el)) return { error: 'secret' };
  const t = (el.getAttribute('type') || '').toLowerCase();
  const editable = el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(checkbox|radio|submit|button|reset|file|image|range|color|hidden)$/.test(t || 'text'));
  if (!editable) return { error: 'not-text' };
  el.scrollIntoView({ block: 'center', behavior: 'instant' });
  el.focus();
  // A page can move the focus away from inside focus(): the text must go where Sir approved.
  const now = document.activeElement;
  if (!now || !(now === el || el.contains(now))) return { error: 'focus-moved' };
  if (A.clear) { if (typeof el.select === 'function') el.select(); else document.execCommand('selectAll'); }
  return { ok: true };`,
    { ref, clear },
  );

/** Picks an option of a <select> by its text or value. */
export const selectJs = (ref: string, option: string): string =>
  call(
    `if (el.tagName !== 'SELECT') return { error: 'not-select' };
  const want = String(A.option).trim().toLowerCase();
  const o = Array.from(el.options).find((x) => x.text.trim().toLowerCase() === want || x.value.toLowerCase() === want)
    || Array.from(el.options).find((x) => x.text.trim().toLowerCase().includes(want));
  if (!o) return { error: 'no-option', options: Array.from(el.options).map((x) => x.text.trim()).slice(0, 30) };
  el.value = o.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true, chosen: o.text.trim() };`,
    { ref, option },
  );

export const scrollJs = (direction: 'up' | 'down' | 'top' | 'bottom'): string =>
  `(() => { const d = ${JSON.stringify(direction)};
  if (d === 'top') scrollTo(0, 0); else if (d === 'bottom') scrollTo(0, document.documentElement.scrollHeight);
  else scrollBy(0, (d === 'down' ? 1 : -1) * Math.round(innerHeight * 0.8));
  return { y: Math.round(scrollY), max: Math.max(0, document.documentElement.scrollHeight - innerHeight) }; })()`;

/** Words on a button or link whose click commits something: Sir confirms those clicks. */
const RISKY_WORDS = [
  'buy',
  'purchase',
  'order',
  'checkout',
  'check out',
  'pay',
  'payment',
  'place',
  'book',
  'reserve',
  'subscribe',
  'donate',
  'transfer',
  'withdraw',
  'send',
  'submit',
  'post',
  'publish',
  'share',
  'tweet',
  'reply',
  'comment',
  'apply',
  'confirm',
  'approve',
  'authorize',
  'authorise',
  'allow',
  'grant',
  'agree',
  'accept',
  'complete',
  'finish',
  'save',
  'invite',
  'follow',
  'sign up',
  'register',
  'create account',
  'delete',
  'remove',
  'unsubscribe',
  'cancel',
  'deactivate',
  'install',
  'download',
  'upload',
  'log out',
  'logout',
  'sign out',
];
const DESTRUCTIVE_WORDS = [
  'delete',
  'remove',
  'close account',
  'deactivate',
  'cancel subscription',
  'cancel order',
];

const hasWord = (text: string, words: string[]): boolean => {
  const t = ` ${text.toLowerCase().replace(/[^a-z]+/g, ' ')} `;
  return words.some((w) => t.includes(` ${w} `));
};

/**
 * A click that commits something: anything that submits a form (submit buttons, a <button> inside a
 * form, image inputs) or a control whose label, text or title says Buy, Send, Delete…
 */
export function isRiskyClick(info: Pick<RefInfo, 'name' | 'type' | 'text'>): boolean {
  return (
    info.type === 'submit' ||
    info.type === 'image' ||
    hasWord(`${info.name} ${info.text ?? ''}`, RISKY_WORDS)
  );
}

export function isDestructiveClick(info: Pick<RefInfo, 'name' | 'text'>): boolean {
  return hasWord(`${info.name} ${info.text ?? ''}`, DESTRUCTIVE_WORDS);
}

/** Formats a snapshot for Claude: header plus the outline. */
export function formatSnapshot(s: Snapshot): string {
  const head = `Page: ${s.title.slice(0, 200) || '(untitled)'}\nURL: ${s.url}\nControls are marked [e1], [e2]…; use those refs with browser_act / browser_type.`;
  const tail = s.truncated ? '\n…(page continues: scroll down and take another snapshot)' : '';
  return `${head}\n\n${s.lines.join('\n') || '(nothing visible)'}${tail}`;
}
