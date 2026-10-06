import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Section } from '../../components/ui/field';
import { call, cleanError } from '../../lib/api';
import { SettingInput } from './settings-controls';

export function AdvancedSection(): React.JSX.Element {
  const [result, setResult] = useState<string | null>(null);
  return (
    <>
      <Section
        title="Limits"
        description="Jarvis stops and reports when a task needs more steps than this."
      >
        <div className="flex flex-wrap gap-6">
          <SettingInput k="agent.maxIterations" label="Steps per request" type="number" step={1} />
          <SettingInput
            k="agent.computerMaxActions"
            label="Actions per computer-control task"
            type="number"
            step={5}
          />
          <SettingInput
            k="budget.perTurnInputTokens"
            label="Input tokens per request"
            type="number"
            step={10000}
          />
        </div>
      </Section>
      <Section
        title="Computer control"
        description="Checks that clicks land where Jarvis aims at your display scaling. The mouse pointer moves briefly."
      >
        <div className="flex items-center gap-3">
          <Button
            onClick={() =>
              void call('computer:calibrate', {})
                .then((r) =>
                  setResult(
                    r.ok
                      ? `✓ Clicks are accurate (within ${r.maxErrorPx} px).`
                      : `✗ Clicks may be off by ${r.maxErrorPx} px. Check Windows display scaling.`,
                  ),
                )
                .catch((e: unknown) => setResult(cleanError(e)))
            }
          >
            Check click accuracy
          </Button>
          {result && (
            <p role="status" className="text-sm text-ink-300">
              {result}
            </p>
          )}
        </div>
      </Section>
    </>
  );
}
