import { create } from 'zustand';
import { call } from '../../lib/api';
import { Tier3Question } from './tiers-tab';

/** Main's "may a third-party AI answer?" question (pool:ask), wherever Sir is in the app. */
export const useTier3 = create<{ ask: { requestId: string; soonestMin: number | null } | null }>(
  () => ({ ask: null }),
);

export function Tier3Host(): React.JSX.Element | null {
  const ask = useTier3((s) => s.ask);
  if (!ask) return null;
  const answer = (a: 'once' | 'session' | 'no'): void => {
    useTier3.setState({ ask: null });
    void call('pool:answer', { requestId: ask.requestId, answer: a });
  };
  return <Tier3Question open soonestMin={ask.soonestMin} onAnswer={answer} />;
}
