import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { IMAGE_SIZES, type ImageSize, type PoolAbilities, type PoolTier } from '@shared/free-pool';
import { JarvisError, ToolError } from '../../errors';
import type { SecretStore } from '../../settings/secrets';
import type { SettingsService } from '../../settings/settings-service';
import { defineTool, type Tool } from '../../tools/types';
import type { Connections } from '../connections';
import { createPauses } from './limits';

/**
 * AI Router Phase 3 (Security.md §16.15): pictures from free image models, saved to the vault.
 * Cloudflare Workers AI first (Sir's Cloudflare key, tier 2); Pollinations is a third party
 * (tier 3): used only after Sir's yes, like the chat pool's tier 3. The prompt is checked for
 * private data in code before every request leaves the PC.
 */

const CF_MODEL = '@cf/black-forest-labs/flux-1-schnell';
const POLLINATIONS = 'https://image.pollinations.ai/prompt/';
const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 90_000;
/** Pollinations' free images are at most 768 × 768 pixels in area (⚠️ checked 2026-10-28). */
const POLLINATIONS_SIZE: Record<ImageSize, [number, number]> = {
  square: [768, 768],
  wide: [1024, 576],
  tall: [576, 1024],
};

interface Maker {
  id: 'cloudflare' | 'pollinations';
  name: string;
  model: string;
  tier: PoolTier;
  ready: boolean;
  sizes: readonly ImageSize[];
  note: string;
}

export interface MadeImage {
  /** Vault-relative path of the picture. */
  path: string;
  /** "Cloudflare Workers AI · FLUX.1 [schnell]" */
  by: string;
  mime: 'image/jpeg' | 'image/png';
  data: Buffer;
}

const DAY = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const slug = (prompt: string): string =>
  prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '') || 'image';

export function createImages(deps: {
  settings: SettingsService;
  secrets: Pick<SecretStore, 'get'>;
  connections: Pick<Connections, 'list' | 'target'>;
  /** The pool's tier-3 question ("Use third-party AIs?"), shared with chat. */
  mayUseTier3(): Promise<boolean>;
  vaultRoot(): string;
  fetch?: typeof fetch;
  now?: () => number;
}) {
  const now = (): number => deps.now?.() ?? Date.now();
  const pauses = createPauses(now);

  const cfKey = (): string | undefined => {
    const c = deps.connections.list().find((x) => x.provider === 'cloudflare' && x.keySet);
    return c ? deps.secrets.get(deps.connections.target(c.id).secret) : undefined;
  };

  function makers(): Maker[] {
    const cf = deps.settings.get('pool.providers')['cloudflare'] ?? {};
    const account = deps.settings.get('llm.cloud.cloudflareAccount');
    return [
      {
        id: 'cloudflare',
        name: 'Cloudflare Workers AI',
        model: 'FLUX.1 [schnell]',
        tier: cf.tier ?? 2,
        ready: (cf.enabled ?? true) && account !== '' && Boolean(cfKey()),
        sizes: ['square'],
        note: 'Your Cloudflare key and Account ID (API keys). Square pictures, about 170 a day free.',
      },
      {
        id: 'pollinations',
        name: 'Pollinations',
        model: 'Flux',
        tier: 3,
        ready: deps.settings.get('pool.tier3') === 'ask',
        sizes: IMAGE_SIZES,
        note: 'Third party, no key: asks you first. One picture every 45 seconds, small logo in a corner.',
      },
    ];
  }

  async function fromCloudflare(prompt: string, signal: AbortSignal) {
    const f = deps.fetch ?? fetch;
    const account = deps.settings.get('llm.cloud.cloudflareAccount');
    // ⚠️ Checked 2026-10-28: POST …/ai/run/<model>, Bearer token, { prompt, steps ≤ 8 } → base64 JPEG.
    const res = await f(
      `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${CF_MODEL}`,
      {
        method: 'POST',
        redirect: 'error',
        headers: { authorization: `Bearer ${cfKey() ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, steps: 4 }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
      },
    );
    const text = await res.text();
    if (!res.ok) return { status: res.status, headers: res.headers, text };
    const body = JSON.parse(text) as { result?: { image?: string }; image?: string };
    const b64 = body.result?.image ?? body.image;
    if (!b64) return { status: 502, text: 'no image in the reply' };
    return { image: { mime: 'image/jpeg' as const, data: Buffer.from(b64, 'base64') } };
  }

  async function fromPollinations(prompt: string, size: ImageSize, signal: AbortSignal) {
    const f = deps.fetch ?? fetch;
    const [width, height] = POLLINATIONS_SIZE[size];
    const q = new URLSearchParams({
      width: String(width),
      height: String(height),
      seed: String(Math.floor(Math.random() * 1_000_000)),
      safe: 'true',
    });
    // ⚠️ Checked 2026-10-28: GET image.pollinations.ai/prompt/<prompt>, no key; 402 + retry-after over the limit.
    const res = await f(`${POLLINATIONS}${encodeURIComponent(prompt)}?${q.toString()}`, {
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
    if (!res.ok) return { status: res.status, headers: res.headers, text: await res.text() };
    const type = res.headers.get('content-type') ?? '';
    if (!/^image\/(jpeg|png)/.test(type)) return { status: 502, text: `not a picture (${type})` };
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_BYTES) return { status: 502, text: 'picture too large' };
    return {
      image: {
        mime: type.startsWith('image/png') ? ('image/png' as const) : ('image/jpeg' as const),
        data,
      },
    };
  }

  async function save(prompt: string, by: string, img: { mime: MadeImage['mime']; data: Buffer }) {
    const root = deps.vaultRoot();
    if (!root)
      throw new JarvisError(
        'INVALID',
        'no vault',
        'Set a vault folder in Settings → Memory first.',
      );
    const dir = join(root, 'Images');
    await mkdir(dir, { recursive: true });
    const base = `${DAY(now())}-${slug(prompt)}`;
    const ext = img.mime === 'image/png' ? 'png' : 'jpg';
    let name = base;
    for (let i = 2; existsSync(join(dir, `${name}.${ext}`)); i++) name = `${base}-${i}`;
    await writeFile(join(dir, `${name}.${ext}`), img.data);
    // A note beside it says who made it and from what, so the vault keeps the credit.
    const note = [
      '---',
      'type: image',
      `made_by: "${by}"`,
      `created: ${new Date(now()).toISOString()}`,
      '---',
      `![[${name}.${ext}]]`,
      '',
      `Prompt: ${prompt.replace(/\s+/g, ' ')}`,
      '',
      `Made by ${by}.`,
      '',
    ].join('\n');
    await writeFile(join(dir, `${name}.md`), note, 'utf8');
    return `Images/${name}.${ext}`;
  }

  /**
   * One picture: makers in order (tier 2, then tier 3 after Sir's yes). `check` is the privacy
   * gate, asked before every request.
   */
  async function generate(
    prompt: string,
    size: ImageSize,
    signal: AbortSignal,
    check: () => string | null,
  ): Promise<MadeImage> {
    if (!deps.settings.get('pool.abilities.image'))
      throw new JarvisError(
        'INVALID',
        'images off',
        'Image generation is switched off (AI Router → Abilities).',
      );
    const tried: string[] = [];
    let asked: boolean | null = null;
    const order = makers()
      .filter((m) => m.ready && m.sizes.includes(size))
      .sort((a, b) => a.tier - b.tier);
    for (const m of order) {
      const pause = pauses.active(m.id);
      if (pause) {
        tried.push(`${m.name}: ${pause.reason}`);
        continue;
      }
      const why = check();
      if (why)
        throw new JarvisError(
          'POLICY_BLOCKED',
          'private data for images',
          `Free image models never get Sir's private data (this involves ${why}).`,
        );
      if (m.tier === 3) {
        asked ??= await deps.mayUseTier3();
        if (!asked) {
          tried.push(`${m.name}: you said no to third-party AIs`);
          continue;
        }
      }
      try {
        const r =
          m.id === 'cloudflare'
            ? await fromCloudflare(prompt, signal)
            : await fromPollinations(prompt, size, signal);
        if ('image' in r && r.image) {
          pauses.ok(m.id);
          const by = `${m.name}${m.tier === 3 ? ', a third-party AI' : ''} · ${m.model}`;
          return { path: await save(prompt, by, r.image), by, ...r.image };
        }
        tried.push(`${m.name}: ${pauses.fail(m.id, r)}`);
      } catch (err) {
        if (signal.aborted) throw err;
        tried.push(`${m.name}: ${pauses.fail(m.id, {})}`);
      }
    }
    throw new JarvisError(
      'LLM_OVERLOADED',
      'no free image model',
      tried.length
        ? `No free image model could make it (${tried.join(', ')}).`
        : size === 'square'
          ? 'No free image model is set up: add a Cloudflare key and Account ID (AI Router → API keys), or allow third-party AIs.'
          : 'Wide and tall pictures come only from Pollinations, a third party: allow third-party AIs on AI Router → Tiers & privacy.',
    );
  }

  function status(): PoolAbilities['image'] {
    return makers().map((m) => {
      const pause = pauses.active(m.id);
      return {
        id: m.id,
        name: m.name,
        model: m.model,
        tier: m.tier,
        ready: m.ready,
        sizes: [...m.sizes],
        note: m.note,
        ...(pause
          ? { pause: { until: new Date(pause.until).toISOString(), reason: pause.reason } }
          : {}),
      };
    });
  }

  return { generate, status, clearPauses: pauses.clear };
}
export type Images = ReturnType<typeof createImages>;

/** generate_image: one picture, saved to the vault; the reply says who made it. */
export function createImageTool(deps: {
  images: Images;
  gate(
    where: { conversationId: string; private?: string | undefined },
    text: string,
  ): string | null;
}): Tool {
  return defineTool({
    name: 'generate_image',
    description:
      "Make a picture from a description with a free image model (a logo, an illustration, a poster) and save it to the vault under Images/. Size: square (default), wide or tall. Describe only what to draw: never Sir's private details. Returns where it was saved and which model made it; tell Sir both.",
    input: z.object({
      prompt: z.string().trim().min(3).max(1000),
      size: z.enum(IMAGE_SIZES).default('square'),
    }),
    tier: 'SAFE',
    // The description leaves the PC: after outside content, Sir confirms first.
    externalFacing: true,
    // Room for the "Use third-party AIs?" question (2 min) and a slow model.
    timeoutMs: 240_000,
    summarize: ({ prompt, size }) => `Draw (${size}): ${prompt.slice(0, 80)}`,
    async run({ prompt, size }, ctx) {
      try {
        const img = await deps.images.generate(prompt, size, ctx.signal, () =>
          deps.gate({ conversationId: ctx.conversationId, private: ctx.private }, prompt),
        );
        return {
          content: [
            {
              type: 'text',
              text: `Saved to the vault at ${img.path}. Made by ${img.by}.`,
            },
          ],
        };
      } catch (err) {
        if (err instanceof JarvisError && err.userMessage) throw new ToolError(err.userMessage);
        throw err;
      }
    },
  });
}
