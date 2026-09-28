import ServicesCatalogCard from "@/components/settings/ServicesCatalogCard";
import { useCanWriteMasterCatalog } from "@/components/catalog/MasterCatalogGate";

/** Services = catalog_services only. Master admins only; nothing while loading. */
const ServicesTab = () => {
  const { canWrite, isLoading } = useCanWriteMasterCatalog();
  if (isLoading || !canWrite) return null;
  return <ServicesCatalogCard />;
};
export default ServicesTab;
