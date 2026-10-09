import { PageBody, PageHeader } from '../../components/ui/page';
import { AutomationsSection } from './automations-section';
import { SaveBar } from './save-bar';
import { SkillsSection } from './skills-section';

/** Sidebar → Automations (moved out of Settings so routines are one click away). */
export function AutomationsView(): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader title="Automations" />
      <PageBody className="fade-in">
        <AutomationsSection />
      </PageBody>
      <SaveBar />
    </div>
  );
}

/** Sidebar → Skills. */
export function SkillsView(): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader title="Skills" />
      <PageBody className="fade-in">
        <SkillsSection />
      </PageBody>
      <SaveBar />
    </div>
  );
}
