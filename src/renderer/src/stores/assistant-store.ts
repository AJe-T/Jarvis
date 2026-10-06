import { create } from 'zustand';
import type { AssistantState } from '@shared/types';

interface AssistantStore {
  state: AssistantState;
  detail: string | undefined;
  micLevel: number;
  outLevel: number;
  transcript: { text: string; isFinal: boolean } | null;
  computerActive: boolean;
  setState(state: AssistantState, detail?: string): void;
  setMicLevel(rms: number): void;
  setOutLevel(level: number): void;
  setTranscript(t: { text: string; isFinal: boolean } | null): void;
  setComputerActive(active: boolean): void;
}

export const useAssistantStore = create<AssistantStore>((set) => ({
  state: 'IDLE',
  detail: undefined,
  micLevel: 0,
  outLevel: 0,
  transcript: null,
  computerActive: false,
  setState: (state, detail) => set({ state, detail }),
  setMicLevel: (micLevel) => set({ micLevel }),
  setOutLevel: (outLevel) => set({ outLevel }),
  setTranscript: (transcript) => set({ transcript }),
  setComputerActive: (computerActive) => set({ computerActive }),
}));
