import './apps-pages.css';

/** Jarvis Terminal (ADR-032). Talks to main only through window.terminal. */
interface Entry {
  id: string;
  by: 'you' | 'jarvis';
  command: string;
  output: string;
  exitCode: number | null;
  cwd: string;
  at: string;
  ms: number;
}
interface TerminalApi {
  run(command: string): Promise<Entry>;
  stop(): Promise<void>;
  history(): Promise<{ entries: Entry[]; cwd: string }>;
  clear(): Promise<void>;
  onEntry(cb: (e: unknown) => void): void;
}
const api = (window as unknown as { terminal: TerminalApi }).terminal;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const log = $<HTMLElement>('log');
const cmd = $<HTMLInputElement>('cmd');
const cwdLabel = $<HTMLSpanElement>('cwd');
const stop = $<HTMLButtonElement>('stop');
const shown = new Set<string>();
const typed: string[] = [];
let recall = -1;

document.body.classList.add('terminal');

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text; // always text, never HTML
  return e;
}

function render(e: Entry): void {
  if (shown.has(e.id)) return;
  shown.add(e.id);
  const block = el('section', `entry ${e.by}`);
  const head = el('div', 'line');
  head.append(
    el('span', 'who', e.by === 'jarvis' ? 'JARVIS' : 'PS'),
    el('span', 'path', e.by === 'you' ? `${e.cwd}>` : 'ran (you approved it)'),
  );
  block.append(head, el('pre', 'command', e.command));
  if (e.output) block.append(el('pre', 'output', e.output));
  const exit =
    e.exitCode === null
      ? 'not run'
      : e.exitCode === 0
        ? `ok · ${(e.ms / 1000).toFixed(1)} s`
        : `exit ${e.exitCode} · ${(e.ms / 1000).toFixed(1)} s`;
  block.append(el('div', `status ${e.exitCode === 0 ? 'ok' : 'bad'}`, exit));
  log.append(block);
  log.scrollTop = log.scrollHeight;
}

async function refresh(): Promise<void> {
  const h = await api.history();
  log.replaceChildren();
  shown.clear();
  h.entries.forEach(render);
  cwdLabel.textContent = h.cwd;
}

$<HTMLFormElement>('prompt').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const command = cmd.value.trim();
  if (!command) return;
  typed.push(command);
  recall = -1;
  cmd.value = '';
  cmd.disabled = true;
  stop.disabled = false;
  const pending = el('div', 'pending', `Running: ${command}`);
  log.append(pending);
  log.scrollTop = log.scrollHeight;
  void api
    .run(command)
    .then((e) => {
      render(e);
      return api.history();
    })
    .then((h) => (cwdLabel.textContent = h.cwd))
    .catch((err: unknown) => log.append(el('pre', 'output bad', String(err))))
    .finally(() => {
      pending.remove();
      cmd.disabled = false;
      stop.disabled = true;
      cmd.focus();
    });
});

cmd.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp' && typed.length) {
    recall = recall < 0 ? typed.length - 1 : Math.max(0, recall - 1);
    cmd.value = typed[recall] ?? '';
    e.preventDefault();
  } else if (e.key === 'ArrowDown' && recall >= 0) {
    recall = recall + 1 < typed.length ? recall + 1 : -1;
    cmd.value = recall < 0 ? '' : (typed[recall] ?? '');
    e.preventDefault();
  }
});
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    void api.clear().then(refresh);
  }
});
$<HTMLButtonElement>('clear').addEventListener('click', () => void api.clear().then(refresh));
stop.addEventListener('click', () => void api.stop());
api.onEntry((raw) => render(raw as Entry));
void refresh().then(() => cmd.focus());
