/**
 * Runaway-agent circuit breaker (idea from Munder Difflin's steer → constrain → stop ladder; no
 * code copied). Per turn it watches tool results:
 *  - steer: the same call (tool + input) that already failed twice is refused with a hint to try
 *    something else, instead of being run a third time;
 *  - constrain: after too many failures in a row, every further tool call in the turn is refused,
 *    so the model has to stop and tell Sir what is blocking it.
 * Repeating a call that worked (a computer-control screenshot) is normal and never counted.
 */

export const SAME_CALL_FAILURES = 2;
export const FAILURES_IN_A_ROW = 6;
/** Turns remembered at once; older ones are forgotten (a turn never runs this long). */
const MAX_TURNS = 20;

export type BreakerVerdict =
  { ok: true } | { ok: false; reason: 'repeat' | 'tripped'; text: string };

interface TurnState {
  failedCalls: Map<string, number>;
  inARow: number;
  tripped: boolean;
}

export interface CircuitBreaker {
  check(turnId: string, tool: string, input: unknown): BreakerVerdict;
  /** Returns true when this result tripped the breaker for the rest of the turn. */
  record(turnId: string, tool: string, input: unknown, isError: boolean): boolean;
}

const signature = (tool: string, input: unknown): string => `${tool}:${JSON.stringify(input)}`;

export function createCircuitBreaker(): CircuitBreaker {
  const turns = new Map<string, TurnState>();

  const stateOf = (turnId: string): TurnState => {
    let s = turns.get(turnId);
    if (!s) {
      s = { failedCalls: new Map(), inARow: 0, tripped: false };
      turns.set(turnId, s);
      // ponytail: insertion-order eviction; a Map keeps it, no LRU needed for 20 entries.
      if (turns.size > MAX_TURNS) turns.delete(turns.keys().next().value as string);
    }
    return s;
  };

  return {
    check(turnId, tool, input) {
      const s = stateOf(turnId);
      if (s.tripped)
        return {
          ok: false,
          reason: 'tripped',
          text: `Not executed: ${FAILURES_IN_A_ROW} actions in a row failed, so Jarvis's circuit breaker stopped tool use for this request. Do not call more tools; tell sir plainly what went wrong and what he could do.`,
        };
      if ((s.failedCalls.get(signature(tool, input)) ?? 0) >= SAME_CALL_FAILURES)
        return {
          ok: false,
          reason: 'repeat',
          text: `Not executed: ${tool} already failed ${SAME_CALL_FAILURES} times with exactly this input. Don't retry it unchanged; try a different approach or ask sir.`,
        };
      return { ok: true };
    },
    record(turnId, tool, input, isError) {
      const s = stateOf(turnId);
      if (!isError) {
        s.inARow = 0;
        return false;
      }
      const sig = signature(tool, input);
      s.failedCalls.set(sig, (s.failedCalls.get(sig) ?? 0) + 1);
      s.inARow += 1;
      if (s.inARow < FAILURES_IN_A_ROW || s.tripped) return false;
      s.tripped = true;
      return true;
    },
  };
}
