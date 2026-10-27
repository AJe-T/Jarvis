import {
  CLOUD_PROVIDERS,
  CONNECTION_ID_RE,
  MAX_CONNECTIONS_PER_PROVIDER,
  cloudProvider,
  connectionSecret,
  defaultConnectionId,
  type AiConnection,
  type CloudProviderId,
  type ConnectionModel,
  type LivePrice,
  type ModelSource,
} from '@shared/llm-providers';
import type { Db } from '../db/connection';
import { JarvisError } from '../errors';
import { redact } from '../security/redact';
import type { SecretStore } from '../settings/secrets';
import type { SettingsService } from '../settings/settings-service';

/**
 * Integrations step 3: Sir's connections (keys) to cloud AI providers, and the models each one
 * offers (migration 014). Each provider's own key is the connection `conn_<provider>`, created
 * when it is first needed, so everything set up before keeps working; its chosen model stays in
 * `llm.cloud.models`, which the rest of the app already reads.
 */

interface ConnRow {
  id: string;
  provider: string;
  label: string;
  secret: string;
  model: string;
}

interface ModelRow {
  model: string;
  source: ModelSource;
  favourite: number;
  enabled: number;
  seen_at: string | null;
  in_per_mtok: number | null;
  out_per_mtok: number | null;
  cache_read_per_mtok: number | null;
  cache_write_per_mtok: number | null;
  context_tokens: number | null;
}

const priceOf = (m: ModelRow): LivePrice | null =>
  m.in_per_mtok === null || m.out_per_mtok === null
    ? null
    : {
        inPerMTok: m.in_per_mtok,
        outPerMTok: m.out_per_mtok,
        cacheReadPerMTok: m.cache_read_per_mtok ?? m.in_per_mtok,
        cacheWritePerMTok: m.cache_write_per_mtok ?? m.in_per_mtok,
      };

const MAX_LABEL = 60;
/** CONNECTION_ID_RE allows two digits. */
const MAX_CONNECTION_NUMBER = 99;
/** Model ids as providers write them: letters, digits and . _ - : / @ + (e.g. accounts/fireworks/models/x). */
export const MODEL_RE = /^[\w.:/@+-]{1,120}$/;

const isProvider = (p: string): p is CloudProviderId => CLOUD_PROVIDERS.some((c) => c.id === p);

export function createConnections(deps: {
  db: Db;
  settings: SettingsService;
  secrets: Pick<SecretStore, 'get' | 'delete'>;
  now?: () => Date;
}) {
  const { db, settings, secrets } = deps;
  const now = (): string => (deps.now?.() ?? new Date()).toISOString();

  /** A name is shown everywhere and stored as plain text: never a key pasted into the wrong box. */
  const keyLike = (label: string): boolean => redact(label) !== label;
  const refuseKey = (label: string): void => {
    if (keyLike(label))
      throw new JarvisError(
        'INVALID',
        'key in a connection name',
        'That looks like an API key. Put the key in the key box; the name is only a label, like "Groq (work)".',
      );
  };

  // A key typed into a name before 2.33.1 is replaced by the default name (the key itself is in secrets.bin).
  for (const r of db.prepare('SELECT id, provider, label FROM ai_connections').all() as Array<{
    id: string;
    provider: string;
    label: string;
  }>)
    if (keyLike(r.label) && isProvider(r.provider)) {
      const n = /_(\d+)$/.exec(r.id.slice(5))?.[1];
      db.prepare('UPDATE ai_connections SET label = ? WHERE id = ?').run(
        `${cloudProvider(r.provider).label}${n ? ` (${n})` : ''}`,
        r.id,
      );
    }

  const rowOf = (id: string): ConnRow | undefined =>
    db
      .prepare(
        'SELECT id, provider, label, secret, model FROM ai_connections WHERE id = ? AND removed = 0',
      )
      .get(id) as ConnRow | undefined;

  /** The provider's own connection, created on first use. */
  function ensurePrimary(p: CloudProviderId): ConnRow {
    const id = defaultConnectionId(p);
    const found = rowOf(id);
    if (found) return found;
    db.prepare(
      'INSERT INTO ai_connections (id, provider, label, secret, model, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, p, cloudProvider(p).label, cloudProvider(p).secret, '', now());
    return rowOf(id) as ConnRow;
  }

  function row(id: string): ConnRow & { provider: CloudProviderId } {
    if (!CONNECTION_ID_RE.test(id))
      throw new JarvisError('INVALID', 'bad connection id', 'That connection does not exist.');
    const primary = CLOUD_PROVIDERS.find((p) => defaultConnectionId(p.id) === id);
    const r = primary ? ensurePrimary(primary.id) : rowOf(id);
    if (!r || !isProvider(r.provider))
      throw new JarvisError('NOT_FOUND', `no connection ${id}`, 'That connection does not exist.');
    return r as ConnRow & { provider: CloudProviderId };
  }

  const isPrimary = (r: ConnRow): boolean =>
    r.id === defaultConnectionId(r.provider as CloudProviderId);

  function modelOf(r: ConnRow & { provider: CloudProviderId }): string {
    return isPrimary(r) ? (settings.get('llm.cloud.models')[r.provider] ?? '') : r.model;
  }

  function models(id: string): ConnectionModel[] {
    const rows = db
      .prepare('SELECT * FROM ai_models WHERE connection_id = ? ORDER BY favourite DESC, model')
      .all(id) as unknown as ModelRow[];
    return rows.map((m) => ({
      model: m.model,
      source: m.source,
      favourite: m.favourite === 1,
      enabled: m.enabled === 1,
      seenAt: m.seen_at,
      price: priceOf(m),
      context: m.context_tokens ?? null,
    }));
  }

  function view(r: ConnRow & { provider: CloudProviderId }): AiConnection {
    return {
      id: r.id,
      provider: r.provider,
      label: r.label,
      secret: r.secret,
      primary: isPrimary(r),
      model: modelOf(r),
      keySet: Boolean(secrets.get(r.secret)),
      models: models(r.id),
    };
  }

  function checkModel(model: string): string {
    const m = model.trim();
    if (!MODEL_RE.test(m))
      throw new JarvisError(
        'INVALID',
        'bad model id',
        'That model id has characters a model id never has.',
      );
    return m;
  }

  /** Every provider's own connection (whether or not it has a key) plus Sir's extra ones. */
  function list(): AiConnection[] {
    for (const p of CLOUD_PROVIDERS) ensurePrimary(p.id);
    const rows = db
      .prepare(
        'SELECT id, provider, label, secret, model FROM ai_connections WHERE removed = 0 ORDER BY provider, created_at',
      )
      .all() as unknown as ConnRow[];
    return rows
      .filter((r): r is ConnRow & { provider: CloudProviderId } => isProvider(r.provider))
      .map(view);
  }

  return {
    list,

    get: (id: string): AiConnection => view(row(id)),

    /** What a client needs to call this connection (main only: the secret name, never the key). */
    target(id: string): {
      provider: CloudProviderId;
      secret: string;
      model: string;
      label: string;
    } {
      const r = row(id);
      return { provider: r.provider, secret: r.secret, model: modelOf(r), label: r.label };
    },

    add(provider: CloudProviderId, label: string): AiConnection {
      if (!isProvider(provider))
        throw new JarvisError('INVALID', 'unknown provider', 'That AI provider is not supported.');
      ensurePrimary(provider);
      const rows = db
        .prepare('SELECT id, removed FROM ai_connections WHERE provider = ?')
        .all(provider) as Array<{ id: string; removed: number }>;
      if (rows.filter((r) => r.removed === 0).length >= MAX_CONNECTIONS_PER_PROVIDER)
        throw new JarvisError(
          'INVALID',
          'too many connections',
          `At most ${MAX_CONNECTIONS_PER_PROVIDER} keys per provider.`,
        );
      // Never reuse a number, removed ones included (see migration 014).
      const n =
        Math.max(1, ...rows.map((r) => Number(/_(\d+)$/.exec(r.id.slice(5))?.[1] ?? 1))) + 1;
      if (n > MAX_CONNECTION_NUMBER)
        throw new JarvisError(
          'INVALID',
          'connection numbers used up',
          'No more keys can be added for this provider.',
        );
      const id = `${defaultConnectionId(provider)}_${n}`;
      refuseKey(label);
      const name = label.trim().slice(0, MAX_LABEL) || `${cloudProvider(provider).label} (${n})`;
      db.prepare(
        'INSERT INTO ai_connections (id, provider, label, secret, model, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(id, provider, name, connectionSecret(provider, n), '', now());
      return view(row(id));
    },

    rename(id: string, label: string): void {
      const r = row(id);
      const name = label.trim().slice(0, MAX_LABEL);
      if (!name) throw new JarvisError('INVALID', 'empty label', 'Give the connection a name.');
      refuseKey(name);
      db.prepare('UPDATE ai_connections SET label = ? WHERE id = ?').run(name, r.id);
    },

    /** The model this connection answers with. The provider's own key keeps it in llm.cloud.models. */
    setModel(id: string, model: string): void {
      const r = row(id);
      const m = model.trim() ? checkModel(model) : '';
      if (isPrimary(r))
        settings.set('llm.cloud.models', { ...settings.get('llm.cloud.models'), [r.provider]: m });
      else db.prepare('UPDATE ai_connections SET model = ? WHERE id = ?').run(m, r.id);
    },

    /** An extra connection and its key are deleted; the provider's own one can only lose its key. */
    remove(id: string): void {
      const r = row(id);
      if (isPrimary(r))
        throw new JarvisError(
          'INVALID',
          'primary connection',
          "The provider's main key can't be removed; clear the key instead.",
        );
      if (secrets.get(r.secret)) secrets.delete(r.secret);
      db.prepare('DELETE FROM ai_models WHERE connection_id = ?').run(r.id);
      // Kept as removed so the id (and secret name) is never handed to another key.
      db.prepare("UPDATE ai_connections SET removed = 1, model = '' WHERE id = ?").run(r.id);
      if (settings.get('llm.cloud.connection') === r.id) settings.set('llm.cloud.connection', '');
    },

    /**
     * A fresh model list: listed models become 'live', models listed before but not now become
     * 'cached' (kept, so a favourite isn't lost while a provider hiccups); typed ones stay 'manual'.
     */
    syncLive(
      id: string,
      listed: Array<string | { id: string; price: LivePrice | null; context?: number | null }>,
    ): ConnectionModel[] {
      const r = row(id);
      const byId = new Map<string, { price: LivePrice | null; context: number | null }>();
      for (const m of listed) {
        const entry = typeof m === 'string' ? { id: m, price: null } : m;
        const key = entry.id.trim();
        if (MODEL_RE.test(key) && !byId.has(key))
          byId.set(key, { price: entry.price, context: entry.context ?? null });
      }
      const at = now();
      db.exec('BEGIN');
      try {
        db.prepare(
          "UPDATE ai_models SET source = 'cached' WHERE connection_id = ? AND source = 'live'",
        ).run(r.id);
        // A listed price replaces the old one; a gateway that stops listing it leaves it unknown.
        const upsert = db.prepare(
          `INSERT INTO ai_models (connection_id, model, source, seen_at, in_per_mtok, out_per_mtok,
             cache_read_per_mtok, cache_write_per_mtok, context_tokens) VALUES (?, ?, 'live', ?, ?, ?, ?, ?, ?)
           ON CONFLICT (connection_id, model) DO UPDATE SET seen_at = excluded.seen_at,
             source = CASE WHEN source = 'manual' THEN 'manual' ELSE 'live' END,
             in_per_mtok = excluded.in_per_mtok, out_per_mtok = excluded.out_per_mtok,
             cache_read_per_mtok = excluded.cache_read_per_mtok,
             cache_write_per_mtok = excluded.cache_write_per_mtok,
             context_tokens = COALESCE(excluded.context_tokens, context_tokens)`,
        );
        for (const [m, { price: p, context }] of byId)
          upsert.run(
            r.id,
            m,
            at,
            p?.inPerMTok ?? null,
            p?.outPerMTok ?? null,
            p?.cacheReadPerMTok ?? null,
            p?.cacheWritePerMTok ?? null,
            context,
          );
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return models(r.id);
    },

    /** A model id Sir typed (providers without a list, or one the list misses). */
    addManual(id: string, model: string): void {
      const r = row(id);
      const m = checkModel(model);
      db.prepare(
        "INSERT INTO ai_models (connection_id, model, source) VALUES (?, ?, 'manual') ON CONFLICT DO NOTHING",
      ).run(r.id, m);
    },

    setFlags(id: string, model: string, flags: { favourite?: boolean; enabled?: boolean }): void {
      const r = row(id);
      if (flags.favourite !== undefined)
        db.prepare('UPDATE ai_models SET favourite = ? WHERE connection_id = ? AND model = ?').run(
          flags.favourite ? 1 : 0,
          r.id,
          model,
        );
      if (flags.enabled !== undefined)
        db.prepare('UPDATE ai_models SET enabled = ? WHERE connection_id = ? AND model = ?').run(
          flags.enabled ? 1 : 0,
          r.id,
          model,
        );
    },

    /** Typed or no-longer-listed models can be removed; live ones come back on the next refresh. */
    removeModel(id: string, model: string): void {
      const r = row(id);
      db.prepare(
        "DELETE FROM ai_models WHERE connection_id = ? AND model = ? AND source != 'live'",
      ).run(r.id, model);
    },

    /** The connection Jarvis's own brain uses when the connection is "another AI". */
    main(): string {
      const chosen = settings.get('llm.cloud.connection');
      const provider = settings.get('llm.cloud.provider');
      const r = chosen ? rowOf(chosen) : undefined;
      // Only a key that is set up: an empty one would fail every turn instead of using the main key.
      if (r?.provider === provider && r.model && secrets.get(r.secret)) return r.id;
      return defaultConnectionId(provider);
    },

    /** The gateway's own price for this model on this connection, when it published one. */
    livePrice(id: string, model: string): LivePrice | null {
      const m = db
        .prepare('SELECT * FROM ai_models WHERE connection_id = ? AND model = ?')
        .get(id, model) as ModelRow | undefined;
      return m ? priceOf(m) : null;
    },

    /** Names of Sir's extra keys, removed ones too (an NPC may still name one). */
    extraLabels(): Record<string, string> {
      const rows = db
        .prepare('SELECT id, provider, label, removed FROM ai_connections')
        .all() as Array<{ id: string; provider: string; label: string; removed: number }>;
      return Object.fromEntries(
        rows
          .filter((r) => isProvider(r.provider) && r.id !== defaultConnectionId(r.provider))
          .map((r) => [
            r.id,
            `${cloudProvider(r.provider as CloudProviderId).label} (${r.label}${r.removed ? ', removed' : ''})`,
          ]),
      );
    },

    /** Connections with a key and a model: brains Jarvis can hand work to. */
    ready: (): AiConnection[] => list().filter((c) => c.keySet && c.model !== ''),
  };
}

export type Connections = ReturnType<typeof createConnections>;
