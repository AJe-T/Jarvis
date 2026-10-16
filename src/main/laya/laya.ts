import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { errorMessage } from '../errors';
import { inference } from '../inference/client';
import type { Logger } from '../logging/logger';
import type { Intent, JudgeContext } from '../voice/conversation';
import MODELS from '../voice/local/models.json';

/**
 * ADR-027: Laya (Apache-2.0, run by laya-ts on onnxruntime-node) answers small typed questions about
 * text on this PC in one forward pass, with no text generation. Jarvis asks it one thing: is this
 * speech meant for Jarvis? When it is sure it isn't, the Claude intent judge isn't called.
 * It never holds anything up: while the model loads, or when it is slow or fails, Claude decides.
 */

export type LayaMode = 'off' | 'shadow' | 'on';

// A type alias, not an interface, so it fits laya-ts's open-ended QuestionDef.
type ChoiceQuestion = {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
};

export interface Decider {
  predict(
    state: Record<string, string>,
    questions: Record<string, ChoiceQuestion>,
  ): Promise<Record<string, { probabilities: Record<string, number> }>>;
}

/**
 * Below this chance that speech is meant for Jarvis, 'on' mode skips Claude. Measured on the fp32
 * export (2026-10-10, tests/integration/laya.real.test.ts): all 10 phrases for Jarvis scored 0.67
 * or more, 3 of 4 phrases about Jarvis scored under 0.3. Small sample, so 'shadow' comes first.
 */
export const SKIP_JUDGE_BELOW = 0.3;
/** A decision slower than this is dropped and Claude decides. CPU takes about 0.3 s per question. */
const ANSWER_TIMEOUT_MS = 1500;

// Choice wording over the newest phrase alone: in tests it separated far better than a yes/no
// question over the whole transcript, which mixed everyone's speech together.
const ADDRESSED: ChoiceQuestion = {
  type: 'choice',
  instructions: 'Who is the `utterance` spoken to?',
  criteria: {
    jarvis: 'the voice assistant Jarvis: a command, question, answer or remark meant for it',
    someone_else: 'another person in the room, possibly talking about Jarvis',
  },
};

const FILES = MODELS['laya-multilingual'].files;
/** "Jarvis, …" / "Hey Jarvis …" is plainly an address; Laya can only get that wrong, so Claude decides. */
const ADDRESSED_BY_NAME = /^\W*(?:hey |ok |okay )?jarvis\b/i;

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/**
 * `dir` is models/laya-multilingual. Every file is checked against its pinned SHA-256 before the
 * native runtime opens it (streamed: laya-ts's own check would read 1.2 GB into memory).
 */
export async function loadDecider(dir: string, numThreads?: number): Promise<Decider> {
  for (const f of FILES)
    if ((await sha256(join(dir, f.path))) !== f.sha256)
      throw new Error(`${f.path} doesn't match its pinned hash; reinstall Laya`);
  const { Agent } = await import('laya-ts');
  const agent = await Agent.load(dir, { device: 'cpu', ...(numThreads ? { numThreads } : {}) });
  return {
    async predict(state, questions) {
      const { answers } = await agent.predict(state, questions);
      return answers as Record<string, { probabilities: Record<string, number> }>;
    },
  };
}

/** The decider in the model process (ADR-029): a 1.2 GB model must never run on the main thread. */
async function isolatedDecider(dir: string): Promise<Decider> {
  const ops = inference();
  await ops.layaWarm({ dir });
  return { predict: (state, questions) => ops.layaPredict({ dir, state, questions }) };
}

export function createLaya(deps: {
  modelDir: string;
  mode(): LayaMode;
  /** The fast path also uses Laya (ADR-030), whatever the listening filter's mode. */
  fastPath?(): boolean;
  logger: Logger;
  /** Tests inject a fake. */
  load?(dir: string): Promise<Decider>;
}) {
  const log = deps.logger.child({ module: 'laya' });
  let started = false;
  let loaded: Decider | null = null;

  // laya-ts treats a missing folder as a Hub repo name and downloads it, so only load what's installed.
  const installed = (): boolean =>
    !!deps.load ||
    FILES.every((f) => {
      const p = join(deps.modelDir, f.path);
      return existsSync(p) && statSync(p).size === f.size;
    });

  /** Starts loading in the background; decisions return null until it is ready. */
  function warm(): void {
    if (started || (deps.mode() === 'off' && !deps.fastPath?.()) || !installed()) return;
    started = true;
    (deps.load ?? isolatedDecider)(deps.modelDir).then(
      (d) => {
        loaded = d;
        log.info('Laya model loaded');
      },
      // Not retried until the next start: a broken model would otherwise reload on every phrase.
      (err: unknown) => log.warn({ err: errorMessage(err) }, 'Laya model failed to load'),
    );
  }

  /** One question's probabilities, or null while loading, when slow (over 1.5 s) or on failure. */
  async function ask(
    state: Record<string, string>,
    q: ChoiceQuestion,
  ): Promise<Record<string, number> | null> {
    warm();
    if (!loaded) return null;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ANSWER_TIMEOUT_MS);
    });
    try {
      const answers = await Promise.race([loaded.predict(state, { q }), timeout]);
      return answers?.['q']?.probabilities ?? null;
    } catch (err) {
      log.warn({ err: errorMessage(err) }, 'Laya decision failed');
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Chance (0–1) that the newest phrase is meant for Jarvis; null when Laya can't say in time. */
  async function addressed(ctx: JudgeContext): Promise<number | null> {
    const state = ctx.followUp
      ? { jarvis_just_said: ctx.lastReply, utterance: ctx.heard }
      : { utterance: ctx.heard };
    return (await ask(state, ADDRESSED))?.['jarvis'] ?? null;
  }

  return {
    installed,
    warm,
    addressed,

    /** ADR-030: which of `choices` (key → what it means) the request is; null when Laya can't say. */
    classify: (request: string, choices: Record<string, string>) =>
      ask(
        { request },
        {
          type: 'choice',
          instructions: 'What does the `request` to a PC voice assistant ask it to do?',
          criteria: choices,
        },
      ),

    /**
     * Wraps the Claude intent judge (ADR-012). 'on': when Laya is sure the speech isn't for Jarvis,
     * Claude isn't asked. 'shadow': both run side by side and only the agreement is logged.
     * Only numbers are logged, never what was said.
     */
    gateJudge(
      judge: (transcript: string, ctx: JudgeContext) => Promise<Intent>,
    ): (transcript: string, ctx: JudgeContext) => Promise<Intent> {
      return async (transcript, ctx) => {
        const mode = deps.mode();
        if (mode === 'off' || ADDRESSED_BY_NAME.test(ctx.heard)) return judge(transcript, ctx);
        if (mode === 'on') {
          const p = await addressed(ctx);
          if (p !== null && p < SKIP_JUDGE_BELOW) {
            log.info({ laya: round(p) }, 'Laya: speech not for Jarvis; judge skipped');
            return { directed: false, query: '' };
          }
          return judge(transcript, ctx);
        }
        const [p, intent] = await Promise.all([addressed(ctx), judge(transcript, ctx)]);
        if (p !== null)
          log.info(
            {
              laya: round(p),
              claude: intent.directed,
              wouldSkip: p < SKIP_JUDGE_BELOW,
              wrong: p < SKIP_JUDGE_BELOW && intent.directed,
            },
            'Laya shadow: intent',
          );
        return intent;
      };
    },
  };
}

const round = (n: number): number => Math.round(n * 100) / 100;

export type Laya = ReturnType<typeof createLaya>;
