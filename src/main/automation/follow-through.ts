/**
 * Nudge follow-through (lesson from ruflo's nightly "dream cycle" ledger: 94 % of its suggestions were
 * never acted on, and nothing noticed). A check-in or task result Sir never answers counts as ignored;
 * after IGNORED_LIMIT in a row Jarvis suggests pausing it once. Nothing is paused by itself.
 */
export const IGNORED_LIMIT = 5;

export function createFollowThrough(onIgnored: (taskId: string) => void) {
  // ponytail: in memory, so a restart starts every count again; persist if nudges run rarely.
  const waiting = new Map<string, string>(); // result conversation → task
  const lastResult = new Map<string, string>(); // task → its latest result conversation
  const streak = new Map<string, number>();

  return {
    /** A run delivered a result in this conversation; the previous one, if unanswered, was ignored. */
    delivered(taskId: string, conversationId: string): void {
      const prev = lastResult.get(taskId);
      if (prev && waiting.delete(prev)) {
        const n = (streak.get(taskId) ?? 0) + 1;
        if (n >= IGNORED_LIMIT) {
          streak.delete(taskId);
          onIgnored(taskId);
        } else streak.set(taskId, n);
      }
      waiting.set(conversationId, taskId);
      lastResult.set(taskId, conversationId);
    },
    /** Sir wrote in this conversation: if it holds a result, he engaged with it. */
    replied(conversationId: string): void {
      const taskId = waiting.get(conversationId);
      if (!taskId) return;
      waiting.delete(conversationId);
      streak.delete(taskId);
    },
  };
}
