import type { McpServerInput } from './ipc-contract';

/** A key Sir must save (Settings → secrets) before a connection can start. */
export interface SecretNeed {
  name: string;
  label: string;
  help: string;
}

export const PRESET_CATEGORIES = [
  { id: 'hubs', label: 'App hubs' },
  { id: 'browser', label: 'Browser & files' },
  { id: 'desktop', label: 'Desktop control' },
  { id: 'search', label: 'Web search' },
  { id: 'knowledge', label: 'Docs & knowledge' },
  { id: 'dev', label: 'Developer' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'home', label: 'Home & media' },
] as const;
export type PresetCategory = (typeof PRESET_CATEGORIES)[number]['id'];

export interface McpPreset {
  id: string;
  label: string;
  description: string;
  category: PresetCategory;
  /** Secrets Sir must provide before the preset can connect. */
  secrets?: SecretNeed[];
  server: McpServerInput;
}

const stdio = (
  name: string,
  args: string[],
  extra: Partial<McpServerInput> = {},
): McpServerInput => ({
  name,
  transport: 'stdio',
  command: 'npx',
  args: ['-y', ...args],
  envSecrets: {},
  trustLevel: 'official',
  defaultTier: 'CONFIRM',
  toolOverrides: {},
  enabled: true,
  ...extra,
});

const http = (name: string, url: string, extra: Partial<McpServerInput> = {}): McpServerInput => ({
  name,
  transport: 'http',
  url,
  args: [],
  envSecrets: {},
  trustLevel: 'official',
  defaultTier: 'CONFIRM',
  toolOverrides: {},
  enabled: true,
  ...extra,
});

// Security.md §10: vetted vendor servers, pinned versions, read-only tools marked SAFE explicitly,
// everything else CONFIRM. `{browserProfile}` and `{allowedRoots}` are expanded by main at spawn time.
// Each entry was checked against the vendor's docs (package name, version, env var / Bearer auth).
export const MCP_PRESETS: McpPreset[] = [
  // ── App hubs: one connection, thousands of apps ──
  {
    id: 'zapier',
    label: 'Zapier (9,000+ apps)',
    description:
      'One connection to Gmail, Sheets, Slack, Calendar, Trello and thousands more. Pick which actions Jarvis gets at mcp.zapier.com.',
    category: 'hubs',
    secrets: [
      {
        name: 'zapier_token',
        label: 'Zapier MCP connection token',
        help: 'mcp.zapier.com → your server → Connect → Other clients → generate a token',
      },
    ],
    server: http('zapier', 'https://mcp.zapier.com/api/v1/connect', { authSecret: 'zapier_token' }),
  },
  {
    id: 'apify',
    label: 'Apify (thousands of scrapers)',
    description:
      "Apify's Actor store: ready-made scrapers and automations for maps, shops, social sites and more.",
    category: 'hubs',
    secrets: [
      {
        name: 'apify_token',
        label: 'Apify API token',
        help: 'console.apify.com → Settings → API & Integrations',
      },
    ],
    server: http('apify', 'https://mcp.apify.com', { authSecret: 'apify_token' }),
  },
  // ── Browser & files ──
  {
    id: 'playwright',
    label: 'Browser (Playwright)',
    description:
      'Lets Jarvis read and operate web pages in a dedicated Microsoft Edge profile (not your everyday browser).',
    category: 'browser',
    server: stdio(
      'playwright',
      ['@playwright/mcp@0.0.83', '--browser', 'msedge', '--user-data-dir', '{browserProfile}'],
      {
        // Running arbitrary JavaScript inside logged-in pages is too powerful to allow by default.
        toolOverrides: {
          browser_snapshot: 'SAFE',
          browser_navigate: 'SAFE',
          browser_take_screenshot: 'SAFE',
          browser_tabs: 'SAFE',
          browser_wait_for: 'SAFE',
          browser_run_code_unsafe: 'BLOCKED',
        },
      },
    ),
  },
  // From isair/jarvis's MCP catalogue (vetted, pinned).
  {
    id: 'chrome-devtools',
    label: 'Chrome (DevTools)',
    description:
      "Google's Chrome DevTools server: open, read and operate pages in a throwaway Chrome profile (not your everyday browser). Needs Google Chrome.",
    category: 'browser',
    server: stdio('chrome-devtools', ['chrome-devtools-mcp@1.10.1', '--isolated'], {
      toolOverrides: {
        list_pages: 'SAFE',
        take_snapshot: 'SAFE',
        take_screenshot: 'SAFE',
        list_console_messages: 'SAFE',
        list_network_requests: 'SAFE',
        // Arbitrary JavaScript in a page is too powerful to allow by default (same rule as Playwright).
        evaluate_script: 'BLOCKED',
      },
    }),
  },
  {
    id: 'filesystem',
    label: 'Filesystem (scoped)',
    description:
      'The reference filesystem server, limited to the folders allowed in Settings → Files & permissions.',
    category: 'browser',
    server: stdio(
      'filesystem',
      ['@modelcontextprotocol/server-filesystem@2026.8.31', '{allowedRoots}'],
      {
        toolOverrides: {
          read_text_file: 'SAFE',
          list_directory: 'SAFE',
          search_files: 'SAFE',
          get_file_info: 'SAFE',
          list_allowed_directories: 'SAFE',
        },
      },
    ),
  },
  // ── Desktop control ──
  {
    id: 'cua-driver',
    label: 'Cua Driver (desktop apps)',
    description:
      "trycua's open-source driver (MIT): reads and operates Windows apps through UI Automation, often without taking your mouse or focus, and also works on the Claude subscription and local models. Install it first (see Help), without the admin auto-start. Listing apps and windows is free; reading a window or acting in it asks you.",
    category: 'desktop',
    server: {
      ...stdio('cua-driver', []),
      command: 'cua-driver',
      args: ['mcp'],
      trustLevel: 'community',
      toolOverrides: {
        // Listing apps and windows is harmless; reading a window returns its picture and
        // contents (like look_at_screen), so that asks too.
        list_apps: 'SAFE',
        list_windows: 'SAFE',
        // Changing the driver's own permission mode, or installing software through it, is never Jarvis's call.
        set_config: 'BLOCKED',
        install_extension: 'BLOCKED',
        install_ffmpeg: 'BLOCKED',
      },
    },
  },
  // ── Web search ──
  {
    id: 'brave-search',
    label: 'Brave Search',
    description: "Brave's own server: web, news, image and local search with a free API tier.",
    category: 'search',
    secrets: [
      {
        name: 'brave_api_key',
        label: 'Brave Search API key',
        help: 'api-dashboard.search.brave.com → API keys',
      },
    ],
    server: stdio('brave-search', ['@brave/brave-search-mcp-server@2.1.4'], {
      envSecrets: { BRAVE_API_KEY: 'brave_api_key' },
    }),
  },
  {
    id: 'tavily',
    label: 'Tavily',
    description:
      'Search, extract and crawl built for AI agents: clean page text, not ten blue links.',
    category: 'search',
    secrets: [
      { name: 'tavily_api_key', label: 'Tavily API key', help: 'app.tavily.com → API keys' },
    ],
    server: stdio('tavily', ['tavily-mcp@0.2.22'], {
      envSecrets: { TAVILY_API_KEY: 'tavily_api_key' },
    }),
  },
  {
    id: 'exa',
    label: 'Exa',
    description: 'Neural web search: finds pages by meaning, plus company and code lookups.',
    category: 'search',
    secrets: [{ name: 'exa_api_key', label: 'Exa API key', help: 'dashboard.exa.ai → API keys' }],
    server: stdio('exa', ['exa-mcp-server@3.4.2'], {
      envSecrets: { EXA_API_KEY: 'exa_api_key' },
    }),
  },
  {
    id: 'firecrawl',
    label: 'Firecrawl',
    description: 'Turns any website into clean Markdown: scrape one page, crawl a site, or search.',
    category: 'search',
    secrets: [
      { name: 'firecrawl_api_key', label: 'Firecrawl API key', help: 'firecrawl.dev → Dashboard' },
    ],
    server: stdio('firecrawl', ['firecrawl-mcp@3.29.0'], {
      envSecrets: { FIRECRAWL_API_KEY: 'firecrawl_api_key' },
    }),
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    description: "Perplexity's official server: answers with sources, deep research and reasoning.",
    category: 'search',
    secrets: [
      {
        name: 'perplexity_api_key',
        label: 'Perplexity API key',
        help: 'perplexity.ai → Settings → API',
      },
    ],
    server: stdio('perplexity', ['@perplexity-ai/mcp-server@1.3.0'], {
      envSecrets: { PERPLEXITY_API_KEY: 'perplexity_api_key' },
    }),
  },
  // ── Docs & knowledge (no keys) ──
  {
    id: 'context7',
    label: 'Context7 (library docs)',
    description:
      'Up-to-date docs and code examples for thousands of libraries and frameworks. No key needed.',
    category: 'knowledge',
    server: http('context7', 'https://mcp.context7.com/mcp'),
  },
  {
    id: 'microsoft-learn',
    label: 'Microsoft Learn',
    description:
      "Microsoft's official docs (Windows, PowerShell, Azure, .NET, Office). No key needed.",
    category: 'knowledge',
    server: http('microsoft-learn', 'https://learn.microsoft.com/api/mcp'),
  },
  {
    id: 'deepwiki',
    label: 'DeepWiki',
    description: 'Ask questions about any public GitHub repository. No key needed.',
    category: 'knowledge',
    server: http('deepwiki', 'https://mcp.deepwiki.com/mcp'),
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    description: 'Search models, datasets, papers and Spaces on the Hugging Face Hub.',
    category: 'knowledge',
    secrets: [
      {
        name: 'huggingface',
        label: 'Hugging Face access token',
        help: 'huggingface.co → Settings → Access Tokens (read)',
      },
    ],
    server: http('huggingface', 'https://huggingface.co/mcp', { authSecret: 'huggingface' }),
  },
  // ── Developer ──
  {
    id: 'github',
    label: 'GitHub',
    description:
      "GitHub's official remote MCP server. Use a fine-grained, read-only token first (expiry ≤ 90 days).",
    category: 'dev',
    secrets: [
      {
        name: 'github_pat',
        label: 'GitHub fine-grained token',
        help: 'github.com → Settings → Developer settings → Fine-grained tokens',
      },
    ],
    server: http('github', 'https://api.githubcopilot.com/mcp/', { authSecret: 'github_pat' }),
  },
  {
    id: 'linear',
    label: 'Linear',
    description: "Linear's official server: find, create and update issues, projects and comments.",
    category: 'dev',
    secrets: [
      {
        name: 'linear_api_key',
        label: 'Linear API key',
        help: 'linear.app → Settings → Security & access → Personal API keys',
      },
    ],
    server: http('linear', 'https://mcp.linear.app/mcp', { authSecret: 'linear_api_key' }),
  },
  {
    id: 'sentry',
    label: 'Sentry',
    description: "Sentry's official server: look up errors, issues and releases in your projects.",
    category: 'dev',
    secrets: [
      {
        name: 'sentry_token',
        label: 'Sentry user auth token',
        help: 'sentry.io → User settings → Personal tokens',
      },
    ],
    server: stdio('sentry', ['@sentry/mcp-server@0.42.0'], {
      envSecrets: { SENTRY_ACCESS_TOKEN: 'sentry_token' },
    }),
  },
  {
    id: 'mongodb',
    label: 'MongoDB (read-only)',
    description:
      "MongoDB's official server, started read-only: browse collections and run queries.",
    category: 'dev',
    secrets: [
      {
        name: 'mongodb_uri',
        label: 'MongoDB connection string',
        help: 'Atlas → Connect → Drivers (use a read-only database user)',
      },
    ],
    server: stdio('mongodb', ['mongodb-mcp-server@3.0.5', '--readOnly'], {
      envSecrets: { MDB_MCP_CONNECTION_STRING: 'mongodb_uri' },
    }),
  },
  {
    // ADR-031. Claude Code sessions get REA by themselves (start_claude_session studyApp); this
    // connection lets Jarvis itself inspect apps. 170+ tools: best on the Claude subscription,
    // which loads tool definitions only when needed.
    id: 'rea',
    label: 'REA: reverse engineer apps',
    description:
      'See how a feature in another app works, without its source: Electron/JavaScript apps, .NET, native programs and websites. Needs Node.js 22.19+ (or 24.11+). Has 170+ tools, so it adds a lot to each request on an API key; prefer the Claude subscription.',
    category: 'dev',
    server: stdio('rea', ['rea-agents@6.4.0', 'mcp'], { trustLevel: 'community' }),
  },
  // ── Productivity ──
  {
    id: 'notion',
    label: 'Notion',
    description:
      "Notion's official MCP server with an internal integration token. Share the pages Jarvis may use with the integration.",
    category: 'productivity',
    secrets: [
      {
        name: 'notion_token',
        label: 'Notion integration token',
        help: 'notion.so/profile/integrations → New integration',
      },
    ],
    server: stdio('notion', ['@notionhq/notion-mcp-server@2.5.2'], {
      envSecrets: { NOTION_TOKEN: 'notion_token' },
    }),
  },
  {
    id: 'todoist',
    label: 'Todoist',
    description: "Doist's official server: read and manage your tasks, projects and sections.",
    category: 'productivity',
    secrets: [
      {
        name: 'todoist_token',
        label: 'Todoist API token',
        help: 'todoist.com → Settings → Integrations → Developer',
      },
    ],
    server: stdio('todoist', ['@doist/todoist-ai@9.0.0'], {
      envSecrets: { TODOIST_API_KEY: 'todoist_token' },
    }),
  },
  {
    id: 'hubspot',
    label: 'HubSpot',
    description: "HubSpot's official server: contacts, companies, deals and tickets in your CRM.",
    category: 'productivity',
    secrets: [
      {
        name: 'hubspot_token',
        label: 'HubSpot private app token',
        help: 'HubSpot → Settings → Integrations → Private apps',
      },
    ],
    server: stdio('hubspot', ['@hubspot/mcp-server@0.4.0'], {
      envSecrets: { PRIVATE_APP_ACCESS_TOKEN: 'hubspot_token' },
    }),
  },
  {
    id: 'stripe',
    label: 'Stripe',
    description:
      "Stripe's official remote server: customers, payments, invoices. Use a restricted key with only the access Jarvis needs.",
    category: 'productivity',
    secrets: [
      {
        name: 'stripe_key',
        label: 'Stripe restricted API key',
        help: 'dashboard.stripe.com → Developers → API keys → Create restricted key',
      },
    ],
    server: http('stripe', 'https://mcp.stripe.com', { authSecret: 'stripe_key' }),
  },
  // ── Home & media ──
  {
    id: 'home-assistant',
    label: 'Home Assistant (smart home)',
    description:
      'Control lights, plugs and sensors through Home Assistant\'s built-in MCP Server integration (Settings → Devices & services → Add "Model Context Protocol Server"). Edit the address if yours isn\'t homeassistant.local.',
    category: 'home',
    secrets: [
      {
        name: 'homeassistant_token',
        label: 'Home Assistant long-lived access token',
        help: 'Home Assistant → your profile → Security → Long-lived access tokens → Create token',
      },
    ],
    server: http('home-assistant', 'http://homeassistant.local:8123/api/mcp', {
      authSecret: 'homeassistant_token',
      toolOverrides: { GetLiveContext: 'SAFE' },
    }),
  },
  {
    id: 'youtube-transcript',
    label: 'YouTube transcripts',
    description:
      'Fetches the captions of a YouTube video so Jarvis can summarise or answer questions about it. Read-only.',
    category: 'home',
    server: stdio('youtube-transcript', ['@kimtaeyoon83/mcp-server-youtube-transcript@0.1.1'], {
      trustLevel: 'community',
      toolOverrides: { get_transcript: 'SAFE' },
    }),
  },
];
