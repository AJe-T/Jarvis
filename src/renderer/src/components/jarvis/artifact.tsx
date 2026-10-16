import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Code2, Download, Eye, Maximize2, PanelRightOpen, X } from 'lucide-react';
import { call, cleanError } from '../../lib/api';
import { useStageStore } from '../../stores/stage-store';
import { useUiStore } from '../../stores/ui-store';
import { IconButton } from '../ui/button';
import type { Mermaid } from 'mermaid';

/**
 * Artifacts (idea from LibreChat): when Jarvis answers with a fenced block tagged artifact-html,
 * artifact-svg or artifact-mermaid, the chat shows it live. Pages run in renderer/artifact.html: a
 * sandboxed frame (opaque origin, scripts only) whose policy blocks every network request, so a
 * page can't load or send anything. Mermaid diagrams are drawn here (strict mode) and shown the same way.
 */

export const ARTIFACT_KINDS = ['html', 'svg', 'mermaid'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

const MAX_TITLE = 60;

/** `language-artifact-html` (from ```artifact-html) → 'html'. */
export function artifactKind(className: string | undefined): ArtifactKind | null {
  const m = /\blanguage-artifact-(html|svg|mermaid)\b/.exec(className ?? '');
  return m ? (m[1] as ArtifactKind) : null;
}

export function artifactTitle(kind: ArtifactKind, code: string): string {
  const fromHtml = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(code)?.[1];
  const fromComment = /^\s*(?:%%|<!--)\s*title:\s*([^\n>]{1,200}?)\s*(?:-->)?\s*$/im.exec(
    code,
  )?.[1];
  const t = (fromHtml ?? fromComment ?? '').replace(/\s+/g, ' ').trim();
  if (t) return t.slice(0, MAX_TITLE);
  return kind === 'mermaid' ? 'Diagram' : kind === 'svg' ? 'Drawing' : 'Page';
}

/** A bare drawing gets a minimal page around it, centred, on the app's background. */
export function wrapDrawing(svg: string, dark: boolean): string {
  const bg = dark ? '#0b0f14' : '#ffffff';
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:${bg}}body{display:grid;place-items:center;padding:12px;box-sizing:border-box}svg{max-width:100%;max-height:100%;height:auto}</style></head><body>${svg}</body></html>`;
}

const isDark = (): boolean => document.documentElement.dataset['theme'] !== 'light';

let mermaidReady: Promise<Mermaid> | null = null;
async function renderMermaid(code: string, dark: boolean): Promise<string> {
  mermaidReady ??= import('mermaid').then((m) => m.default);
  const mermaid = await mermaidReady;
  // strict: no scripts or clicks in diagrams; labels are sanitised.
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    // A syntax error is shown in the card, not left behind in the app's own page.
    suppressErrorRendering: true,
    theme: dark ? 'dark' : 'default',
  });
  const id = `mmd-${Math.random().toString(36).slice(2, 10)}`;
  const { svg } = await mermaid.render(id, code);
  return svg;
}

/**
 * Resource hints reach the network past connect-src (DNS prefetch, preconnect): they are taken out
 * of a page before it is shown.
 */
export function stripHints(html: string): string {
  return html.replace(
    /<link\b[^>]*\brel\s*=\s*["']?[^"'>]*\b(?:dns-prefetch|preconnect|prefetch|prerender|preload|modulepreload)\b[^>]*>/gi,
    '',
  );
}

/** The policy the preview runs under, written into a saved page too, so opening it elsewhere is as safe. */
const SAVED_POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:">`;

export function withSavedPolicy(html: string): string {
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  return doctype
    ? `${doctype[0]}${SAVED_POLICY}${html.slice(doctype[0].length)}`
    : `${SAVED_POLICY}${html}`;
}

/** The page to show, and the file to save, for an artifact. */
async function build(kind: ArtifactKind, code: string): Promise<{ page: string; file: string }> {
  const dark = isDark();
  if (kind === 'html') return { page: stripHints(code), file: withSavedPolicy(stripHints(code)) };
  if (kind === 'svg') return { page: wrapDrawing(code, dark), file: code };
  const svg = await renderMermaid(code, dark);
  return { page: wrapDrawing(svg, dark), file: svg };
}

function ArtifactFrame({
  page,
  title,
  className,
}: {
  page: string;
  title: string;
  className: string;
}): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      const win = frame.current?.contentWindow;
      if (!win || e.source !== win || !(e.data as { artifactReady?: boolean })?.artifactReady)
        return;
      // The frame's origin is opaque, so '*' is the only target that reaches it; it is our own frame.
      win.postMessage({ html: page }, '*');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [page]);
  return (
    // A new page gets a new frame: the frame accepts exactly one page.
    <iframe
      key={page}
      ref={frame}
      title={title}
      src="./artifact.html"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className={clsx('block w-full border-0 bg-white', className)}
    />
  );
}

/** Builds an artifact's page (and file) whenever its code changes. */
function useBuilt(
  kind: ArtifactKind,
  code: string,
): { built: { page: string; file: string } | null; error: string | null } {
  const [built, setBuilt] = useState<{ page: string; file: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    build(kind, code)
      .then((b) => live && setBuilt(b))
      .catch((err: unknown) => live && setError(cleanError(err)));
    return () => {
      live = false;
    };
  }, [kind, code]);
  return { built, error };
}

function saveArtifact(kind: ArtifactKind, title: string, file: string): void {
  const toast = useUiStore.getState().toast;
  call('artifacts:save', { title, ext: kind === 'html' ? 'html' : 'svg', content: file })
    .then((r) => r.path && toast({ level: 'info', message: `Saved to ${r.path}` }))
    .catch((err: unknown) => toast({ level: 'error', message: cleanError(err) }));
}

/** An artifact on Core's stage beside the orb (stage panel 'artifact'). */
export function ArtifactPanel({
  format,
  code,
  title,
}: {
  format: ArtifactKind;
  code: string;
  title: string;
}): React.JSX.Element {
  const { built, error } = useBuilt(format, code);
  if (error)
    return (
      <p className="text-sm text-alarm-500">
        This {format} could not be drawn: {error}
      </p>
    );
  if (!built) return <p className="text-sm text-ink-500">Drawing…</p>;
  return (
    <div className="flex h-full min-h-80 flex-col gap-2">
      <ArtifactFrame page={built.page} title={title} className="min-h-0 flex-1 rounded-md" />
      <button
        type="button"
        className="flex items-center gap-1.5 self-end text-sm text-accent-300 hover:underline"
        onClick={() => saveArtifact(format, title, built.file)}
      >
        <Download size={14} aria-hidden /> Save as a file
      </button>
    </div>
  );
}

export function ArtifactCard({
  kind,
  code,
}: {
  kind: ArtifactKind;
  code: string;
}): React.JSX.Element {
  const title = artifactTitle(kind, code);
  const [view, setView] = useState<'preview' | 'code'>('preview');
  const { built, error } = useBuilt(kind, code);
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  const save = (): void => {
    if (built) saveArtifact(kind, title, built.file);
  };

  return (
    <figure
      className="my-3 overflow-hidden rounded-md border border-line bg-surface-1"
      aria-label={`Artifact: ${title}`}
    >
      <figcaption className="flex items-center gap-1 border-b border-line-subtle px-3 py-1.5">
        <span className="truncate text-sm text-ink-100">{title}</span>
        <span className="font-code text-3xs text-ink-500 uppercase">{kind}</span>
        <div className="ml-auto flex gap-0.5">
          <IconButton
            label={view === 'preview' ? 'Show the code' : 'Show the preview'}
            onClick={() => setView(view === 'preview' ? 'code' : 'preview')}
          >
            {view === 'preview' ? <Code2 size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
          </IconButton>
          <IconButton
            label="Show beside the orb"
            onClick={() =>
              useStageStore.getState().show({ kind: 'artifact', title, format: kind, code })
            }
          >
            <PanelRightOpen size={14} aria-hidden />
          </IconButton>
          <IconButton label="Full screen" disabled={!built} onClick={() => setFull(true)}>
            <Maximize2 size={14} aria-hidden />
          </IconButton>
          <IconButton label="Save as a file" disabled={!built} onClick={save}>
            <Download size={14} aria-hidden />
          </IconButton>
        </div>
      </figcaption>
      {view === 'code' ? (
        <pre className="max-h-96 overflow-auto p-3 text-xs">
          <code>{code}</code>
        </pre>
      ) : (
        // Same height before and after drawing, so the chat doesn't jump (and stays scrolled down).
        <div className="h-96 min-h-40 resize-y overflow-hidden">
          {error ? (
            <p className="p-3 text-sm text-alarm-500">
              This {kind} could not be drawn: {error}
            </p>
          ) : built ? (
            <ArtifactFrame page={built.page} title={title} className="h-full" />
          ) : (
            <p className="p-3 text-sm text-ink-500">Drawing…</p>
          )}
        </div>
      )}
      {full && built && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-50 flex flex-col bg-app/95 p-4 backdrop-blur-sm"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="truncate text-ui text-ink-100">{title}</span>
            <IconButton
              label="Close full screen"
              className="ml-auto"
              onClick={() => setFull(false)}
            >
              <X size={16} aria-hidden />
            </IconButton>
          </div>
          <ArtifactFrame page={built.page} title={title} className="min-h-0 flex-1 rounded-md" />
        </div>
      )}
    </figure>
  );
}
