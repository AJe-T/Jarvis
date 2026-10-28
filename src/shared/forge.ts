/**
 * Forge (ADR-046) clones and runs this repository's scripts, so only a github.com repository is
 * accepted. Its own file so Forge's protected list can cover it (Security.md §17).
 */
export const FORGE_REPO_RE =
  /^(?:https:\/\/github\.com\/|git@github\.com:)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?(?:\.git)?$/;

/**
 * Forge phase F4: which free providers promise not to train on what they receive, so Jarvis's code
 * goes to them first and to the others only after Sir says yes. ⚠️ Checked 2026-10-28 against each
 * provider's own terms; a provider not listed counts as "may train". Tier-3 relays never get code.
 */
export const FREE_TIER_TRAINING: Readonly<Record<string, { trains: boolean; source: string }>> = {
  groq: {
    trains: false,
    source:
      'https://console.groq.com/docs/your-data (no inference data kept by default; logs up to 30 days)',
  },
  cerebras: {
    trains: false,
    source:
      'https://www.cerebras.ai/terms-of-service ("does not grant Cerebras the right to use Service Content for … training")',
  },
  cloudflare: {
    trains: false,
    source:
      'https://developers.cloudflare.com/workers-ai/platform/privacy/ (no training on customer content)',
  },
  gemini: {
    trains: true,
    source:
      'https://ai.google.dev/gemini-api/terms (unpaid services: used to improve products, human review)',
  },
  mistral: {
    trains: true,
    source:
      'https://help.mistral.ai/en/articles/323757 (free plan requests may be used for training)',
  },
  openrouter: {
    trains: true,
    source: "https://openrouter.ai/docs (free models: depends on each model's provider)",
  },
  nvidia: {
    trains: true,
    source:
      'NVIDIA API Trial Terms (reported to allow use of prompts to improve products; unclear)',
  },
};

export const trainsOnFree = (provider: string): boolean =>
  FREE_TIER_TRAINING[provider]?.trains ?? true;
