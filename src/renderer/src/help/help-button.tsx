import * as Dialog from '@radix-ui/react-dialog';
import { CircleHelp, X } from 'lucide-react';
import clsx from 'clsx';
import { HELP } from './help-content';

/**
 * The small "?" beside a page or section title. Opens what the feature is, how to use it, what to
 * say to Jarvis and tips. Renders nothing for a topic without help text.
 */
export function HelpButton({
  topic,
  className,
}: {
  topic: string;
  className?: string;
}): React.JSX.Element | null {
  const h = HELP[topic];
  if (!h) return null;
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={`Help: ${h.title}`}
          title={`What is ${h.title}?`}
          className={clsx(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-pill text-ink-500 transition-colors duration-[120ms] hover:bg-hover hover:text-accent-300 focus-visible:outline-2 focus-visible:outline-accent-500',
            className,
          )}
        >
          <CircleHelp size={16} aria-hidden />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="scrim fade-in fixed inset-0 z-40" />
        <Dialog.Content className="dialog modal-in fixed top-1/2 left-1/2 z-50 flex max-h-[min(80vh,640px)] w-[min(34rem,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col p-0">
          <div className="flex items-center gap-2 border-b border-line-subtle px-5 py-3">
            <CircleHelp size={18} aria-hidden className="text-accent-300" />
            <Dialog.Title className="flex-1 text-lg font-semibold text-ink-100">
              {h.title}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close help"
              className="inline-flex size-8 items-center justify-center rounded-sm text-ink-500 hover:bg-hover hover:text-ink-100"
            >
              <X size={16} aria-hidden />
            </Dialog.Close>
          </div>
          <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4 text-sm">
            <Dialog.Description className="text-ink-300">{h.what}</Dialog.Description>
            {h.how.length > 0 && (
              <section>
                <h3 className="mb-1.5 font-semibold text-ink-100">How to use it</h3>
                <ol className="flex list-decimal flex-col gap-1 pl-5 text-ink-300">
                  {h.how.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              </section>
            )}
            {h.say && h.say.length > 0 && (
              <section>
                <h3 className="mb-1.5 font-semibold text-ink-100">Say or type</h3>
                <ul className="flex flex-wrap gap-1.5">
                  {h.say.map((s) => (
                    <li
                      key={s}
                      className="rounded-pill border border-line px-2.5 py-1 text-xs text-ink-300"
                    >
                      “{s}”
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {h.tips && h.tips.length > 0 && (
              <section>
                <h3 className="mb-1.5 font-semibold text-ink-100">Good to know</h3>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-300">
                  {h.tips.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
