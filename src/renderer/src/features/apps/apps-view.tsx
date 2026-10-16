import { PageBody, PageHeader } from '../../components/ui/page';
import { AppsGrid } from './apps-grid';

/** ADR-032/040: Sidebar → Apps. Every app opens beside the orb on Core. */
export function AppsView(): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader title="Apps" help="apps" />
      <PageBody className="flex flex-col gap-4">
        <p className="text-sm text-ink-500">
          Each app opens beside the orb on Core. Jarvis can open them too (“open the calculator”,
          “show me the terminal”).
        </p>
        <AppsGrid />
      </PageBody>
    </div>
  );
}
