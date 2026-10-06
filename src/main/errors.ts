export type ErrorCode =
  | 'LLM_AUTH'
  | 'LLM_OVERLOADED'
  | 'LLM_BAD_REQUEST'
  | 'LLM_NETWORK'
  | 'LLM_NO_KEY'
  | 'BUDGET_EXCEEDED'
  | 'KILLED'
  | 'CANCELLED'
  | 'TOOL_TIMEOUT'
  | 'TOOL_FAILED'
  | 'POLICY_BLOCKED'
  | 'PATH_DENIED'
  | 'IPC_FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID'
  | 'INTERNAL';

export class JarvisError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly userMessage?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'JarvisError';
  }
}

/** An error whose message is returned to Claude as an actionable tool_result. */
export class ToolError extends JarvisError {
  constructor(message: string, code: ErrorCode = 'TOOL_FAILED') {
    super(code, message, message);
    this.name = 'ToolError';
  }
}

export class PolicyError extends JarvisError {
  constructor(reason: string) {
    super('POLICY_BLOCKED', reason, reason);
    this.name = 'PolicyError';
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : 'Unknown error';
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && (err.name === 'AbortError' || err.name === 'APIUserAbortError')) ||
    (err instanceof JarvisError && (err.code === 'KILLED' || err.code === 'CANCELLED'))
  );
}
