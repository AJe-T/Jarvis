import type { ReactNode } from 'react';
import clsx from 'clsx';

/** Design-system.md §5.3: every view starts with the same 48px header row. */
export function PageHeader({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line-subtle px-4 md:px-6">
      <h1 className="truncate text-ui font-semibold text-ink-100">{title}</h1>
      {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
    </header>
  );
}

/** §5.3: one scrolling body with one centred column, so every view lines up the same way. */
export function PageBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 md:px-6">
      <div className={clsx('mx-auto w-full max-w-3xl py-6', className)}>{children}</div>
    </div>
  );
}
