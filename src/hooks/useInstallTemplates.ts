import { useQuery } from "@tanstack/react-query";
import { fetchInstallTemplates, type InstallTemplate } from "@/lib/installTemplates";

export function useInstallTemplates() {
  const { data: templates = [], isLoading } = useQuery<InstallTemplate[]>({
    queryKey: ["install-templates"],
    queryFn: fetchInstallTemplates,
    staleTime: 5 * 60 * 1000,
  });
  return { templates, isLoading };
}
