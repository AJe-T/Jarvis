import type { McpServerInput } from './ipc-contract';

export interface McpPreset {
  id: string;
  label: string;
  description: string;
  /** Secret Sir must provide before the preset can connect. */
  needsSecret?: { name: string; label: string; help: string };
  server: McpServerInput;
}

// Security.md §10: vetted vendor servers, pinned versions, read-only tools marked SAFE explicitly,
// everything else CONFIRM. `{browserProfile}` and `{allowedRoots}` are expanded by main at spawn time.
export const MCP_PRESETS: McpPreset[] = [
  {
    id: 'playwright',
    label: 'Browser (Playwright)',
    description:
      'Lets Jarvis read and operate web pages in a dedicated Microsoft Edge profile (not your everyday browser).',
    server: {
      name: 'playwright',
      transport: 'stdio',
      command: 'npx',
      args: [
        '-y',
        '@playwright/mcp@0.0.83',
        '--browser',
        'msedge',
        '--user-data-dir',
        '{browserProfile}',
      ],
      envSecrets: {},
      trustLevel: 'official',
      defaultTier: 'CONFIRM',
      // Running arbitrary JavaScript inside logged-in pages is too powerful to allow by default.
      toolOverrides: {
        browser_snapshot: 'SAFE',
        browser_navigate: 'SAFE',
        browser_take_screenshot: 'SAFE',
        browser_tabs: 'SAFE',
        browser_wait_for: 'SAFE',
        browser_run_code_unsafe: 'BLOCKED',
      },
      enabled: true,
    },
  },
  {
    id: 'github',
    label: 'GitHub',
    description:
      "GitHub's official remote MCP server. Use a fine-grained, read-only token first (expiry ≤ 90 days).",
    needsSecret: {
      name: 'github_pat',
      label: 'GitHub fine-grained token',
      help: 'github.com → Settings → Developer settings → Fine-grained tokens',
    },
    server: {
      name: 'github',
      transport: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      args: [],
      envSecrets: {},
      authSecret: 'github_pat',
      trustLevel: 'official',
      defaultTier: 'CONFIRM',
      toolOverrides: {},
      enabled: true,
    },
  },
  {
    id: 'notion',
    label: 'Notion',
    description:
      "Notion's official MCP server with an internal integration token. Share the pages Jarvis may use with the integration.",
    needsSecret: {
      name: 'notion_token',
      label: 'Notion integration token',
      help: 'notion.so/profile/integrations → New integration',
    },
    server: {
      name: 'notion',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server@2.5.2'],
      envSecrets: { NOTION_TOKEN: 'notion_token' },
      trustLevel: 'official',
      defaultTier: 'CONFIRM',
      toolOverrides: {},
      enabled: true,
    },
  },
  {
    id: 'filesystem',
    label: 'Filesystem (scoped)',
    description:
      'The reference filesystem server, limited to the folders allowed in Settings → Files & permissions.',
    server: {
      name: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem@2026.8.31', '{allowedRoots}'],
      envSecrets: {},
      trustLevel: 'official',
      defaultTier: 'CONFIRM',
      toolOverrides: {
        read_text_file: 'SAFE',
        list_directory: 'SAFE',
        search_files: 'SAFE',
        get_file_info: 'SAFE',
        list_allowed_directories: 'SAFE',
      },
      enabled: true,
    },
  },
];
