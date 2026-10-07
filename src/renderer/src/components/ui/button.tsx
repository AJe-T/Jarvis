import { forwardRef, type ButtonHTMLAttributes } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import clsx from 'clsx';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const VARIANTS: Record<Variant, string> = {
  // §6.6: violet acts, glass is secondary, red is deliberate (flat, no glow).
  primary: 'btn-accent font-semibold',
  secondary:
    'bg-glass-inset text-ink-100 border border-glass-border hover:bg-glass-hover active:bg-glass-press',
  danger: 'bg-alarm-fill text-ink-on-alarm font-semibold hover:brightness-105',
  ghost: 'text-ink-300 hover:text-ink-100 hover:bg-glass-hover active:bg-glass-press',
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
        'inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3.5 text-ui font-medium transition-[background-color,color,scale] duration-[160ms] motion-safe:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
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
            'inline-flex size-9 items-center justify-center rounded-md border transition-[background-color,color,border-color,scale] duration-[180ms] disabled:opacity-40 motion-safe:enabled:hover:scale-[1.04] motion-safe:enabled:active:scale-[0.96]',
            // §6.2: active = cyan tint, cyan edge, a faint glow on the icon only.
            active
              ? 'border-reactor-edge bg-reactor-tint text-reactor-300 [&_svg]:drop-shadow-[0_0_6px_var(--reactor-glow)]'
              : 'border-transparent text-icon-rest hover:bg-glass-hover hover:text-ink-100',
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
          className="fade-in z-50 rounded-sm border border-glass-border-strong bg-solid-float px-2 py-1 text-xs text-ink-100 shadow-float"
        >
          {label}
          {hint && <span className="ml-2 text-ink-500">{hint}</span>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
