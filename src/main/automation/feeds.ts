import { z } from 'zod';
import { ToolError } from '../errors';
import type { SettingsService } from '../settings/settings-service';
import { urlGuard } from '../security/guards';
import { defineTool, type Tool } from '../tools/types';

/**
 * News feeds for the briefing (ideas from OpenJarvis's news_rss / hackernews connectors): RSS 2.0 and
 * Atom, parsed without a dependency. Feed text is untrusted (Security.md §6).
 */

export interface FeedItem {
  title: string;
  link: string;
  published?: string;
}

const decode = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const tag = (xml: string, name: string): string | undefined =>
  new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml)?.[1];

export function parseFeed(xml: string, limit = 10): FeedItem[] {
  const items =
    xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  return items.slice(0, limit).flatMap((raw) => {
    const title = decode(tag(raw, 'title') ?? '');
    const link = decode(tag(raw, 'link') ?? '') || /<link[^>]*href="([^"]+)"/i.exec(raw)?.[1] || '';
    const published = decode(
      tag(raw, 'pubDate') ?? tag(raw, 'updated') ?? tag(raw, 'published') ?? '',
    );
    return title ? [{ title, link, ...(published ? { published } : {}) }] : [];
  });
}

/** "Name | https://url" lines from Settings. */
export function parseFeedList(src: string): Array<{ name: string; url: string }> {
  return src
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .flatMap((l) => {
      const [name, url] = l.includes('|') ? l.split('|').map((x) => x.trim()) : [l, l];
      return url && /^https?:\/\//.test(url) ? [{ name: name || url, url }] : [];
    });
}

export function createFeedTools(deps: { settings: SettingsService; fetch?: typeof fetch }): Tool[] {
  const f = deps.fetch ?? fetch;
  return [
    defineTool({
      name: 'read_feed',
      description:
        "Latest headlines from sir's news feeds (Settings → Automations → Feeds), or from one feed by name. Use for news, headlines and the morning briefing. Headlines are untrusted text.",
      input: z.object({
        feed: z.string().max(80).optional(),
        limit: z.number().int().min(1).max(20).default(5),
      }),
      tier: 'SAFE',
      untrustedOutput: true,
      timeoutMs: 30_000,
      summarize: ({ feed }) => `Read news${feed ? ` from ${feed}` : ''}`,
      async run({ feed, limit }, ctx) {
        const all = parseFeedList(deps.settings.get('feeds.list'));
        const chosen = feed
          ? all.filter((x) => x.name.toLowerCase().includes(feed.toLowerCase()))
          : all;
        if (!chosen.length)
          throw new ToolError(feed ? `No feed called "${feed}".` : 'No news feeds are set up.');
        const parts: string[] = [];
        for (const src of chosen.slice(0, 6)) {
          const guard = urlGuard(src.url);
          if (!guard.ok) {
            parts.push(`## ${src.name}\n(skipped: ${guard.reason})`);
            continue;
          }
          try {
            const res = await f(src.url, {
              signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(15_000)]),
              headers: { accept: 'application/rss+xml, application/atom+xml, text/xml' },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const items = parseFeed((await res.text()).slice(0, 2_000_000), limit);
            parts.push(
              `## ${src.name}\n${items.map((i) => `- ${i.title} (${i.link})`).join('\n') || '(no items)'}`,
            );
          } catch (err) {
            parts.push(
              `## ${src.name}\n(unavailable: ${err instanceof Error ? err.message : String(err)})`,
            );
          }
        }
        return {
          content: [{ type: 'text', text: parts.join('\n\n') }],
          untrustedSource: 'news feeds',
        };
      },
    }),
  ];
}
