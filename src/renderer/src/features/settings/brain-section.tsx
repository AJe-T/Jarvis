import { Section } from '../../components/ui/field';
import { call } from '../../lib/api';
import { useSettingsStore } from '../../stores/settings-store';
import { SecretField } from './secret-field';
import { SettingInput, SettingSwitch } from './settings-controls';

export function BrainSection(): React.JSX.Element {
  const day = useSettingsStore((s) => s.dayCostUsd);
  const month = useSettingsStore((s) => s.monthCostUsd);
  return (
    <>
      <Section
        title="API key"
        description="Jarvis uses Claude as its brain. The key is encrypted with Windows DPAPI and never leaves this PC except to call Anthropic."
      >
        <SecretField
          name="anthropic"
          label="Anthropic API key"
          placeholder="sk-ant-…"
          testable="anthropic"
        />
        <p className="text-sm text-ink-300">
          Also set a monthly spend limit in the{' '}
          <button
            type="button"
            className="text-reactor-500 underline underline-offset-2"
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
        description={`Requests stop when a budget is used up. Spent today: $${day.toFixed(2)} · this month: $${month.toFixed(2)}.`}
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
