// Dev helper: connect to the pinned Playwright MCP preset and list its tools (no browser launch).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const profile = mkdtempSync(join(tmpdir(), 'jarvis-pw-'));
const t = new StdioClientTransport({ command: 'npx', args: ['-y', '@playwright/mcp@0.0.83', '--browser', 'msedge', '--user-data-dir', profile] });
const c = new Client({ name: 'smoke', version: '0' });
await c.connect(t, { timeout: 120000 });
const { tools } = await c.listTools();
console.log(tools.length, 'tools:', tools.map((x) => x.name).join(', '));
await c.close();
