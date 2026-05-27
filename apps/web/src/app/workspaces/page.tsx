import { PageHeader } from "@/components/page-header";
import { getWorkspaceRepository } from "@/lib/server/workspaces";
import { WorkspaceList } from "./_components/workspace-list.client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function WorkspacesPage(): Promise<React.ReactElement> {
  const workspaces = await getWorkspaceRepository().list();
  return (
    <div>
      <PageHeader
        eyebrow="Workspaces"
        title="Gestioná los proyectos sobre los que opera ManyHands."
        description="Los workspaces persisten en .manyhands/workspaces.json en la raíz del repo. Borrá el archivo para resembrar la lista con los defaults."
      />
      <WorkspaceList workspaces={workspaces} />
    </div>
  );
}
