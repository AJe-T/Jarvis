import { create } from 'zustand';
import type { AssistantState } from '@shared/types';

interface AssistantStore {
  state: AssistantState;
  detail: string | undefined;
  micLevel: number;
  outLevel: number;
  musicLevel: number;
  transcript: { text: string; isFinal: boolean } | null;
  computerActive: boolean;
  setState(state: AssistantState, detail?: string): void;
  setMicLevel(rms: number): void;
  setOutLevel(level: number): void;
  setMusicLevel(rms: number): void;
  setTranscript(t: { text: string; isFinal: boolean } | null): void;
  setComputerActive(active: boolean): void;
}

export const useAssistantStore = create<AssistantStore>((set) => ({
  state: 'IDLE',
  detail: undefined,
  micLevel: 0,
  outLevel: 0,
  musicLevel: 0,
  transcript: null,
  computerActive: false,
  setState: (state, detail) => set({ state, detail }),
  setMicLevel: (micLevel) => set({ micLevel }),
  setOutLevel: (outLevel) => set({ outLevel }),
  setMusicLevel: (musicLevel) => set({ musicLevel }),
  setTranscript: (transcript) => set({ transcript }),
  setComputerActive: (computerActive) => set({ computerActive }),
}));

/** What the orb follows (§6.1): Jarvis's voice, Sir's voice, otherwise music playing on the PC. */
export function selectOrbLevel(s: AssistantStore): number {
  if (s.state === 'SPEAKING') return s.outLevel;
  if (s.state === 'LISTENING') return s.micLevel;
  return s.musicLevel;
}
