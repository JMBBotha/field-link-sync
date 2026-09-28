/**
 * Mirror of the database catalogue access rules (is_master_company_user /
 * is_approved_network_member / can_read_master_catalog / can_write_master_catalog).
 * The database is the authority; this pure copy documents and tests the rule.
 */
export type NetworkStatus = "pending" | "approved" | "rejected" | "removed";

export interface CatalogAccessInput {
  companyIsMaster: boolean;
  /** Status of the user's company in company_network_members against the master; null = no row. */
  networkStatus: NetworkStatus | null;
  roles: string[];
}

export const isMasterCompanyUser = (i: CatalogAccessInput) => i.companyIsMaster;
export const isApprovedNetworkMember = (i: CatalogAccessInput) => i.networkStatus === "approved";
export const canReadMasterCatalog = (i: CatalogAccessInput) => isMasterCompanyUser(i) || isApprovedNetworkMember(i);
export const canWriteMasterCatalog = (i: CatalogAccessInput) => isMasterCompanyUser(i) && i.roles.includes("admin");
