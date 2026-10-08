import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import type { Res } from '@shared/ipc-contract';
import { Button, IconButton } from '../../components/ui/button';
import { confirmAction } from '../../components/ui/confirm-modal';
import { Field, TextInput } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { useUiStore } from '../../stores/ui-store';
import { generatePassword, strength } from './password-tools';

type Summary = Res<'passwords:list'>[number];
type Entry = Res<'passwords:get'>;
type Draft = Omit<Entry, 'id' | 'createdAt' | 'updatedAt'> & { id?: string };

const CATEGORIES = ['Login', 'Bank', 'Card', 'Email', 'Social', 'Work', 'Wi-Fi', 'Other'];
const EMPTY: Draft = {
  title: '',
  username: '',
  password: '',
  url: '',
  notes: '',
  category: 'Login',
  totpSecret: '',
  favorite: false,
};

function StrengthBar({ pw }: { pw: string }): React.JSX.Element {
  const s = strength(pw);
  const colors = ['bg-alarm-fill', 'bg-alarm-fill', 'bg-lamp-400', 'bg-ok-400', 'bg-ok-400'];
  return (
    <div className="flex items-center gap-2" aria-label={`Strength: ${s.label}`}>
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={clsx('h-1 flex-1 rounded-pill', i < s.score ? colors[s.score] : 'bg-line')}
          />
        ))}
      </div>
      <span className="w-24 text-right text-xs text-ink-500">{pw ? s.label : ''}</span>
    </div>
  );
}

/** First run creates the vault; afterwards the master password opens it. */
function LockScreen({ exists, onOpen }: { exists: boolean; onOpen(): void }): React.JSX.Element {
  const [master, setMaster] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError('');
    if (!exists && master !== again) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      await call(exists ? 'passwords:unlock' : 'passwords:setup', { master });
      setMaster('');
      setAgain('');
      onOpen();
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="m-auto flex w-full max-w-sm flex-col gap-4 p-6"
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-lg bg-surface-2">
          <Lock size={22} aria-hidden />
        </span>
        <h1 className="text-lg font-semibold text-ink-100">
          {exists ? 'Passwords are locked' : 'Create your password vault'}
        </h1>
        <p className="text-sm text-ink-500">
          {exists
            ? 'Enter your master password.'
            : 'Everything is encrypted on this PC with a key made from your master password. Jarvis (the AI) can never read it. If you forget the master password, the vault cannot be recovered.'}
        </p>
      </div>
      <Field label="Master password">
        {(id) => (
          <TextInput
            id={id}
            type="password"
            autoFocus
            autoComplete="off"
            value={master}
            onChange={(e) => setMaster(e.target.value)}
          />
        )}
      </Field>
      {!exists && (
        <>
          <StrengthBar pw={master} />
          <Field label="Type it again">
            {(id) => (
              <TextInput
                id={id}
                type="password"
                autoComplete="off"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
              />
            )}
          </Field>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-alarm-500">
          {error}
        </p>
      )}
      <Button variant="primary" type="submit" disabled={busy || !master}>
        {busy ? 'Working…' : exists ? 'Unlock' : 'Create vault'}
      </Button>
    </form>
  );
}

function CopyButton({
  id,
  field,
  label,
}: {
  id: string;
  field: 'username' | 'password' | 'totp';
  label: string;
}): React.JSX.Element {
  const toast = useUiStore((s) => s.toast);
  return (
    <IconButton
      label={label}
      onClick={() =>
        void call('passwords:copy', { id, field })
          .then((r) =>
            toast({
              level: 'info',
              message:
                field === 'username'
                  ? 'Copied.'
                  : `Copied. The clipboard is cleared in ${r.clearsInSeconds} s.`,
            }),
          )
          .catch((e: unknown) => toast({ level: 'error', message: cleanError(e) }))
      }
    >
      <Copy size={16} aria-hidden />
    </IconButton>
  );
}

function TotpCode({ id }: { id: string }): React.JSX.Element {
  const [t, setT] = useState<{ code: string; secondsLeft: number } | null>(null);
  useEffect(() => {
    let live = true;
    const tick = (): void =>
      void call('passwords:totp', { id })
        .then((r) => live && setT(r))
        .catch(() => undefined);
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id]);
  return (
    <div className="flex items-center gap-3">
      <span className="font-code text-xl tracking-[0.2em] text-ink-100">
        {t ? `${t.code.slice(0, 3)} ${t.code.slice(3)}` : '··· ···'}
      </span>
      <span className="text-xs text-ink-500">{t ? `${t.secondsLeft}s` : ''}</span>
      <CopyButton id={id} field="totp" label="Copy two-factor code" />
    </div>
  );
}

function Detail({
  id,
  onEdit,
  onDeleted,
}: {
  id: string;
  onEdit(e: Entry): void;
  onDeleted(): void;
}): React.JSX.Element | null {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [shown, setShown] = useState(false);
  const toast = useUiStore((s) => s.toast);
  useEffect(() => {
    setShown(false);
    void call('passwords:get', { id })
      .then(setEntry)
      .catch(() => setEntry(null));
  }, [id]);
  if (!entry) return null;

  async function remove(): Promise<void> {
    if (!entry) return;
    const yes = await confirmAction({
      title: `Delete "${entry.title}"?`,
      body: 'This entry is removed from the vault for good.',
      actionLabel: 'Delete',
      destructive: true,
    });
    if (!yes) return;
    await call('passwords:delete', { id: entry.id }).catch((e: unknown) =>
      toast({ level: 'error', message: cleanError(e) }),
    );
    onDeleted();
  }

  const row = 'flex min-h-11 items-center gap-3 border-b border-line-subtle py-2';
  const label = 'w-28 shrink-0 text-sm text-ink-500';
  return (
    <div className="fade-in mx-auto w-full max-w-2xl px-4 py-6 md:px-6">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-lg bg-surface-2 text-lg font-semibold">
          {entry.title.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold text-ink-100">{entry.title}</h2>
          <p className="text-sm text-ink-500">{entry.category}</p>
        </div>
        <Button onClick={() => onEdit(entry)}>Edit</Button>
        <IconButton label="Delete entry" className="text-alarm-500" onClick={() => void remove()}>
          <Trash2 size={16} aria-hidden />
        </IconButton>
      </div>
      {entry.username && (
        <div className={row}>
          <span className={label}>Username</span>
          <span className="min-w-0 flex-1 truncate text-ink-100">{entry.username}</span>
          <CopyButton id={entry.id} field="username" label="Copy username" />
        </div>
      )}
      {entry.password && (
        <div className={row}>
          <span className={label}>Password</span>
          <span className="min-w-0 flex-1 truncate font-code text-ink-100">
            {shown ? entry.password : '••••••••••••'}
          </span>
          <IconButton
            label={shown ? 'Hide password' : 'Show password'}
            onClick={() => setShown(!shown)}
          >
            {shown ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
          </IconButton>
          <CopyButton id={entry.id} field="password" label="Copy password" />
        </div>
      )}
      {entry.totpSecret && (
        <div className={row}>
          <span className={label}>Two-factor</span>
          <TotpCode id={entry.id} />
        </div>
      )}
      {entry.url && (
        <div className={row}>
          <span className={label}>Website</span>
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-accent-300 underline"
            onClick={() => {
              const url = /^https?:\/\//i.test(entry.url) ? entry.url : `https://${entry.url}`;
              void call('app:openExternal', { url }).catch(() => undefined);
            }}
          >
            {entry.url}
          </button>
        </div>
      )}
      {entry.notes && (
        <div className="py-3">
          <span className={label}>Notes</span>
          <p className="mt-2 text-sm whitespace-pre-wrap text-ink-100">{entry.notes}</p>
        </div>
      )}
      <p className="mt-6 text-xs text-ink-500">
        Updated {new Date(entry.updatedAt).toLocaleString()}
      </p>
    </div>
  );
}

function Editor({
  initial,
  onSaved,
  onCancel,
}: {
  initial: Draft;
  onSaved(id: string): void;
  onCancel(): void;
}): React.JSX.Element {
  const [d, setD] = useState<Draft>(initial);
  const [len, setLen] = useState(20);
  const [symbols, setSymbols] = useState(true);
  const [show, setShow] = useState(!initial.id);
  const [error, setError] = useState('');
  const set = <K extends keyof Draft>(k: K, v: Draft[K]): void => setD((x) => ({ ...x, [k]: v }));

  async function save(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError('');
    try {
      const saved = await call('passwords:save', d);
      onSaved(saved.id);
    } catch (err) {
      setError(cleanError(err));
    }
  }

  return (
    <form
      onSubmit={(e) => void save(e)}
      className="fade-in mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6 md:px-6"
    >
      <h2 className="text-lg font-semibold text-ink-100">{d.id ? 'Edit entry' : 'New entry'}</h2>
      <Field label="Name">
        {(id) => (
          <TextInput
            id={id}
            required
            autoFocus
            value={d.title}
            onChange={(e) => set('title', e.target.value)}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Username or email">
          {(id) => (
            <TextInput
              id={id}
              autoComplete="off"
              value={d.username}
              onChange={(e) => set('username', e.target.value)}
            />
          )}
        </Field>
        <Field label="Category">
          {(id) => (
            <select
              id={id}
              value={d.category}
              onChange={(e) => set('category', e.target.value)}
              className="min-h-9 rounded-sm border border-line bg-surface-1 px-2 text-ink-100"
            >
              {[...new Set([...CATEGORIES, d.category])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label="Password">
        {(id) => (
          <div className="flex flex-col gap-2">
            <div className="flex gap-1">
              <TextInput
                id={id}
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                className="flex-1 font-code"
                value={d.password}
                onChange={(e) => set('password', e.target.value)}
              />
              <IconButton
                label={show ? 'Hide password' : 'Show password'}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
              </IconButton>
              <IconButton
                label="Generate a strong password"
                onClick={() => {
                  set('password', generatePassword({ length: len, symbols, digits: true }));
                  setShow(true);
                }}
              >
                <RefreshCw size={16} aria-hidden />
              </IconButton>
            </div>
            <StrengthBar pw={d.password} />
            <div className="flex flex-wrap items-center gap-4 text-sm text-ink-500">
              <label className="flex items-center gap-2">
                Length {len}
                <input
                  type="range"
                  min={8}
                  max={64}
                  value={len}
                  onChange={(e) => setLen(Number(e.target.value))}
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={symbols}
                  onChange={(e) => setSymbols(e.target.checked)}
                />
                Symbols
              </label>
            </div>
          </div>
        )}
      </Field>
      <Field label="Website">
        {(id) => (
          <TextInput
            id={id}
            placeholder="example.com"
            value={d.url}
            onChange={(e) => set('url', e.target.value)}
          />
        )}
      </Field>
      <Field
        label="Two-factor secret (optional)"
        hint="The setup key shown under the QR code when you turn on an authenticator app. Jarvis then shows the 6-digit codes."
      >
        {(id) => (
          <TextInput
            id={id}
            autoComplete="off"
            className="font-code"
            value={d.totpSecret}
            onChange={(e) => set('totpSecret', e.target.value)}
          />
        )}
      </Field>
      <Field label="Notes">
        {(id) => (
          <textarea
            id={id}
            rows={4}
            value={d.notes}
            onChange={(e) => set('notes', e.target.value)}
            className="rounded-sm border border-line bg-surface-1 px-3 py-2 text-ink-100"
          />
        )}
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink-300">
        <input
          type="checkbox"
          checked={d.favorite}
          onChange={(e) => set('favorite', e.target.checked)}
        />
        Favourite (pinned to the top)
      </label>
      {error && (
        <p role="alert" className="text-sm text-alarm-500">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="primary" type="submit">
          Save
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ChangeMaster(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const toast = useUiStore((s) => s.toast);
  if (!open)
    return (
      <button
        type="button"
        className="text-xs text-ink-500 underline"
        onClick={() => setOpen(true)}
      >
        Change master password
      </button>
    );
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void call('passwords:changeMaster', { current, next })
          .then(() => {
            toast({ level: 'info', message: 'Master password changed.' });
            setOpen(false);
            setCurrent('');
            setNext('');
          })
          .catch((err: unknown) => toast({ level: 'error', message: cleanError(err) }));
      }}
    >
      <TextInput
        type="password"
        aria-label="Current master password"
        placeholder="Current"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <TextInput
        type="password"
        aria-label="New master password"
        placeholder="New (8+ characters)"
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      <div className="flex gap-2">
        <Button type="submit" className="h-8 px-3">
          Change
        </Button>
        <Button variant="ghost" className="h-8 px-3" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Security.md §16.6: a local, encrypted password manager the AI cannot see. */
export function PasswordsView(): React.JSX.Element {
  const [status, setStatus] = useState<Res<'passwords:status'> | null>(null);
  const [items, setItems] = useState<Summary[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);

  const refresh = useCallback(async () => {
    const st = await call('passwords:status', {});
    setStatus(st);
    setItems(st.unlocked ? await call('passwords:list', {}) : []);
  }, []);

  useEffect(() => {
    void refresh();
    return window.jarvis.on('passwords:locked', () => {
      setSelected(null);
      setEditing(null);
      void refresh();
    });
  }, [refresh]);

  const categories = useMemo(() => [...new Set(items.map((i) => i.category))].sort(), [items]);
  const shown = items.filter(
    (i) =>
      (!category || i.category === category) &&
      (!query || `${i.title} ${i.username} ${i.url}`.toLowerCase().includes(query.toLowerCase())),
  );

  if (!status) return <div className="flex-1" />;
  if (!status.unlocked)
    return (
      <div className="flex min-w-0 flex-1">
        <LockScreen exists={status.exists} onOpen={() => void refresh()} />
      </div>
    );

  return (
    <div className="flex min-w-0 flex-1">
      <aside
        aria-label="Saved passwords"
        className="flex w-60 shrink-0 flex-col border-r border-line-subtle md:w-72"
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line-subtle pr-2 pl-4">
          <ShieldCheck size={16} aria-hidden className="text-ok-400" />
          <h1 className="text-ui font-semibold text-ink-100">Passwords</h1>
          <IconButton
            label="New entry"
            className="ml-auto"
            onClick={() => {
              setSelected(null);
              setEditing(EMPTY);
            }}
          >
            <Plus size={16} aria-hidden />
          </IconButton>
          <IconButton label="Lock" onClick={() => void call('passwords:lock', {}).then(refresh)}>
            <Lock size={16} aria-hidden />
          </IconButton>
        </div>
        <div className="relative p-3">
          <Search size={14} aria-hidden className="absolute top-[23px] left-5.5 text-icon-rest" />
          <TextInput
            aria-label="Search passwords"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-7 text-sm"
          />
        </div>
        {categories.length > 1 && (
          <div className="flex flex-wrap gap-1 px-3 pb-2">
            {[null, ...categories].map((c) => (
              <button
                key={c ?? 'all'}
                type="button"
                onClick={() => setCategory(c)}
                className={clsx(
                  'rounded-pill px-2.5 py-0.5 text-xs',
                  category === c
                    ? 'bg-ink-strong text-on-strong'
                    : 'bg-surface-2 text-ink-300 hover:bg-hover',
                )}
              >
                {c ?? 'All'}
              </button>
            ))}
          </div>
        )}
        <ul className="flex-1 overflow-y-auto px-2 pb-3">
          {shown.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-ink-500">
              {items.length ? 'No matches.' : 'No passwords yet. Press + to add one.'}
            </li>
          )}
          {shown.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                aria-current={selected === i.id ? 'true' : undefined}
                onClick={() => {
                  setEditing(null);
                  setSelected(i.id);
                }}
                className={clsx(
                  'flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left transition-colors',
                  selected === i.id ? 'bg-selected' : 'hover:bg-hover',
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-sm font-semibold">
                  {i.title.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 truncate text-sm text-ink-100">
                    {i.title}
                    {i.favorite && (
                      <Star size={12} aria-label="Favourite" className="text-lamp-400" />
                    )}
                  </span>
                  <span className="block truncate text-xs text-ink-500">
                    {i.username || i.url || i.category}
                  </span>
                </span>
                {i.hasTotp && (
                  <KeyRound size={14} aria-label="Has two-factor" className="text-ink-500" />
                )}
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-line-subtle p-3">
          <p className="mb-2 text-xs text-ink-500">
            {items.length} saved · locks itself when idle · never shared with the AI
          </p>
          <ChangeMaster />
        </div>
      </aside>
      <section className="flex min-w-0 flex-1 overflow-y-auto" aria-label="Entry">
        {editing ? (
          <Editor
            key={editing.id ?? 'new'}
            initial={editing}
            onCancel={() => setEditing(null)}
            onSaved={(id) => {
              setEditing(null);
              setSelected(id);
              void refresh();
            }}
          />
        ) : selected ? (
          <Detail
            key={selected}
            id={selected}
            onEdit={(e) => setEditing(e)}
            onDeleted={() => {
              setSelected(null);
              void refresh();
            }}
          />
        ) : (
          <div className="m-auto flex max-w-sm flex-col items-center gap-3 p-6 text-center">
            <ShieldCheck size={28} aria-hidden className="text-ok-400" />
            <p className="text-sm text-ink-500">
              Encrypted on this PC with AES-256. Jarvis's AI, Telegram, WhatsApp and the phone
              remote can't read it. Copied passwords are wiped from the clipboard automatically.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
