import { notFound } from "next/navigation";
import { getPreviewProject } from "@/lib/workspace-preview";
import { WorkspaceView, type PreviewPageProps } from "@/components/workspace-view";

export default async function Page({ params, searchParams }: PreviewPageProps) {
  const [{ projectId }, { site }] = await Promise.all([params, searchParams]);
  if (!getPreviewProject(projectId)) notFound();
  return <WorkspaceView projectId={projectId} view="map" siteId={typeof site === "string" ? site : undefined} />;
}
