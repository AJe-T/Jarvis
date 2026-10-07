import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import * as RadixSwitch from '@radix-ui/react-switch';
import clsx from 'clsx';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink-100">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-sm text-ink-500">{hint}</p>}
    </div>
  );
}

export function TextInput({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <input
      className={clsx(
        'min-h-9 rounded-md border border-glass-border bg-glass-inset px-3 text-base text-ink-100 placeholder:text-ink-500 focus:border-glass-border-strong',
        className,
      )}
      {...rest}
    />
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="flex min-h-8 items-center justify-between gap-4">
      <label htmlFor={id} className="text-sm text-ink-100">
        {label}
      </label>
      <RadixSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="relative h-6 w-11 shrink-0 rounded-pill border border-glass-border-strong bg-glass-inset transition-colors data-[state=checked]:border-reactor-500 data-[state=checked]:bg-reactor-500"
      >
        <RadixSwitch.Thumb className="block size-[18px] translate-x-0.5 rounded-pill bg-ink-100 transition-transform data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-void-950" />
      </RadixSwitch.Root>
    </div>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="glass-inset my-4 flex flex-col gap-4 rounded-lg p-4 md:p-5">
      <div>
        <h2 className="font-display text-lg font-semibold text-ink-100">{title}</h2>
        {description && <p className="mt-1 max-w-[60ch] text-sm text-ink-300">{description}</p>}
      </div>
      {children}
    </section>
  );
}
