import { WorkspaceView, type PreviewPageProps } from "@/components/workspace-view";

export default async function Page({ params, searchParams }: PreviewPageProps) {
  const [{ projectId }, { site }] = await Promise.all([params, searchParams]);
  return <WorkspaceView projectId={projectId} view="intake" siteId={typeof site === "string" ? site : undefined} />;
}
