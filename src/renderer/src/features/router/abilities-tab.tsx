import { ArrowRight, Combine, Globe, ImageIcon, Mic } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Panel, PhaseTag, Toggle } from './parts';

const SEARCH = ['Tavily', 'Brave Search', 'Exa', 'Firecrawl', 'Linkup'];
const FUSION_PANEL = ['Gemini 2.5 Flash', 'GPT-OSS 120B', 'DeepSeek V3'];

/** Abilities (Phase 3): what the free pool adds beyond chat. */
export function AbilitiesTab(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Free web search"
          phase={3}
          aside={<Toggle label="Free web search" checked={false} disabled />}
        >
          <Title icon={<Globe size={16} aria-hidden />}>
            Research searches the free search APIs first and uses Claude&apos;s paid web search only
            when they are all used up.
          </Title>
          <ol className="flex flex-wrap items-center gap-1.5 text-sm">
            {SEARCH.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5">
                <span className="rounded-sm bg-surface-2 px-2 py-1 text-ink-100">{s}</span>
                {i < SEARCH.length - 1 && (
                  <ArrowRight size={12} aria-hidden className="text-ink-500" />
                )}
              </li>
            ))}
          </ol>
          <p className="text-xs text-ink-500">
            Each needs its own free key, added on Providers &amp; keys.
          </p>
        </Panel>

        <Panel title="Image generation" phase={3}>
          <Title icon={<ImageIcon size={16} aria-hidden />}>
            “Draw a logo for my bakery” makes an image with a free image model and saves it to your
            vault.
          </Title>
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="Describe the image"
              disabled
              placeholder="A neon owl reading a book, flat style"
              className="min-h-9 min-w-0 flex-1 rounded-sm border border-line bg-surface-1 px-3 text-sm text-ink-100 disabled:opacity-60"
            />
            <select
              aria-label="Size"
              disabled
              className="min-h-9 rounded-sm border border-line bg-surface-1 px-2 text-sm text-ink-100 disabled:opacity-60"
            >
              <option>Square</option>
            </select>
            <Button variant="primary" disabled>
              Generate
            </Button>
          </div>
          <div
            aria-hidden
            className="grid h-28 place-items-center rounded-md border border-dashed border-line text-xs text-ink-500"
          >
            image appears here
          </div>
        </Panel>

        <Panel title="Fusion brain" phase={3}>
          <Title icon={<Combine size={16} aria-hidden />}>
            Three free models answer at once; a fourth, the judge, writes one better answer from the
            drafts. Good for hard questions where one free model is not enough.
          </Title>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <div className="flex flex-col gap-1.5">
              {FUSION_PANEL.map((m) => (
                <span key={m} className="rounded-sm bg-surface-2 px-2 py-1 text-ink-100">
                  {m}
                </span>
              ))}
            </div>
            <ArrowRight size={16} aria-hidden className="text-ink-500" />
            <span className="rounded-sm border border-accent-edge bg-accent-tint px-3 py-2 text-accent-tag-ink">
              Judge → one answer
            </span>
          </div>
          <p className="text-xs text-ink-500">
            Shows up as the “fusion” brain for sub-tasks and in Compare AIs.
          </p>
        </Panel>

        <Panel title="Voice backup chain" phase={3}>
          <Title icon={<Mic size={16} aria-hidden />}>
            If a speech engine fails or hits its limit, the next one takes over instead of Jarvis
            going quiet.
          </Title>
          <Chain label="Hearing" items={['Whisper on this PC', 'Groq Whisper', 'OpenAI']} />
          <Chain label="Speaking" items={['Kokoro on this PC', 'Edge voices', 'ElevenLabs']} />
        </Panel>
      </div>
      <p className="flex items-center gap-2 text-xs text-ink-500">
        <PhaseTag phase={3} /> Drawn now; these start working in Phase 3.
      </p>
    </div>
  );
}

function Title({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <p className="flex items-start gap-2 text-sm text-ink-300">
      <span className="mt-0.5 text-accent-500">{icon}</span>
      <span>{children}</span>
    </p>
  );
}

function Chain({ label, items }: { label: string; items: string[] }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="hud-label w-20 text-ink-500">{label}</span>
      {items.map((it, i) => (
        <span key={it} className="flex items-center gap-1.5">
          <span className="rounded-sm bg-surface-2 px-2 py-1 text-ink-100">{it}</span>
          {i < items.length - 1 && <ArrowRight size={12} aria-hidden className="text-ink-500" />}
        </span>
      ))}
    </div>
  );
}
