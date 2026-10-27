/**
 * AI Router (free pool): the shapes the sidebar module shows. Step 0 (2.29) fills them with
 * labelled preview data in the renderer; Phase 1 serves the same shapes from main.
 *
 * Tiers are about WHO RECEIVES the text, not which model answers it: Gemini through Google is
 * tier 2, the same Gemini through an unknown relay is tier 3.
 */

/** 1 = Jarvis's brain and this PC (private data allowed) · 2 = trusted free · 3 = third-party relays. */
export type PoolTier = 1 | 2 | 3;

/** Which build phase wires a feature (UI shows a badge until then). */
export type PoolPhase = 1 | 2 | 3 | 4;

export type KeyHealth = 'healthy' | 'cooling' | 'issue' | 'unchecked';

export const ROUTING_STRATEGIES = [
  { id: 'priority', label: 'Priority', phase: 1, weights: 'your order, top to bottom' },
  { id: 'balanced', label: 'Balanced', phase: 1, weights: 'reliability 50 · speed 25 · smarts 25' },
  { id: 'smartest', label: 'Smartest', phase: 4, weights: 'reliability 35 · speed 10 · smarts 55' },
  { id: 'fastest', label: 'Fastest', phase: 4, weights: 'reliability 35 · speed 55 · smarts 10' },
  {
    id: 'reliable',
    label: 'Most reliable',
    phase: 4,
    weights: 'reliability 70 · speed 15 · smarts 15',
  },
  { id: 'custom', label: 'Custom', phase: 4, weights: 'your own weights' },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  phase: PoolPhase;
  weights: string;
}>;

export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number]['id'];

/** Per-minute / per-day request and token caps (undefined = the provider publishes none). */
export interface PoolLimits {
  rpm?: number;
  rpd?: number;
  tpm?: number;
  tpd?: number;
}

export interface PoolKey {
  id: string;
  /** Last four characters only; the key itself never reaches the renderer. */
  hint: string;
  health: KeyHealth;
  lastChecked: string | null;
  /** 0..1 of today's tightest cap already used. */
  usedToday: number;
}

export interface PoolProvider {
  id: string;
  label: string;
  tier: PoolTier;
  enabled: boolean;
  keys: PoolKey[];
  /** Where the free-tier limits were read, and when (catalog rule: official docs only). */
  docsUrl: string;
  checked: string;
}

/** One way to reach a model: through one provider, which decides the tier. */
export interface PoolRoute {
  providerId: string;
  tier: PoolTier;
  limits: PoolLimits;
  usedFraction: number;
  /** ISO time the route is paused until (rate limited or failing). */
  coolingUntil?: string;
}

export type ModelSize = 'frontier' | 'large' | 'medium' | 'small';

export interface PoolModel {
  id: string;
  label: string;
  maker: string;
  size: ModelSize;
  contextK: number;
  tools: boolean;
  vision: boolean;
  /** Free tokens per month across every route Sir has a key for. */
  monthlyTokens: number;
  usedTokens: number;
  /** 0..100 per axis; the router's combined score is 0..1. */
  reliability: number;
  speed: number;
  intelligence: number;
  score: number;
  enabled: boolean;
  routes: PoolRoute[];
}

/** One answer the pool gave, with every route it tried first (feature #39, the trail). */
export interface PoolAnswer {
  id: string;
  at: string;
  task: string;
  modelLabel: string;
  providerId: string;
  tier: PoolTier;
  tried: Array<{ providerId: string; reason: string }>;
  ms: number;
  tokens: number;
}

/** A route that is paused right now and why (cooldowns, feature #3). */
export interface PoolPressure {
  providerId: string;
  modelLabel: string;
  reason: string;
  until: string;
}

export interface PoolSnapshot {
  /** True while the numbers are samples (Step 0); false once Phase 1 serves real ones. */
  preview: boolean;
  enabled: boolean;
  strategy: RoutingStrategy;
  providers: PoolProvider[];
  models: PoolModel[];
  recent: PoolAnswer[];
  pressure: PoolPressure[];
  today: { requests: number; successRate: number; tokens: number; savedUsd: number };
}

/** What counts as private: a turn that used any of these never leaves tier 1 (enforced in main). */
export const PRIVATE_SOURCES = [
  { id: 'memory', label: 'Memory and the vault' },
  { id: 'files', label: 'Files on this PC' },
  { id: 'screen', label: 'Screenshots and the screen' },
  { id: 'passwords', label: 'Passwords' },
  { id: 'clipboard', label: 'Clipboard' },
  { id: 'messages', label: 'WhatsApp, Telegram and email' },
] as const;
