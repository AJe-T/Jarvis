import { Section } from '../../components/ui/field';
import { SettingSelect } from './settings-controls';
import { ModelDownload, useModels } from './voice-engines';

/** ADR-027: Laya decides on this PC whether ambient speech is for Jarvis before Claude is asked. */
export function LayaSection(): React.JSX.Element {
  const models = useModels();
  return (
    <Section
      title="On-device listening filter (Laya)"
      description="Laya is a 1.3 GB model that runs on this PC (in the background model process) and answers small multiple-choice questions about text. It can't write replies, so it can't replace Claude, but it saves Claude calls two ways. Here: in always-listening mode it drops phrases that clearly aren't for Jarvis before Claude is asked (start with Watch only: it only logs agreement). And in AI Router → Main brain → Fast commands it understands loosely worded PC commands, which then run with no Claude call."
    >
      {models.status?.['laya-multilingual']?.installed ? (
        <ModelDownload id="laya-multilingual" models={models} />
      ) : (
        // ADR-027: not hosted for download yet, so no Download button.
        <p className="text-sm text-ink-300">
          Not installed. Close Jarvis and run <code>npm run laya:install &lt;folder&gt;</code> with
          an ONNX export (Bible → Developing).
        </p>
      )}
      <SettingSelect
        k="laya.mode"
        label="Laya"
        options={[
          { value: 'off', label: 'Off' },
          { value: 'shadow', label: 'Watch only (log agreement)' },
          { value: 'on', label: 'On (skip Claude when sure)' },
        ]}
      />
    </Section>
  );
}
