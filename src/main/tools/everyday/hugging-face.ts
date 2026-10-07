import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Tier } from '@shared/types';
import { ToolError } from '../../errors';
import type { PathGuard } from '../../security/path-guard';
import { defineTool, fail, ok, type Tool, type ToolContent } from '../types';

/**
 * HuggingGPT, the idea behind microsoft/JARVIS: Claude is the controller that plans the task, picks
 * an expert model from the Hugging Face Hub (find_ai_models), runs it (run_ai_model) and explains the
 * result. Uses Hugging Face's serverless "HF Inference" provider (verified 2026-10 against
 * huggingface.co/docs/inference-providers/providers/hf-inference ⚠️ this API drifts).
 */

const HUB = 'https://huggingface.co/api/models';
const ROUTER = 'https://router.huggingface.co/hf-inference/models';
const MAX_FILE = 20 * 1024 * 1024;
const MAX_OUTPUT = 8_000;

/** The tasks HF Inference serves, with a well-known default model for each. */
const TASK_DEFAULTS = {
  'image-classification': 'google/vit-base-patch16-224',
  'object-detection': 'facebook/detr-resnet-50',
  'image-segmentation': 'jonathandinu/face-parsing',
  'automatic-speech-recognition': 'openai/whisper-large-v3',
  'text-classification': 'distilbert/distilbert-base-uncased-finetuned-sst-2-english',
  'token-classification': 'dslim/bert-base-NER',
  'zero-shot-classification': 'facebook/bart-large-mnli',
  summarization: 'facebook/bart-large-cnn',
  translation: 'Helsinki-NLP/opus-mt-en-fr',
  'question-answering': 'deepset/roberta-base-squad2',
  'fill-mask': 'google-bert/bert-base-uncased',
  'text-to-image': 'stabilityai/stable-diffusion-3-medium-diffusers',
} as const;
type Task = keyof typeof TASK_DEFAULTS;
const TASKS = Object.keys(TASK_DEFAULTS) as [Task, ...Task[]];

/** These tasks take a file (image or audio) as the request body. */
const FILE_TASKS = new Set<Task>([
  'image-classification',
  'object-detection',
  'image-segmentation',
  'automatic-speech-recognition',
]);

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm',
};

const modelId = z
  .string()
  .regex(/^\w[\w.-]*\/\w[\w.-]*$/, 'A Hugging Face model id looks like "owner/name".')
  .max(120);

const RunInput = z.object({
  task: z.enum(TASKS),
  model: modelId.optional(),
  /** Text input (all text tasks; the prompt for text-to-image; the question for question-answering). */
  text: z.string().min(1).max(20_000).optional(),
  /** Image or audio file for the vision and speech tasks. */
  file: z.string().min(3).max(1024).optional(),
  /** zero-shot-classification. */
  labels: z.array(z.string().min(1).max(60)).min(2).max(20).optional(),
  /** question-answering: the passage to answer from. */
  context: z.string().min(1).max(20_000).optional(),
  /** text-to-image: where to save the picture (.png or .jpg, in the allowed folders). */
  save_to: z.string().min(3).max(1024).optional(),
});
type RunInput = z.infer<typeof RunInput>;

/** Drops big binary blobs (segmentation masks) so results stay readable. */
function compact(value: unknown): string {
  const text = JSON.stringify(value, (k, v: unknown) =>
    k === 'mask' && typeof v === 'string' ? '[mask omitted]' : v,
  );
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}…` : text;
}

function requestBody(i: RunInput): Record<string, unknown> {
  switch (i.task) {
    case 'zero-shot-classification':
      return { inputs: i.text, parameters: { candidate_labels: i.labels } };
    case 'question-answering':
      return { inputs: { question: i.text, context: i.context } };
    default:
      return { inputs: i.text };
  }
}

/** Checks the inputs each task needs before anything leaves the PC. */
function missing(i: RunInput): string | null {
  if (FILE_TASKS.has(i.task)) return i.file ? null : `${i.task} needs a file.`;
  if (!i.text) return `${i.task} needs text.`;
  if (i.task === 'zero-shot-classification' && !i.labels)
    return 'zero-shot-classification needs labels.';
  if (i.task === 'question-answering' && !i.context) return 'question-answering needs context.';
  if (i.task === 'text-to-image' && !i.save_to) return 'text-to-image needs save_to.';
  return null;
}

export function createHuggingFaceTools(deps: {
  token(): string | undefined;
  guard: PathGuard;
  fetch?: typeof fetch;
}): Tool[] {
  const f = deps.fetch ?? fetch;

  async function call(i: RunInput, signal: AbortSignal): Promise<{ type: string; body: Buffer }> {
    const token = deps.token();
    if (!token)
      throw new ToolError(
        'No Hugging Face token yet. Sir can add a free one in Settings → Everyday → AI models.',
      );
    const model = i.model ?? TASK_DEFAULTS[i.task];
    let body: string | Uint8Array;
    let contentType = 'application/json';
    if (FILE_TASKS.has(i.task)) {
      const file = deps.guard.resolve(i.file ?? '');
      const size = (await stat(file)).size;
      if (size > MAX_FILE) throw new ToolError(`${path.basename(file)} is over 20 MB.`);
      contentType = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      body = new Uint8Array(await readFile(file));
    } else body = JSON.stringify(requestBody(i));
    const res = await f(`${ROUTER}/${model}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
      body,
      signal: AbortSignal.any([signal, AbortSignal.timeout(110_000)]),
    });
    const out = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      const why = out.toString('utf8').slice(0, 300);
      if (res.status === 401) throw new ToolError('Hugging Face rejected the token (401).');
      if (res.status === 404)
        throw new ToolError(`${model} isn't served by HF Inference. Try find_ai_models.`);
      throw new ToolError(`Hugging Face answered ${res.status}: ${why}`);
    }
    return { type: res.headers.get('content-type') ?? '', body: out };
  }

  return [
    defineTool({
      name: 'find_ai_models',
      description:
        'Search the Hugging Face Hub for expert AI models that can run a task (HuggingGPT model selection). Returns the most downloaded models served by HF Inference, with likes and licence. Pick one and pass its id to run_ai_model. Tasks: ' +
        TASKS.join(', '),
      input: z.object({
        task: z.enum(TASKS),
        search: z.string().max(60).optional(),
        limit: z.number().int().min(1).max(10).default(5),
      }),
      tier: 'SAFE',
      untrustedOutput: true,
      summarize: ({ task, search }) => `Find ${task} models${search ? ` for "${search}"` : ''}`,
      async run({ task, search, limit }, ctx) {
        const q = new URLSearchParams({
          pipeline_tag: task,
          inference_provider: 'hf-inference',
          sort: 'downloads',
          limit: String(limit),
          ...(search ? { search } : {}),
        });
        const res = await f(`${HUB}?${q.toString()}`, {
          signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(15_000)]),
        });
        if (!res.ok) throw new ToolError(`The Hugging Face Hub answered ${res.status}.`);
        const models = (await res.json()) as Array<{
          id: string;
          downloads?: number;
          likes?: number;
          tags?: string[];
        }>;
        if (models.length === 0)
          return ok(`No ${task} models found. The default is ${TASK_DEFAULTS[task]}.`);
        return {
          content: [
            {
              type: 'text',
              text: models
                .map(
                  (m) =>
                    `${m.id} — ${m.downloads ?? 0} downloads, ${m.likes ?? 0} likes, ${
                      m.tags?.find((t) => t.startsWith('license:'))?.slice(8) ?? 'licence unknown'
                    }`,
                )
                .join('\n'),
            },
          ],
          untrustedSource: 'huggingface.co',
        };
      },
    }),
    defineTool({
      name: 'run_ai_model',
      description:
        'Run an expert AI model on Hugging Face (HuggingGPT task execution): classify or detect objects in an image, transcribe audio, translate, summarise, classify text, answer from a passage, or generate an image (saved to save_to). Plan multi-step jobs yourself and chain calls. Omit model to use a good default. Sends the input to Hugging Face.',
      input: RunInput,
      // Sending a local file or writing a new picture needs Sir's OK; plain text tasks don't.
      tier: (i): Tier => (i.file || i.task === 'text-to-image' ? 'CONFIRM' : 'SAFE'),
      externalFacing: true,
      untrustedOutput: true,
      timeoutMs: 120_000,
      summarize: (i) =>
        `Run ${i.model ?? TASK_DEFAULTS[i.task]} (${i.task})${i.file ? ` on ${path.basename(i.file)}` : ''}`,
      confirm: (i) => ({
        title:
          i.task === 'text-to-image'
            ? 'Generate an image with Hugging Face?'
            : 'Send this file to Hugging Face?',
        actionLabel: i.task === 'text-to-image' ? 'Generate' : 'Send',
        details: i.file ?? `"${i.text ?? ''}" → ${i.save_to ?? ''}`,
        detailsKind: i.file ? 'paths' : 'text',
      }),
      guards: (i) => ({
        paths: [i.file, i.save_to].filter((p): p is string => !!p),
        text: [i.text, i.context].filter((t): t is string => !!t),
      }),
      async run(i, ctx) {
        const problem = missing(i);
        if (problem) return fail(problem);
        const target = i.task === 'text-to-image' ? deps.guard.resolve(i.save_to ?? '') : null;
        if (target && !/\.(png|jpe?g)$/i.test(target))
          return fail('save_to must end in .png or .jpg.');
        const { type, body } = await call(i, ctx.signal);
        if (target) {
          if (!type.startsWith('image/'))
            return fail(`Expected an image, got ${type || 'nothing'}.`);
          await writeFile(target, body);
          const content: ToolContent[] = [{ type: 'text', text: `Saved the image to ${target}.` }];
          // Show Claude the picture too when it's a format and size it can take.
          if ((type === 'image/png' || type === 'image/jpeg') && body.length < 4 * 1024 * 1024)
            content.push({
              type: 'image',
              source: { type: 'base64', media_type: type, data: body.toString('base64') },
            });
          return { content, untrusted: false };
        }
        const text = body.toString('utf8');
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          // plain text answer
        }
        return {
          content: [{ type: 'text', text: typeof parsed === 'string' ? parsed : compact(parsed) }],
          untrustedSource: `huggingface:${i.model ?? TASK_DEFAULTS[i.task]}`,
        };
      },
    }),
  ];
}
