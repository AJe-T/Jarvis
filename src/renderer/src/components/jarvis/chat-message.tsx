import { memo, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import type { UiMessage, UiToolCall } from '@shared/types';
import { call } from '../../lib/api';
import { ToolCallCard } from './tool-call-card';

function safeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const u = new URL(href);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function nodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (node && typeof node === 'object' && 'props' in node)
    return nodeText((node.props as { children?: React.ReactNode }).children);
  return '';
}

function CodeBlock({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const text = nodeText(children);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Copy code"
        className="absolute top-2 right-2 rounded-sm p-1 text-ink-500 hover:text-ink-100"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

// Security.md §7: no raw HTML; links only http(s) and opened through main.
const MD_COMPONENTS: Components = {
  a: ({ href, children }) => {
    const safe = safeHref(href);
    return safe ? (
      <a
        href={safe}
        onClick={(e) => {
          e.preventDefault();
          void call('app:openExternal', { url: safe });
        }}
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  img: ({ alt }) => <span>[image: {alt}]</span>,
};

export const Markdown = memo(function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
});

/** Design-system.md §5.3. */
export function ChatMessage({ message }: { message: UiMessage }): React.JSX.Element {
  if (message.role === 'notice')
    return <p className="py-2 text-center text-sm text-ink-500">{message.text}</p>;
  if (message.role === 'user')
    return (
      <div className="flex justify-end">
        <div className="glass-inset max-w-[88%] rounded-lg rounded-br-[6px] px-4 py-2 whitespace-pre-wrap text-ink-100 md:max-w-[80%]">
          {message.text}
        </div>
      </div>
    );
  return (
    <article className="text-ink-100" aria-label="Jarvis">
      {message.toolCalls && message.toolCalls.length > 0 && <ToolCards calls={message.toolCalls} />}
      {message.text && <Markdown text={message.text} />}
      {message.interrupted && <span className="text-sm text-ink-500"> (interrupted)</span>}
      {message.citations && message.citations.length > 0 && (
        <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-ink-300">
          {message.citations.map((c, i) => (
            <li key={c.url}>
              <a
                href={c.url}
                className="text-reactor-500 underline underline-offset-2"
                onClick={(e) => {
                  e.preventDefault();
                  void call('app:openExternal', { url: c.url });
                }}
              >
                [{i + 1}] {c.title}
              </a>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

export function ToolCards({ calls }: { calls: UiToolCall[] }): React.JSX.Element {
  return (
    <div className="mb-3 flex flex-col gap-1.5">
      {calls.map((c) => (
        <ToolCallCard key={c.id} call={c} />
      ))}
    </div>
  );
}
