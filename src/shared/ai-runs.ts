import { z } from 'zod';
import { BrainRefSchema, type BrainRef } from './llm-providers';

/**
 * Integrations step 4: one request to several AIs.
 * - compare: every AI answers the same prompt at the same time; shown side by side.
 * - review: the first AI answers, the second reviews that answer (mistakes, gaps, a better version).
 * - chain: each stage gets the request and the previous stage's output, plus its own instruction.
 * Answers only: no tools, so nothing on the PC changes and no outside content is read.
 */
export const RUN_MODES = ['compare', 'review', 'chain'] as const;
export type RunMode = (typeof RUN_MODES)[number];
export const MAX_RUN_STEPS = 4;
export const MAX_RUN_PROMPT = 20_000;

export const RunRequestSchema = z
  .object({
    mode: z.enum(RUN_MODES),
    prompt: z.string().trim().min(1).max(MAX_RUN_PROMPT),
    steps: z
      .array(z.object({ brain: BrainRefSchema, instruction: z.string().max(2000).default('') }))
      .min(1)
      .max(MAX_RUN_STEPS),
  })
  .refine((r) => (r.mode === 'review' ? r.steps.length === 2 : r.steps.length >= 2), {
    message: 'Compare and chain need 2–4 AIs; review needs exactly 2.',
  });
export type RunRequest = z.input<typeof RunRequestSchema>;

export type RunStatus = 'running' | 'done' | 'partial' | 'failed' | 'cancelled';
export type StepStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface RunStepView {
  idx: number;
  brain: BrainRef;
  label: string;
  role: 'answer' | 'review' | 'stage';
  instruction: string;
  status: StepStatus;
  output: string;
  error: string | null;
  model: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface RunView {
  id: string;
  mode: RunMode;
  prompt: string;
  status: RunStatus;
  createdAt: string;
  finishedAt: string | null;
  steps: RunStepView[];
}

export const RunStepSchema = z.object({
  idx: z.number().int(),
  brain: BrainRefSchema,
  label: z.string(),
  role: z.enum(['answer', 'review', 'stage']),
  instruction: z.string(),
  status: z.enum(['queued', 'running', 'done', 'failed', 'cancelled']),
  output: z.string(),
  error: z.string().nullable(),
  model: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
});

export const RunViewSchema = z.object({
  id: z.string(),
  mode: z.enum(RUN_MODES),
  prompt: z.string(),
  status: z.enum(['running', 'done', 'partial', 'failed', 'cancelled']),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  steps: z.array(RunStepSchema),
});
