import { useNavigate } from "react-router-dom";
import { useCompany } from "@/providers/CompanyProvider";
import ProposalBuilder from "@/components/proposals/ProposalBuilder";

const FBCreateEstimatePage = () => {
  const { companyId } = useCompany();
  const navigate = useNavigate();

  return (
    <ProposalBuilder
      onBack={() => navigate("../estimates")}
      onSuccess={() => navigate("../estimates")}
      onConvertedToInvoice={() => navigate("../invoices")}
    />
  );
};

export default FBCreateEstimatePage;
