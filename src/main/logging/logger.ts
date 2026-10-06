import pino, { type Logger } from 'pino';
import { redact, redactDeep } from '../security/redact';

export type { Logger };

// Code-style.md §4.2. The logger is one of two allowed singletons. Output goes to a sink that is
// pointed at the rotating log file once the app knows its userData path.
let target: { write(s: string): void } | null = null;
const devEcho = !process.env['JARVIS_TEST'] && process.env['NODE_ENV'] !== 'production';

const sink = {
  write(line: string): void {
    target?.write(line);
    if (devEcho) process.stdout.write(line);
  },
};

export const logger: Logger = pino(
  {
    level: process.env['JARVIS_LOG_LEVEL'] ?? (process.env['JARVIS_TEST'] ? 'silent' : 'info'),
    base: null,
    redact: {
      paths: [
        'apiKey',
        '*.apiKey',
        'value',
        '*.value',
        'headers.authorization',
        '*.headers.authorization',
        'env',
        '*.env',
      ],
      censor: '[REDACTED]',
    },
    formatters: { log: (obj) => redactDeep(obj) },
    hooks: {
      logMethod(args, method) {
        const clean = args.map((a: unknown) => (typeof a === 'string' ? redact(a) : a));
        method.apply(this, clean as Parameters<typeof method>);
      },
    },
  },
  sink,
);

/** Security.md §9 / TRD §5.4: daily rotation, 14-day retention. */
export async function initFileLogging(dir: string): Promise<void> {
  const { default: roll } = (await import('pino-roll')) as {
    default: (opts: Record<string, unknown>) => Promise<{ write(s: string): void }>;
  };
  target = await roll({
    file: `${dir}/jarvis`,
    extension: '.log',
    frequency: 'daily',
    mkdir: true,
    limit: { count: 14 },
  });
}
