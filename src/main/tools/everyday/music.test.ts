import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { logger } from '../../logging/logger';
import { createPathGuard } from '../../security/path-guard';
import { createFakeOs } from '../native/os';
import type { Tool, ToolOutput } from '../types';
import { createMusicTools, matchTracks, shuffled } from './music';

const ctx = {
  signal: new AbortController().signal,
  conversationId: 'c',
  turnId: 't',
  tainted: false,
  logger,
};
const text = (o: ToolOutput): string => o.content.map((c) => ('text' in c ? c.text : '')).join(' ');

function library(): string {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-music-'));
  mkdirSync(join(root, 'Coldplay', 'Parachutes'), { recursive: true });
  writeFileSync(join(root, 'Coldplay', 'Parachutes', 'Yellow.mp3'), '');
  writeFileSync(join(root, 'Coldplay', 'Parachutes', 'Trouble.flac'), '');
  writeFileSync(join(root, 'AR Rahman - Jai Ho.m4a'), '');
  writeFileSync(join(root, 'cover.jpg'), '');
  return root;
}

describe('play_music (idea from kishanrajput23/Jarvis-Desktop-Voice-Assistant)', () => {
  it('matches every word of the query against the path', () => {
    const tracks = ['Coldplay\\Parachutes\\Yellow.mp3', 'AR Rahman - Jai Ho.m4a'];
    expect(matchTracks(tracks, 'coldplay yellow')).toEqual(['Coldplay\\Parachutes\\Yellow.mp3']);
    expect(matchTracks(tracks, '')).toEqual(tracks);
    expect(matchTracks(tracks, 'beatles')).toEqual([]);
  });

  it('shuffles without losing tracks', () => {
    expect(shuffled([1, 2, 3, 4], () => 0).sort()).toEqual([1, 2, 3, 4]);
  });

  it('writes a playlist of the matching songs and opens it', async () => {
    const root = library();
    const os = createFakeOs();
    const [tool] = createMusicTools({
      os,
      guard: createPathGuard({ allowedRoots: () => [root], deniedPaths: () => [] }),
      musicDir: () => root,
      playlistDir: root,
    }) as [Tool];
    const out = await tool.run(tool.input.parse({ query: 'coldplay', shuffle: false }), ctx);
    expect(text(out)).toMatch(/Playing 2 songs matching "coldplay"/);
    const playlist = readFileSync(join(root, 'jarvis-playlist.m3u8'), 'utf8');
    expect(playlist).toContain('Yellow.mp3');
    expect(playlist).not.toContain('Jai Ho');
    expect(playlist).not.toContain('cover.jpg');
    expect(os.calls.some((c) => c.op === 'openPath')).toBe(true);
  });

  it('says so when nothing matches', async () => {
    const root = library();
    const [tool] = createMusicTools({
      os: createFakeOs(),
      guard: createPathGuard({ allowedRoots: () => [root], deniedPaths: () => [] }),
      musicDir: () => root,
      playlistDir: root,
    }) as [Tool];
    const out = await tool.run(tool.input.parse({ query: 'beatles' }), ctx);
    expect(out.isError).toBe(true);
  });
});
