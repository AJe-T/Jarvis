import type { AssistantState } from '@shared/types';

export interface AssistantStateHub {
  get(): AssistantState;
  set(state: AssistantState, detail?: string): void;
  onChange(listener: (state: AssistantState, detail?: string) => void): () => void;
}

/** Single owner of the orb/voice state shown in the UI (Architecture.md §8 state machine). */
export function createAssistantStateHub(): AssistantStateHub {
  let current: AssistantState = 'IDLE';
  const listeners = new Set<(s: AssistantState, d?: string) => void>();
  return {
    get: () => current,
    set(state, detail) {
      if (state === current && detail === undefined) return;
      current = state;
      for (const l of listeners) l(state, detail);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
