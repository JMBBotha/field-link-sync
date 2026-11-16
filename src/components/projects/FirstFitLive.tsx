import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import FirstFitPanel, { type FirstFitView } from "@/components/projects/FirstFitPanel";
import {
  fileFirstFitPoint, fileSitePhoto, loadHouseFirstFit, saveHouseUnitList, setFirstFitComplete, undoFirstFitComplete,
} from "@/lib/firstFitApi";

/** Loads one house. A missing migration hides the block so the rest of the drawer still opens. */
export default function FirstFitLive({ houseId, companyId, showMoney, onChanged }: {
  houseId: string; companyId: string; showMoney: boolean; onChanged?: () => void;
}) {
  const { toast } = useToast();
  const [view, setView] = useState<FirstFitView | null>(null);
  const [projectId, setProjectId] = useState("");
  const [company, setCompany] = useState(companyId);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(() => {
    loadHouseFirstFit(houseId, showMoney).then((r) => {
      setView(r.view);
      setProjectId(r.raw.project_id);
      setCompany(r.raw.company_id || companyId);
      setHidden(false);
    }).catch(() => setHidden(true));
  }, [houseId, showMoney, companyId]);

  useEffect(() => { load(); }, [load]);

  const run = async (work: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await work();
      toast({ title: ok });
      load();
      onChanged?.();
    } catch (e: any) {
      toast({ title: "Couldn't save", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (hidden || !view || !projectId) return null;
  return (
    <FirstFitPanel
      view={view}
      busy={busy}
      onSnap={(input) => run(() => fileFirstFitPoint({ houseId, companyId: company, projectId, ...input }), "Point filed")}
      onSitePhoto={(file) => run(() => fileSitePhoto(company, projectId, houseId, file), "Photo filed on this house")}
      onComplete={() => run(() => setFirstFitComplete(houseId), "First fit complete. The house is Live. The draft quote is not sent.")}
      onUndo={() => run(() => undoFirstFitComplete(houseId), "First fit complete was undone. Drafts were kept and flagged.")}
      onSaveUnits={(units) => run(() => saveHouseUnitList(houseId, units), "Unit list saved")}
    />
  );
}
