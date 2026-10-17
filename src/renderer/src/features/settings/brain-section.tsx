import { Section } from '../../components/ui/field';
import { call } from '../../lib/api';
import { useDraftSetting, useSettingsStore } from '../../stores/settings-store';
import { AgentClisCard } from './agent-clis-card';
import { ConnectionsCard } from './connections-card';
import { ConnectionPicker, LocalModelCard, SubscriptionApps } from './connection';
import { ModelTreeView } from './model-tree-view';
import { SettingInput, SettingSelect, SettingSwitch } from './settings-controls';

export function BrainSection(): React.JSX.Element {
  const day = useSettingsStore((s) => s.dayCostUsd);
  const month = useSettingsStore((s) => s.monthCostUsd);
  const provider = useDraftSetting('llm.provider');
  const subscription = provider === 'subscription';
  const fallbackLocal = useDraftSetting('llm.fallbackLocal') === true;
  return (
    <>
      <Section
        title="Your AI tree"
        description="Jarvis at the top; every AI he can use hangs below it, with the models each one runs. The main brain answers you; helpers take sub-tasks; the fallback steps in when Claude is down. Click a branch to change it."
      >
        <ModelTreeView />
      </Section>
      <div id="brain-connection" className="scroll-mt-4">
        <Section
          title="Connection"
          description="Jarvis uses Claude as its brain. An API key is encrypted with Windows DPAPI and never leaves this PC except to call Anthropic. Subscription mode runs your signed-in Claude Code; Jarvis never sees your Claude login."
        >
          <ConnectionPicker />
          {provider === 'api' && (
            <div className="grid gap-1">
              <SettingSwitch
                k="llm.fallbackLocal"
                label="If Claude is busy or unreachable, let my local model answer"
              />
              <p className="text-xs text-ink-300">
                Uses the local model saved for the Local model connection (Ollama or LM Studio).
                Free and offline but less capable; a note tells you when it happens.
              </p>
              {fallbackLocal && <LocalModelCard />}
            </div>
          )}
          <p className="text-sm text-ink-300" hidden={subscription}>
            Also set a monthly spend limit in the{' '}
            <button
              type="button"
              className="text-accent-300 underline underline-offset-2"
              onClick={() =>
                void call('app:openExternal', {
                  url: 'https://console.anthropic.com/settings/limits',
                })
              }
            >
              Anthropic Console
            </button>
            .
          </p>
        </Section>
      </div>
      <div id="brain-connections" className="scroll-mt-4">
        <Section
          title="Connections and models"
          description="Every AI provider key you saved, and more than one per provider if you like (work and personal). Each has its own model list: refresh it from the provider, star favourites, hide the ones you don't want. Keys stay encrypted on this PC."
        >
          <ConnectionsCard />
        </Section>
      </div>
      <Section title="Models" description="Model IDs can be changed without an app update.">
        <div className="grid max-w-xl gap-4">
          <SettingInput k="models.default" label="Default (conversation)" />
          <SettingInput k="models.deep" label="Deep thinking (“think hard”, “plan”)" />
          <SettingInput k="models.fast" label="Background (titles, summaries, memory)" />
          <SettingInput
            k="models.computer"
            label="Computer control"
            hint="Must support the computer-use toolset (Sonnet or Opus 5.5)."
          />
        </div>
        <SettingSwitch k="web.search.enabled" label="Allow web search (billed per search)" />
      </Section>
      <div id="brain-subscriptions" className="scroll-mt-4">
        <Section
          title="Your AI subscriptions"
          description="Use the ChatGPT and Gemini plans you already pay for, through OpenAI's Codex app and Google's Antigravity app (signed in with your account, no API key). They only think and write (no tools) and never see outside content; give them to NPCs or let Jarvis hand them sub-tasks. Usage counts against your plan's limits."
        >
          <SubscriptionApps />
        </Section>
      </div>
      <Section
        title="Coding agents on this PC"
        description="AI command-line apps Jarvis knows about. He only looks for their files: nothing is run and no sign-in data is read. Ones marked “found only” will be wired in once their script mode is tested on this PC."
      >
        <AgentClisCard />
      </Section>
      <Section
        title="Budget"
        description={
          subscription
            ? 'Budgets limit API-key spending only. Subscription use counts against your Claude plan limits instead; the Usage tab shows its API-equivalent cost.'
            : `Requests stop when a budget is used up. Spent today: $${day.toFixed(2)} · this month: $${month.toFixed(2)}.`
        }
      >
        <div className="flex flex-wrap gap-6">
          <SettingInput k="budget.dailyUsd" label="Daily budget (USD)" type="number" step={0.5} />
          <SettingInput k="budget.monthlyUsd" label="Monthly budget (USD)" type="number" step={1} />
          <SettingInput
            k="budget.automationRunUsd"
            label="Per automation run (USD, 0 = no cap)"
            type="number"
            step={0.1}
          />
          <SettingInput
            k="budget.confirmRunUsd"
            label="Ask before a Compare AIs run that may cost over (USD, 0 = always)"
            type="number"
            step={0.05}
          />
        </div>
      </Section>
      <Section
        title="Fast commands"
        description="Plain PC commands, typed or spoken (“open Spotify”, “volume 30”, “next song”, “mute”, “lock my PC”), run straight away with no Claude call: instant and free. With Laya installed, loosely worded ones (“ugh, skip this song”) work too, understood on this PC. Anything else goes to Claude as usual."
      >
        <SettingSelect
          k="agent.fastCommands"
          label="Fast commands"
          options={[
            { value: 'laya', label: 'Rules + Laya (recommended)' },
            { value: 'rules', label: 'Exact phrasings only' },
            { value: 'off', label: 'Off (always ask Claude)' },
          ]}
        />
      </Section>
    </>
  );
}
