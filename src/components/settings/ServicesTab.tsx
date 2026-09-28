import ServicesCatalogCard from "@/components/settings/ServicesCatalogCard";
import { useCanWriteMasterCatalog, MASTER_ONLY_NOTE } from "@/components/catalog/MasterCatalogGate";

/** Services = catalog_services only (legacy hvac_services table was removed). */
const ServicesTab = () => {
  const canWrite = useCanWriteMasterCatalog();
  if (!canWrite) return <p className="text-sm text-muted-foreground">{MASTER_ONLY_NOTE.replace("Price lists are", "Services are")}</p>;
  return <ServicesCatalogCard />;
};
export default ServicesTab;
