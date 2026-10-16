import './apps-pages.css';

/** Jarvis Browser's address bar (ADR-032). It talks to main only through window.browserBar. */
interface BarState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}
interface BrowserBarApi {
  go(text: string): void;
  nav(action: 'back' | 'forward' | 'reload' | 'stop' | 'home'): void;
  ready(): void;
  onState(cb: (s: unknown) => void): void;
  onFocusAddress(cb: () => void): void;
}
const api = (window as unknown as { browserBar: BrowserBarApi }).browserBar;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const form = $<HTMLFormElement>('bar');
const address = $<HTMLInputElement>('address');
const back = $<HTMLButtonElement>('back');
const forward = $<HTMLButtonElement>('forward');
const reload = $<HTMLButtonElement>('reload');
const lock = $<HTMLSpanElement>('lock');
let loading = false;

document.body.classList.add('browser-bar');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (address.value.trim()) api.go(address.value);
  address.blur();
});
back.addEventListener('click', () => api.nav('back'));
forward.addEventListener('click', () => api.nav('forward'));
reload.addEventListener('click', () => api.nav(loading ? 'stop' : 'reload'));
$<HTMLButtonElement>('home').addEventListener('click', () => api.nav('home'));
address.addEventListener('focus', () => address.select());
address.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') address.blur();
});

api.onFocusAddress(() => {
  address.focus();
  address.select();
});
api.onState((raw) => {
  const s = raw as BarState;
  if (document.activeElement !== address) address.value = s.url === 'about:blank' ? '' : s.url;
  back.disabled = !s.canGoBack;
  forward.disabled = !s.canGoForward;
  loading = s.loading;
  reload.textContent = s.loading ? '✕' : '↻';
  reload.title = s.loading ? 'Stop' : 'Reload (F5)';
  const secure = s.url.startsWith('https://');
  lock.textContent = s.url ? (secure ? '\u{1F512}' : '⚠') : '';
  lock.title = secure ? 'Secure connection' : 'Not secure (http)';
  document.title = s.title ? `${s.title} — Jarvis Browser` : 'Jarvis Browser';
});
api.ready();
