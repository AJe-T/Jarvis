import { opendir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { PathGuard } from '../../security/path-guard';
import type { OsAdapter } from '../native/os';
import { defineTool, fail, ok, type Tool } from '../types';

const AUDIO = /\.(mp3|m4a|aac|flac|wav|ogg|opus|wma)$/i;
/** Enough for a big library; stops a runaway scan of a huge folder. */
const MAX_FILES = 20_000;
const MAX_TRACKS = 200;

/** Audio files under `root`, relative paths, scan capped at MAX_FILES entries. */
export async function listTracks(root: string): Promise<string[]> {
  const tracks: string[] = [];
  const dirs = [''];
  let seen = 0;
  for (let rel = dirs.pop(); rel !== undefined && seen < MAX_FILES; rel = dirs.pop()) {
    for await (const e of await opendir(path.join(root, rel))) {
      if (++seen > MAX_FILES) break;
      const child = path.join(rel, e.name);
      if (e.isDirectory()) dirs.push(child);
      else if (AUDIO.test(e.name)) tracks.push(child);
    }
  }
  return tracks.sort();
}

/** Tracks whose path contains every word of the query ("coldplay yellow"), in library order. */
export function matchTracks(tracks: string[], query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return tracks.filter((t) => {
    const hay = t.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function shuffled<T>(xs: T[], random: () => number = Math.random): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * Play music from Sir's own library (kishanrajput23/Jarvis-Desktop-Voice-Assistant "play music"):
 * matching tracks in the Music folder go into a playlist that opens in his default player.
 * media_control then pauses or skips. SAFE: it only opens his own audio files.
 */
export function createMusicTools(deps: {
  os: OsAdapter;
  guard: PathGuard;
  musicDir: () => string;
  playlistDir?: string;
  random?: () => number;
}): Tool[] {
  return [
    defineTool({
      name: 'play_music',
      description:
        "Play songs from sir's Music folder on this PC in his default music player. query matches artist, album, folder or song name (empty = whole library); shuffle mixes the order. For Spotify or YouTube use open_url; to pause or skip use media_control.",
      input: z.object({
        query: z.string().max(100).default(''),
        shuffle: z.boolean().default(true),
      }),
      tier: 'SAFE',
      timeoutMs: 30_000,
      summarize: ({ query }) => (query ? `Play "${query}" from your music` : 'Play your music'),
      guards: () => ({ paths: [deps.musicDir()] }),
      async run({ query, shuffle }) {
        const root = deps.guard.resolve(deps.musicDir());
        const tracks = await listTracks(root).catch(() => null);
        if (!tracks) return fail(`I couldn't read the Music folder (${root}).`);
        if (tracks.length === 0) return fail(`There are no songs in ${root}.`);
        const hits = matchTracks(tracks, query);
        if (hits.length === 0) return fail(`Nothing in your music matches "${query}".`);
        const list = (shuffle ? shuffled(hits, deps.random) : hits).slice(0, MAX_TRACKS);
        const playlist = path.join(deps.playlistDir ?? tmpdir(), 'jarvis-playlist.m3u8');
        await writeFile(
          playlist,
          `#EXTM3U\n${list.map((t) => path.join(root, t)).join('\n')}\n`,
          'utf8',
        );
        await deps.os.openPath(playlist);
        const first = path.basename(list[0] as string).replace(AUDIO, '');
        return ok(
          `Playing ${list.length} song${list.length === 1 ? '' : 's'}${query ? ` matching "${query}"` : ''}, starting with ${first}.`,
        );
      },
    }),
  ];
}
