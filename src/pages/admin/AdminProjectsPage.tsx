import { useParams } from "react-router-dom";
import ProjectsList from "@/components/projects/ProjectsList";
import ProjectView from "@/components/projects/ProjectView";

export default function AdminProjectsPage() {
  const { projectId } = useParams();
  if (projectId) return <ProjectView projectId={projectId} backTo={{ to: "/admin/projects", label: "Projects" }} />;
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      <div><h1 className="text-2xl font-semibold">Projects</h1><p className="text-sm text-muted-foreground">Developments across all clients. Add a new one from the client's Projects tab.</p></div>
      <ProjectsList />
    </div>
  );
}
