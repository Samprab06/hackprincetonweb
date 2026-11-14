import {
  WorkspaceView,
  type PreviewPageProps,
} from "@/components/workspace-view";
import {
  ComparisonScreen,
  comparisonScenario,
} from "@/components/comparison/comparison-screen";
import { getPreviewProject } from "@/lib/workspace-preview";

export default async function Page({ params, searchParams }: PreviewPageProps) {
  const [{ projectId }, { site, visits, comparison, investigation }] =
    await Promise.all([params, searchParams]);
  const project = getPreviewProject(projectId);
  return (
    <WorkspaceView
      projectId={projectId}
      view="comparison"
      siteId={typeof site === "string" ? site : undefined}
    >
      {project && (
        <ComparisonScreen
          project={project}
          visits={comparisonScenario(visits)}
          previousId={typeof comparison === "string" ? comparison : undefined}
          investigationId={
            typeof investigation === "string" ? investigation : undefined
          }
        />
      )}
    </WorkspaceView>
  );
}
