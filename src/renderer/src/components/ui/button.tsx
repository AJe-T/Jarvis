import { forwardRef, type ButtonHTMLAttributes } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import clsx from 'clsx';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  // §6.6: blue acts, neutral is secondary, red is deliberate.
  primary: 'btn-accent font-semibold',
  secondary: 'border border-line bg-surface-1 text-ink-100 hover:bg-hover active:bg-press',
  danger: 'bg-alarm-fill text-ink-on-alarm font-semibold hover:brightness-110',
  ghost: 'text-ink-300 hover:bg-hover hover:text-ink-100 active:bg-press',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(
        'inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-ui font-medium whitespace-nowrap transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  hint?: string;
  active?: boolean;
}

/** Icon-only buttons always carry an aria-label and a tooltip (Code-style.md §6). */
export function IconButton({
  label,
  hint,
  active,
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <Tooltip.Root delayDuration={300}>
      <Tooltip.Trigger asChild>
        <button
          type={type}
          aria-label={label}
          aria-pressed={active}
          className={clsx(
            'inline-flex size-9 items-center justify-center rounded-md transition-colors duration-[120ms] disabled:opacity-40',
            // §6.2: active = neutral highlight + full-strength icon; no glow.
            active
              ? 'bg-selected text-ink-100'
              : 'text-icon-rest hover:bg-hover hover:text-ink-100 active:bg-press',
            className,
          )}
          {...rest}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={6}
          className="fade-in z-50 rounded-sm border border-line-strong bg-surface-1 px-2 py-1 text-xs text-ink-100 shadow-pop"
        >
          {label}
          {hint && <span className="ml-2 text-ink-500">{hint}</span>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
