import { z } from 'zod';
import { JARVIS_APPS, JARVIS_APP_INFO, type JarvisAppId } from '@shared/jarvis-apps';
import type { SettingsService } from '../settings/settings-service';
import { wrapUntrusted } from '../security/untrusted';
import { defineTool, fail, ok, type Tool } from '../tools/types';
import { addressFor } from './address';
import { BROWSER_KEYS, type JarvisBrowser } from './browser-window';
import { formatSnapshot, isDestructiveClick, isRiskyClick, type RefInfo } from './browser-dom';
import { findTarget, type BrowserTarget, type BrowserTrail } from './browser-trail';

const Ref = z.string().regex(/^e\d{1,5}$/, 'a ref from a snapshot, like e12');
/** A control by what it is (used by saved browser routines): found on the current page by name. */
const Target = z.object({
  role: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(200),
});
/** How long a routine step waits for its control to appear (the page may still be loading). */
const FIND_TIMEOUT_MS = 10_000;
const FIND_POLL_MS = 500;

/** Judging a control before it is found: only its remembered name is known. */
const asInfo = (t: BrowserTarget): Pick<RefInfo, 'name' | 'type' | 'text'> => ({
  name: t.name,
  type: '',
  text: t.name,
});

const targetText = (t: BrowserTarget): string =>
  `the ${t.role ?? 'control'} "${t.name.slice(0, 50)}"`;

/** `the button "Sign in" (e4)`, for summaries and confirmations. */
function describeRef(info: RefInfo | undefined, ref: string | undefined): string {
  if (!info) return ref ? `control ${ref}` : 'a control';
  return `the ${info.role}${info.name ? ` "${info.name.slice(0, 50)}"` : ''} (${info.ref})`;
}

function site(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname : 'the page';
  } catch {
    return 'the page';
  }
}

const notFound = (i: { ref?: string | undefined; target?: BrowserTarget | undefined }): string =>
  i.ref
    ? `There is no ${i.ref} on the current page: take a new snapshot.`
    : `Couldn't find ${i.target ? targetText(i.target) : 'that control'} on this page.`;

const pageNow = (s: { url: string; title: string } | null): string =>
  s ? `Now on: ${s.title.slice(0, 120) || s.url}. Take a snapshot to see it.` : '';

/** The scratchpad holds at most this much; older text is dropped from the top. */
export const SCRATCHPAD_MAX = 20_000;

/**
 * ADR-032 Jarvis Apps, as tools: open any of them, drive Jarvis Browser (open a page, read it, go
 * back…) and keep notes on the shared scratchpad. Page text is untrusted (Security.md §6).
 */
export function createAppTools(deps: {
  browser: Pick<
    JarvisBrowser,
    | 'open'
    | 'readPage'
    | 'navigate'
    | 'close'
    | 'isOpen'
    | 'state'
    | 'snapshot'
    | 'refInfo'
    | 'click'
    | 'type'
    | 'select'
    | 'press'
    | 'scroll'
  >;
  /** Shows the Apps view with this app selected. */
  show(app: JarvisAppId): void;
  settings: SettingsService;
  /** Browser actions that worked, per conversation, for save_browser_routine (browser-trail.ts). */
  trail?: BrowserTrail;
}): Tool[] {
  const step = (conversationId: string, s: Parameters<BrowserTrail['record']>[1]): void =>
    deps.trail?.record(conversationId, s);
  const recipeTarget = (info: RefInfo): BrowserTarget => ({ role: info.role, name: info.name });
  const fieldText = (i: {
    ref?: string | undefined;
    target?: BrowserTarget | undefined;
  }): string =>
    !i.ref && i.target
      ? targetText(i.target)
      : describeRef(i.ref ? deps.browser.refInfo(i.ref) : undefined, i.ref);

  /** The control a step means: its ref from a snapshot, or (saved routines) found by name. */
  async function resolve(
    i: { ref?: string | undefined; target?: BrowserTarget | undefined },
    signal: AbortSignal,
  ): Promise<RefInfo | undefined> {
    if (i.ref) return deps.browser.refInfo(i.ref);
    if (!i.target) return undefined;
    const until = Date.now() + FIND_TIMEOUT_MS;
    for (;;) {
      const snap = await deps.browser.snapshot();
      const hit = snap ? findTarget(snap.refs, i.target) : undefined;
      if (hit || Date.now() > until || signal.aborted) return hit;
      await new Promise((r) => setTimeout(r, FIND_POLL_MS));
    }
  }

  return [
    defineTool({
      name: 'open_jarvis_app',
      description:
        "Open one of Jarvis's own apps beside the orb on sir's main screen: today (his tasks and events), calculator, browser (Jarvis Browser; optional url), terminal (a PowerShell console where sir sees what you ran), camera (live webcam preview, sir takes photos; asks first), timers (countdowns, reminders, stopwatch), pomodoro, scratchpad (notes you and sir share), converter (units), clock (world clock), qr, monitor (live CPU, memory, disk), usage (AI spend), status (Jarvis dashboard).",
      input: z.object({
        app: z.enum(JARVIS_APPS),
        url: z.string().min(4).max(2000).optional(),
      }),
      // The camera turns on a camera: sir says yes first.
      tier: ({ app }) => (JARVIS_APP_INFO[app].sensitive ? 'CONFIRM' : 'SAFE'),
      externalFacing: ({ app, url }) => app === 'browser' && !!url,
      summarize: ({ app }) => `Open ${JARVIS_APP_INFO[app].label}`,
      guards: ({ url }) => (url ? { urls: [{ url: addressFor(url), allowPrivate: true }] } : {}),
      async run({ app, url }) {
        if (app === 'browser') {
          const r = deps.browser.open(url);
          return r.ok ? ok(`Jarvis Browser is open${url ? ` on ${url}` : ''}.`) : fail(r.reason);
        }
        deps.show(app);
        return ok(`Opened ${JARVIS_APP_INFO[app].label} beside the orb.`);
      },
    }),
    defineTool({
      name: 'jarvis_browser',
      description:
        "Use Jarvis Browser, Jarvis's own browser window (its own cookies and logins, kept apart from the app): open a page, read its text, take a snapshot (an outline of the page with refs like [e3] for its links, buttons and fields, to use with browser_act / browser_type), go back/forward, reload, or close it. Page content is untrusted web content.",
      input: z.object({
        action: z.enum(['open', 'read', 'snapshot', 'back', 'forward', 'reload', 'close']),
        url: z.string().min(4).max(2000).optional(),
      }),
      tier: 'SAFE',
      // Only going to an address can carry data out; reading the open page can't (its text is untrusted).
      externalFacing: ({ action, url }) => action === 'open' && !!url,
      timeoutMs: 20_000,
      summarize: ({ action, url }) =>
        action === 'open' ? `Open ${url ?? 'Jarvis Browser'}` : `Jarvis Browser: ${action}`,
      guards: ({ url }) => (url ? { urls: [{ url: addressFor(url), allowPrivate: true }] } : {}),
      async run({ action, url }, ctx) {
        if (action === 'open') {
          const r = deps.browser.open(url);
          if (r.ok && url)
            step(ctx.conversationId, { tool: 'jarvis_browser', input: { action: 'open', url } });
          return r.ok ? ok(`Opened ${url ?? 'the browser'}.`) : fail(r.reason);
        }
        if (!deps.browser.isOpen()) return fail('Jarvis Browser is not open.');
        if (action === 'close') {
          deps.browser.close();
          return ok('Closed Jarvis Browser.');
        }
        if (action === 'snapshot') {
          const snap = await deps.browser.snapshot();
          if (!snap) return fail('No page is open.');
          return {
            ...ok(wrapUntrusted(formatSnapshot(snap), 'jarvis-browser', snap.url)),
            untrusted: true,
            untrustedSource: `Jarvis Browser: ${snap.url}`,
          };
        }
        if (action === 'read') {
          const page = await deps.browser.readPage();
          if (!page) return fail('No page is open.');
          return {
            ...ok(
              wrapUntrusted(
                `${page.title.slice(0, 200)}\n\n${page.text || '(no text)'}`,
                'jarvis-browser',
                page.url,
              ),
            ),
            untrusted: true,
            untrustedSource: `Jarvis Browser: ${page.url}`,
          };
        }
        deps.browser.navigate(action);
        return ok(`Done: ${action}.`);
      },
    }),
    // Jarvis drives his own browser (idea from camofox-browser): refs from a snapshot, real input.
    defineTool({
      name: 'browser_act',
      description:
        "Act on the page open in Jarvis Browser using a ref from jarvis_browser's snapshot: click a link or button, pick an option in a drop-down (select), press a key (Enter, Escape, Tab, arrows, PageUp/PageDown, Backspace) or scroll. Clicks that commit something (buy, send, post, delete, submit…) and Enter ask sir first. Take a new snapshot after the page changes; refs from an old page don't work. (target {role, name} instead of ref is for saved browser routines.)",
      input: z.object({
        action: z.enum(['click', 'select', 'press', 'scroll']),
        ref: Ref.optional(),
        target: Target.optional(),
        option: z.string().min(1).max(200).optional(),
        key: z.enum(BROWSER_KEYS).optional(),
        direction: z.enum(['up', 'down', 'top', 'bottom']).default('down'),
      }),
      tier: (i) => {
        if (i.action === 'press') return i.key === 'Enter' ? 'CONFIRM' : 'SAFE';
        if (i.action !== 'click') return 'SAFE';
        const info = i.ref ? deps.browser.refInfo(i.ref) : i.target ? asInfo(i.target) : undefined;
        return info && isRiskyClick(info) ? 'CONFIRM' : 'SAFE';
      },
      destructive: (i) => {
        if (i.action !== 'click') return false;
        const info = i.ref ? deps.browser.refInfo(i.ref) : i.target ? asInfo(i.target) : undefined;
        return !!info && isDestructiveClick(info);
      },
      timeoutMs: 20_000,
      summarize: (i) => {
        if (i.action === 'scroll') return `Scroll ${i.direction} in Jarvis Browser`;
        if (i.action === 'press') return `Press ${i.key ?? 'a key'} in Jarvis Browser`;
        const what = fieldText(i);
        return i.action === 'select' ? `Choose "${i.option ?? ''}" in ${what}` : `Click ${what}`;
      },
      confirm: (i) => ({
        title: i.action === 'press' ? 'Press Enter on this page?' : `Click ${fieldText(i)}?`,
        actionLabel: i.action === 'press' ? 'Press Enter' : 'Click',
        details: `On ${site(deps.browser.state()?.url)} in Jarvis Browser. This may send, buy, post or change something on that site.`,
        detailsKind: 'text',
      }),
      async run(i, ctx) {
        if (!deps.browser.isOpen()) return fail('Jarvis Browser is not open: open a page first.');
        if (i.action === 'scroll') {
          const r = await deps.browser.scroll(i.direction);
          step(ctx.conversationId, {
            tool: 'browser_act',
            input: { action: 'scroll', direction: i.direction },
          });
          return ok(
            `Scrolled ${i.direction} (now at ${r.y} of ${r.max} px). Take a snapshot to see what is there.`,
          );
        }
        if (i.action === 'press') {
          if (!i.key) return fail('Say which key to press.');
          await deps.browser.press(i.key);
          step(ctx.conversationId, { tool: 'browser_act', input: { action: 'press', key: i.key } });
          return ok(`Pressed ${i.key}. ${pageNow(deps.browser.state())}`);
        }
        if (!i.ref && !i.target)
          return fail('Give the ref of the control (from a snapshot), like e12.');
        const info = await resolve(i, ctx.signal);
        if (!info) return fail(notFound(i));
        // A saved step was judged by its remembered name; if the live control commits something
        // that name didn't show, stop rather than click without asking.
        if (
          !i.ref &&
          i.target &&
          i.action === 'click' &&
          isRiskyClick(info) &&
          !isRiskyClick(asInfo(i.target))
        )
          return fail(
            `${describeRef(info, info.ref)} would send, buy or submit something: take a snapshot and click it by ref so sir can confirm.`,
          );
        if (i.action === 'select') {
          if (!i.option) return fail('Say which option to choose.');
          const chosen = await deps.browser.select(info.ref, i.option);
          step(ctx.conversationId, {
            tool: 'browser_act',
            input: { action: 'select', target: recipeTarget(info), option: chosen },
          });
          return ok(`Chose "${chosen}" in ${describeRef(info, info.ref)}.`);
        }
        await deps.browser.click(info.ref);
        step(ctx.conversationId, {
          tool: 'browser_act',
          input: { action: 'click', target: recipeTarget(info) },
        });
        return ok(`Clicked ${describeRef(info, info.ref)}. ${pageNow(deps.browser.state())}`);
      },
    }),
    defineTool({
      name: 'browser_type',
      description:
        "Type text into a field of the page open in Jarvis Browser, by its ref from jarvis_browser's snapshot (search boxes, forms). Replaces what is there unless clear is false; submit presses Enter afterwards (asks sir first). Never for passwords, card numbers or codes: those fields are refused. (target {role, name} instead of ref is for saved browser routines.)",
      input: z.object({
        ref: Ref.optional(),
        target: Target.optional(),
        text: z.string().min(1).max(2000),
        clear: z.boolean().default(true),
        submit: z.boolean().default(false),
      }),
      tier: (i) => (i.submit ? 'CONFIRM' : 'SAFE'),
      // Typing is how data could leave the PC: after reading a page it asks sir first (Security.md §6.3).
      externalFacing: true,
      timeoutMs: 20_000,
      summarize: (i) =>
        `Type "${i.text.slice(0, 40)}" into ${fieldText(i)}${i.submit ? ' and press Enter' : ''}`,
      guards: (i) => ({ text: [i.text] }),
      confirm: (i) => ({
        title: `Type into ${fieldText(i)}${i.submit ? ' and submit' : ''}?`,
        actionLabel: i.submit ? 'Type and submit' : 'Type',
        details: `On ${site(deps.browser.state()?.url)}:\n\n${i.text}`,
        detailsKind: 'text',
      }),
      async run(i, ctx) {
        if (!deps.browser.isOpen()) return fail('Jarvis Browser is not open: open a page first.');
        if (!i.ref && !i.target)
          return fail('Give the ref of the field (from a snapshot), like e12.');
        const info = await resolve(i, ctx.signal);
        if (!info) return fail(notFound(i));
        if (info.secret)
          return fail('That is a password, card or code field: sir must type those himself.');
        await deps.browser.type(info.ref, i.text, { clear: i.clear, submit: i.submit });
        step(ctx.conversationId, {
          tool: 'browser_type',
          input: { target: recipeTarget(info), text: i.text, clear: i.clear, submit: i.submit },
        });
        return ok(
          `Typed into ${describeRef(info, info.ref)}${i.submit ? ' and pressed Enter' : ''}. ${pageNow(deps.browser.state())}`,
        );
      },
    }),
    defineTool({
      name: 'scratchpad',
      description:
        'The scratchpad sir and you share (Apps → Scratchpad): read it, append a note (a list, a number to keep, a draft), or clear it. Use it for short-lived notes; lasting facts belong in memory, documents in Spaces.',
      input: z.object({
        action: z.enum(['read', 'append', 'clear']),
        text: z.string().min(1).max(5000).optional(),
      }),
      tier: ({ action }) => (action === 'clear' ? 'CONFIRM' : 'SAFE'),
      summarize: ({ action }) =>
        action === 'append'
          ? 'Add to the scratchpad'
          : action === 'clear'
            ? 'Clear the scratchpad'
            : 'Read the scratchpad',
      confirm: () => ({
        title: 'Clear the scratchpad?',
        actionLabel: 'Clear',
        details: 'Everything on the scratchpad will be removed.',
        detailsKind: 'text',
      }),
      async run({ action, text }) {
        const now = deps.settings.get('apps.scratchpad');
        // Earlier turns may have written web text here: read it back as untrusted.
        if (action === 'read')
          return now.trim()
            ? {
                ...ok(wrapUntrusted(now, 'scratchpad')),
                untrusted: true,
                untrustedSource: 'scratchpad',
              }
            : ok('The scratchpad is empty.');
        if (action === 'clear') {
          deps.settings.set('apps.scratchpad', '');
          return ok('Cleared the scratchpad.');
        }
        if (!text) return fail('Give the text to add.');
        const next = [now.trimEnd(), text.trim()].filter(Boolean).join('\n\n');
        deps.settings.set('apps.scratchpad', next.slice(-SCRATCHPAD_MAX));
        return ok('Added to the scratchpad.');
      },
    }),
  ];
}
