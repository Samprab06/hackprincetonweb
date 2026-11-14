import {
  WorkspaceView,
  type PreviewPageProps,
} from "@/components/workspace-view";
import { comparisonScenario } from "@/components/comparison/comparison-screen";
import { ReplayScreen } from "@/components/replay/replay-screen";
import { getPreviewProject } from "@/lib/workspace-preview";

export default async function Page({ params, searchParams }: PreviewPageProps) {
  const [{ projectId }, { site, visits }] = await Promise.all([
    params,
    searchParams,
  ]);
  const project = getPreviewProject(projectId);
  const siteId = typeof site === "string" ? site : undefined;
  return (
    <WorkspaceView projectId={projectId} view="replay" siteId={siteId}>
      {project && (
        <ReplayScreen
          project={project}
          visits={comparisonScenario(visits)}
          siteId={siteId}
        />
      )}
    </WorkspaceView>
  );
}
