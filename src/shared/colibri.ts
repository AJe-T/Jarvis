/**
 * colibri (JustVugg/colibri, Apache-2.0): runs large mixture-of-experts models on an ordinary PC by
 * keeping the always-used part in RAM and reading the experts from disk. It serves an
 * OpenAI-compatible API, so Jarvis's local-model connection talks to it like Ollama.
 *
 * The models below are its chat models that call tools, copied as facts (sizes, RAM) from its
 * README "Which model for my machine" table, checked 2026-11-04. RAM is two numbers: below
 * `minRamGb` it does not start, from `goodRamGb` it runs at the measured speed.
 */
export const COLIBRI_BASE_URL = 'http://127.0.0.1:8000/v1';
export const COLIBRI_CHECKED = '2026-11-04';

export interface ColibriModel {
  id: string;
  name: string;
  downloadGb: number;
  minRamGb: number;
  goodRamGb: number;
  /** Experts stream from the disk: about 1–4 words a second, a fast NVMe drive helps most. */
  streams: boolean;
  note: string;
}

export const COLIBRI_MODELS: readonly ColibriModel[] = [
  {
    id: 'qwen3-coder-30b',
    name: 'Qwen3-Coder-30B-A3B',
    downloadGb: 19,
    minRamGb: 8,
    goodRamGb: 18,
    streams: false,
    note: 'code and tool calls, no thinking',
  },
  {
    id: 'qwen36-35b',
    name: 'Qwen3.6-35B-A3B',
    downloadGb: 23,
    minRamGb: 10,
    goodRamGb: 20,
    streams: false,
    note: 'chat with thinking and tools (the best all-rounder)',
  },
  {
    id: 'deepseek-v4-flash-reap',
    name: 'DeepSeek V4 Flash REAP 150B',
    downloadGb: 85,
    minRamGb: 16,
    goodRamGb: 32,
    streams: true,
    note: 'tools; experts stream from the disk',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash (284B)',
    downloadGb: 167,
    minRamGb: 16,
    goodRamGb: 32,
    streams: true,
    note: 'tools; about 1 word a second on a desktop CPU',
  },
  {
    id: 'qwen38-flash-next',
    name: 'Qwen3.8-Flash-Next',
    downloadGb: 186,
    minRamGb: 24,
    goodRamGb: 32,
    streams: true,
    note: 'vision and tools; experts stream from the disk',
  },
];

export interface ColibriFit {
  model: ColibriModel;
  /** 'good': RAM at least goodRamGb; 'slow': it starts but below the measured speed. */
  fit: 'good' | 'slow' | 'no-ram' | 'no-disk';
}

/** Every model against this PC, and the one to start with (the most capable that runs from RAM). */
export function fitColibri(
  ramGb: number,
  freeDiskGb: number,
): { fits: ColibriFit[]; recommended: ColibriModel | null } {
  const fits = COLIBRI_MODELS.map((model): ColibriFit => {
    if (ramGb < model.minRamGb) return { model, fit: 'no-ram' };
    if (freeDiskGb < model.downloadGb + 2) return { model, fit: 'no-disk' };
    return { model, fit: ramGb >= model.goodRamGb ? 'good' : 'slow' };
  });
  const runnable = fits.filter((f) => f.fit === 'good' || f.fit === 'slow');
  const rank = (f: ColibriFit): number =>
    (f.model.streams ? 0 : 2) + (f.fit === 'good' ? 1 : 0) + f.model.minRamGb / 1000;
  const best = [...runnable].sort((a, b) => rank(b) - rank(a))[0];
  return { fits, recommended: best?.model ?? null };
}
