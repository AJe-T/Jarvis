import { describe, expect, it } from 'vitest';
import { lastArtifact } from './reply-outputs';

describe('reply outputs on the stage', () => {
  it('finds the last artifact block of a reply', () => {
    const text =
      'Here:\n```artifact-svg\n<svg/>\n```\nand\n```artifact-mermaid\n%% title: Flow\ngraph TD; A-->B\n```';
    expect(lastArtifact(text)).toEqual({
      format: 'mermaid',
      code: '%% title: Flow\ngraph TD; A-->B',
      title: 'Flow',
    });
  });

  it('ignores ordinary code blocks', () => {
    expect(lastArtifact('```ts\nconst a = 1;\n```')).toBeNull();
  });
});
