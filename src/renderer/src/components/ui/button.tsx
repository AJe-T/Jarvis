import { forwardRef, type ButtonHTMLAttributes } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import clsx from 'clsx';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  // §6.6: neon fill is the main action, a framed panel is secondary, red is deliberate.
  primary: 'btn-accent',
  secondary:
    'border border-line-strong bg-surface-1 text-ink-100 shadow-sm hover:border-accent-edge hover:bg-surface-2 active:bg-press',
  danger: 'bg-alarm-fill text-ink-on-alarm hover:brightness-95',
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
        'btn inline-flex h-9 items-center justify-center gap-2 rounded-sm px-4 font-code text-sm font-medium tracking-wide whitespace-nowrap transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-50',
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
  /** Where the tooltip opens (header buttons: below, so it isn't under the window buttons). */
  tipSide?: 'top' | 'right' | 'bottom' | 'left';
}

/** Icon-only buttons always carry an aria-label and a tooltip (Code-style.md §6). */
export function IconButton({
  label,
  hint,
  active,
  tipSide = 'right',
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
            'inline-flex size-8 items-center justify-center rounded-sm transition-colors duration-[120ms] disabled:opacity-40',
            // §6.2: active = soft grey highlight on the selected sidebar row.
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
          side={tipSide}
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
