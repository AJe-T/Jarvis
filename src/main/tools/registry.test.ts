import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createToolRegistry } from './registry';
import type { Tool } from './types';

const tool = (name: string): Tool =>
  ({ name, description: name, input: z.object({}) }) as unknown as Tool;

describe('tool catalog', () => {
  it("marks connected MCP servers' tools as deferred and Jarvis's own as loaded", () => {
    const registry = createToolRegistry({ webSearchEnabled: () => false });
    registry.register(tool('open_app'));
    registry.addProvider(() => [tool('browser_navigate')]);
    expect(registry.catalog().map((t) => [t.name, t.deferred ?? false])).toEqual([
      ['open_app', false],
      ['browser_navigate', true],
    ]);
  });
});
