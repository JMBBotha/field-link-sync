import { useCompany } from "@/providers/CompanyProvider";
import AuditLogViewer from "@/components/audit/AuditLogViewer";
import { ArchivedHistoryNote } from "@/components/company/CompanyHistorySimple";

/** The live audit log is not company-scoped. Keep it off an archived company's history shell. */
export default function ClientShellAudit() {
  const { company } = useCompany();
  if (company?.status === "archived") {
    return <ArchivedHistoryNote title="Audit log" body="The live audit log is not this company's imported books, so it is not shown in this history." />;
  }
  return <AuditLogViewer />;
}
