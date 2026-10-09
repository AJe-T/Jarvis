import { Section } from '../../components/ui/field';
import { call } from '../../lib/api';
import { useDraftSetting, useSettingsStore } from '../../stores/settings-store';
import { ConnectionPicker } from './connection';
import { SettingInput, SettingSwitch } from './settings-controls';

export function BrainSection(): React.JSX.Element {
  const day = useSettingsStore((s) => s.dayCostUsd);
  const month = useSettingsStore((s) => s.monthCostUsd);
  const subscription = useDraftSetting('llm.provider') === 'subscription';
  return (
    <>
      <Section
        title="Connection"
        description="Jarvis uses Claude as its brain. An API key is encrypted with Windows DPAPI and never leaves this PC except to call Anthropic. Subscription mode runs your signed-in Claude Code; Jarvis never sees your Claude login."
      >
        <ConnectionPicker />
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
        </div>
      </Section>
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
    </>
  );
}
