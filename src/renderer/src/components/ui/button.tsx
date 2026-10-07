import { forwardRef, type ButtonHTMLAttributes } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import clsx from 'clsx';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-reactor-500 text-ink-on-reactor hover:bg-reactor-300 font-semibold',
  secondary: 'bg-glass-inset text-ink-100 border border-glass-border hover:bg-glass-hover',
  danger: 'bg-alarm-500 text-ink-on-alarm hover:brightness-110 font-semibold',
  ghost: 'text-ink-300 hover:text-ink-100 hover:bg-glass-hover',
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
        'inline-flex min-h-8 items-center justify-center gap-2 rounded-md px-3 text-sm transition-colors duration-[120ms] disabled:cursor-not-allowed disabled:opacity-50',
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
            active
              ? 'bg-glass-selected text-reactor-500'
              : 'text-ink-300 hover:bg-glass-hover hover:text-ink-100',
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
          className="z-50 rounded-sm border border-glass-border-strong bg-solid-float px-2 py-1 text-xs text-ink-100"
        >
          {label}
          {hint && <span className="ml-2 text-ink-500">{hint}</span>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
