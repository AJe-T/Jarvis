// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Markdown } from './chat-message';
import { artifactKind, artifactTitle, wrapDrawing } from './artifact';

describe('chat artifacts (idea from LibreChat)', () => {
  it('recognises only the artifact fence tags', () => {
    expect(artifactKind('language-artifact-html')).toBe('html');
    expect(artifactKind('language-artifact-mermaid')).toBe('mermaid');
    expect(artifactKind('language-html')).toBeNull();
    expect(artifactKind(undefined)).toBeNull();
  });

  it('titles pages from <title> or a title comment', () => {
    expect(artifactTitle('html', '<html><head><title>Tip calculator</title>')).toBe(
      'Tip calculator',
    );
    expect(artifactTitle('mermaid', '%% title: Release flow\ngraph TD; A-->B')).toBe(
      'Release flow',
    );
    expect(artifactTitle('svg', '<svg/>')).toBe('Drawing');
  });

  it('wraps drawings in a minimal page', () => {
    expect(wrapDrawing('<svg id="x"/>', true)).toMatch(/^<!doctype html>.*<svg id="x"\/>/);
  });

  it('shows an artifact block as a sandboxed frame, other code as code', async () => {
    render(
      <Tooltip.Provider>
        <Markdown
          text={
            'Here it is:\n\n```artifact-html\n<title>Clock</title><p>hi</p>\n```\n\n```js\nlet a = 1;\n```'
          }
        />
      </Tooltip.Provider>,
    );
    const frame = await screen.findByTitle('Clock');
    expect(frame.tagName).toBe('IFRAME');
    // Scripts only: no same-origin, forms, popups or top navigation.
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('src')).toBe('./artifact.html');
    expect(screen.getByText('let a = 1;')).toBeTruthy();
  });
});
