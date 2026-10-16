import { PageBody, PageHeader } from '../../components/ui/page';
import { AutomationsSection } from './automations-section';
import { SaveBar } from './save-bar';
import { SkillsSection } from './skills-section';

/** Sidebar → Automations (moved out of Settings so routines are one click away). */
export function AutomationsView(): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader title="Automations" help="automations" />
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
      <PageHeader title="Skills" help="skills" />
      {/* Full width: the skills network needs the room the other pages' reading column doesn't. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 md:px-6">
        <div className="fade-in mx-auto w-full max-w-[110rem] py-6">
          <SkillsSection />
        </div>
      </div>
      <SaveBar />
    </div>
  );
}
