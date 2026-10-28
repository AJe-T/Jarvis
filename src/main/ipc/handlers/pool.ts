import { ABILITY_KEYS, DELEGATION_KEYS, isCustomProvider } from '@shared/free-pool';
import { MAX_CONNECTIONS_PER_PROVIDER, defaultConnectionId } from '@shared/llm-providers';
import { JarvisError } from '../../errors';
import { parseEnvKeys } from '../../llm/pool/env-import';
import type { Services } from '../../services';
import { handle } from '../handle';

/** AI Router (2.30): Sidebar → AI Router. Keys never come back out; only names and last four. */
export function registerPoolHandlers(s: Services): void {
  handle('pool:snapshot', () => s.pool.snapshot());

  handle('pool:setProvider', (req) => {
    if (isCustomProvider(req.id) && !s.pool.custom.find(req.id))
      throw new JarvisError(
        'NOT_FOUND',
        `no custom provider ${req.id}`,
        'That provider does not exist.',
      );
    if (isCustomProvider(req.id) && req.tier !== undefined && req.tier !== 3)
      throw new JarvisError(
        'POLICY_BLOCKED',
        'custom provider tier',
        'Your own providers always stay in tier 3.',
      );
    const all = s.settings.get('pool.providers');
    const { tpd, rpd, ...cur } = all[req.id] ?? {};
    // undefined keeps Sir's number, null clears it, a number replaces it.
    const ownTpd = req.tpd === undefined ? tpd : (req.tpd ?? undefined);
    const ownRpd = req.rpd === undefined ? rpd : (req.rpd ?? undefined);
    s.settings.set('pool.providers', {
      ...all,
      [req.id]: {
        ...cur,
        ...(req.enabled !== undefined ? { enabled: req.enabled } : {}),
        ...(req.tier !== undefined ? { tier: req.tier } : {}),
        ...(ownTpd !== undefined ? { tpd: ownTpd } : {}),
        ...(ownRpd !== undefined ? { rpd: ownRpd } : {}),
      },
    });
    s.audit.append('user', 'pool.provider', {
      provider: req.id,
      ...(req.enabled !== undefined ? { enabled: req.enabled } : {}),
      ...(req.tier !== undefined ? { tier: req.tier } : {}),
      ...(req.tpd !== undefined ? { tpd: req.tpd } : {}),
      ...(req.rpd !== undefined ? { rpd: req.rpd } : {}),
    });
    return s.pool.snapshot();
  });

  handle('pool:setModel', (req) => {
    const all = { ...s.settings.get('pool.models') };
    if (req.enabled !== undefined) all[req.model] = { ...all[req.model], enabled: req.enabled };
    if (req.move) {
      // Moving one model fixes the whole Priority order as it is shown now.
      const ids = s.pool.snapshot().models.map((m) => m.id);
      const i = ids.indexOf(req.model);
      const j = i + req.move;
      if (i >= 0 && j >= 0 && j < ids.length) {
        [ids[i], ids[j]] = [ids[j] as string, ids[i] as string];
        ids.forEach((id, order) => (all[id] = { ...all[id], order }));
      }
    }
    s.settings.set('pool.models', all);
    return s.pool.snapshot();
  });

  handle('pool:settings', (req) => {
    if (req.enabled !== undefined) s.settings.set('pool.enabled', req.enabled);
    if (req.strategy) s.settings.set('pool.strategy', req.strategy);
    if (req.tier3) s.settings.set('pool.tier3', req.tier3);
    if (req.tier3EveryTime !== undefined) s.settings.set('pool.tier3EveryTime', req.tier3EveryTime);
    if (req.keyOrder) s.settings.set('pool.keyOrder', req.keyOrder);
    if (req.checkHours !== undefined) s.settings.set('pool.checkHours', req.checkHours);
    if (req.retryEmpty !== undefined) s.settings.set('pool.retryEmpty', req.retryEmpty);
    for (const k of DELEGATION_KEYS) {
      const v = req.delegation?.[k];
      if (v !== undefined) s.settings.set(`pool.delegation.${k}`, v);
    }
    if (req.weights) s.settings.set('pool.weights', req.weights);
    if (req.learn !== undefined) s.settings.set('pool.learn', req.learn);
    if (req.shrink !== undefined) s.settings.set('pool.shrink', req.shrink);
    for (const k of ABILITY_KEYS) {
      const v = req.abilities?.[k];
      if (v === undefined) continue;
      s.settings.set(`pool.abilities.${k}`, v);
      // Where Sir's recorded voice may go: the audit keeps every change.
      if (k === 'voiceHearing') s.audit.append('user', 'pool.voiceHearing', { enabled: v });
    }
    return s.pool.snapshot();
  });

  handle('pool:checkKeys', async () => {
    s.pool.clearCooldowns();
    s.freeSearch.clearPauses();
    s.images.clearPauses();
    await s.pool.checkKeys();
    return s.pool.snapshot();
  });

  handle('pool:importEnv', (req) => {
    const keys = parseEnvKeys(req.text);
    const found = keys.map((k) => ({ name: k.name, provider: k.provider }));
    const saved: Array<{ provider: string; connectionId: string }> = [];
    const skipped: Array<{ provider: string; reason: string }> = [];
    if (!req.apply) return { found, saved, skipped };
    for (const k of keys) {
      const mine = s.connections.list().filter((c) => c.provider === k.provider);
      if (mine.some((c) => s.secrets.get(c.secret) === k.value)) {
        skipped.push({ provider: k.provider, reason: 'already saved' });
        continue;
      }
      const primary = s.connections.get(defaultConnectionId(k.provider));
      if (!primary.keySet) {
        s.secrets.set(primary.secret, k.value);
        saved.push({ provider: k.provider, connectionId: primary.id });
        continue;
      }
      if (mine.length >= MAX_CONNECTIONS_PER_PROVIDER) {
        skipped.push({
          provider: k.provider,
          reason: `already ${MAX_CONNECTIONS_PER_PROVIDER} keys`,
        });
        continue;
      }
      const conn = s.connections.add(k.provider, 'Imported key');
      s.secrets.set(conn.secret, k.value);
      if (primary.model) s.connections.setModel(conn.id, primary.model);
      saved.push({ provider: k.provider, connectionId: conn.id });
    }
    // Which providers got a key, never the keys.
    s.audit.append('user', 'pool.import_keys', {
      saved: saved.map((x) => x.provider),
      skipped: skipped.length,
    });
    return { found, saved, skipped };
  });

  // Sir's own providers (ADR-045): name and host are audited, never the key.
  handle('pool:addCustom', async (req) => {
    const c = await s.pool.custom.add(req);
    s.audit.append('user', 'pool.custom_add', {
      id: c.id,
      host: c.host,
      keySet: Boolean(req.apiKey),
    });
    return s.pool.snapshot();
  });

  handle('pool:testCustom', async (req) => {
    try {
      await s.pool.testCustom(req);
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: (e instanceof JarvisError && e.userMessage) || 'The test failed.',
      };
    }
  });

  handle('pool:removeCustom', (req) => {
    s.pool.custom.remove(req.id);
    s.audit.append('user', 'pool.custom_remove', { id: req.id });
    return s.pool.snapshot();
  });

  handle('pool:setChains', (req) => {
    const names = req.chains.map((c) => c.name.trim().toLowerCase());
    if (new Set(names).size !== names.length)
      throw new JarvisError('INVALID', 'duplicate chain', 'Two chains have the same name.');
    s.settings.set(
      'pool.chains',
      req.chains.map((c) => ({ name: c.name.trim(), models: [...new Set(c.models)] })),
    );
    return s.pool.snapshot();
  });

  handle('pool:analytics', (req) => s.pool.analytics(req.range));

  handle('pool:testModel', async (req) => {
    const out = await s.pool.testModel(req.model);
    s.audit.append('user', 'pool.test_model', { model: req.model, doors: out.length });
    return out;
  });

  // Sir typed the prompt himself; it still passes the private-data check (keys, cards, passwords).
  handle('pool:image', async (req) => {
    const img = await s.images.generate(req.prompt, req.size, AbortSignal.timeout(240_000), () =>
      s.searchGate({ conversationId: '' }, req.prompt),
    );
    s.audit.append('user', 'pool.image', { path: img.path, by: img.by });
    return {
      path: img.path,
      by: img.by,
      dataUrl: `data:${img.mime};base64,${img.data.toString('base64')}`,
    };
  });

  handle('pool:answer', (req) => {
    s.answerTier3(req.requestId, req.answer);
    s.audit.append('user', 'pool.tier3', { answer: req.answer });
    return { ok: true };
  });
}
