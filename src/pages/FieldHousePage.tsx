import { useParams } from "react-router-dom";
import FirstFitLive from "@/components/projects/FirstFitLive";

/** Phone-first house. No prices. The office reviews the draft quote. */
export default function FieldHousePage() {
  const { houseId = "" } = useParams();
  if (!houseId) return null;
  return (
    <div className="mx-auto max-w-md p-4 pb-24" data-testid="field-house">
      <FirstFitLive houseId={houseId} companyId="" showMoney={false} />
    </div>
  );
}
