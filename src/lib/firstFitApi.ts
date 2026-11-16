import { supabase } from "@/integrations/supabase/client";
import { housePhotoStoragePath } from "@/lib/jobPhotoPath";
import type { IssueState } from "@/lib/firstFit";
import type { FirstFitPointRow, FirstFitQuote, FirstFitSchedule, FirstFitView } from "@/components/projects/FirstFitPanel";

const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args);

export interface HouseFitBadge {
  houseId: string;
  live: boolean;
  points: number;
  areas: number;
  pipeM: number;
  depositOn: string | null;
  depositState: IssueState | null;
  balanceOn: string | null;
  balanceState: IssueState | null;
  balanceEstimated: boolean;
}

async function signed(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from("house-photos").createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

function schedule(on: string | null, state: string | null, estimated: boolean, row: any): FirstFitSchedule {
  return {
    on, state: (state as IssueState) || null, estimated: !!estimated,
    number: row?.number || null, id: row?.id || null, amount: row?.amount ?? null, flag: row?.flag || null,
  };
}

export function viewFromDetail(row: any, showMoney: boolean): FirstFitView & { projectId: string; companyPath: string } {
  const points: FirstFitPointRow[] = (row.point_rows || []).map((p: any) => ({
    id: p.id, area: p.area, unitSize: p.unit_size, pipeM: Number(p.pipe_m), caption: p.caption, url: null, storagePath: p.storage_path,
  }));
  return {
    houseNo: row.house_no,
    projectName: row.project_name,
    projectId: row.project_id,
    companyPath: "",
    live: !!row.live,
    completeAt: row.complete_at,
    completeBy: row.complete_by,
    undoneAt: row.undone_at,
    undoneBy: row.undone_by,
    points,
    units: (row.units || []).map((u: any) => ({ area: u.area, unitSize: u.unit_size })),
    pipeM: Number(row.pipe_m || 0),
    deposit: schedule(row.deposit_on, row.deposit_state, false, row.deposit),
    balance: schedule(row.balance_on, row.balance_state, !!row.balance_estimated, row.balance),
    quote: row.quote ? {
      id: row.quote.id, number: row.quote.number, flag: row.quote.flag, total: row.quote.total, ready: row.quote.ready || !!row.quote.id, status: row.quote.status,
    } satisfies FirstFitQuote : null,
    showMoney,
    canEditList: !!row.can_edit_list,
  };
}

export async function loadHouseFirstFit(houseId: string, showMoney: boolean) {
  const { data, error } = await rpc("house_first_fit_detail", { p_house: houseId });
  if (error) throw error;
  const view = viewFromDetail(data, showMoney);
  view.points = await Promise.all(view.points.map(async (p) => ({ ...p, url: await signed((p as any).storagePath) })));
  return { view, raw: data as any };
}

export async function loadFirstFitBoard(projectId: string): Promise<Record<string, HouseFitBadge>> {
  const { data, error } = await rpc("house_first_fit_board", { p_project: projectId });
  if (error) return {};
  const out: Record<string, HouseFitBadge> = {};
  for (const h of data?.houses || []) {
    out[h.house_id] = {
      houseId: h.house_id, live: !!h.live, points: Number(h.points || 0), areas: Number(h.areas || 0), pipeM: Number(h.pipe_m || 0),
      depositOn: h.deposit_on || null, depositState: h.deposit_state || null,
      balanceOn: h.balance_on || null, balanceState: h.balance_state || null, balanceEstimated: !!h.balance_estimated,
    };
  }
  return out;
}

export async function searchFirstFitHouses(query: string) {
  const { data, error } = await rpc("search_first_fit_houses", { p_query: query });
  if (error) throw error;
  return (data?.houses || []) as { house_id: string; house_no: string; project_name: string; project_id: string; live: boolean }[];
}

export async function uploadHousePhoto(companyId: string, projectId: string, houseId: string, file: File) {
  const id = crypto.randomUUID();
  const path = housePhotoStoragePath(companyId, projectId, houseId, `${id}.jpg`);
  const up = await supabase.storage.from("house-photos").upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
  if (up.error) throw up.error;
  return { id, path };
}

export async function fileFirstFitPoint(input: {
  houseId: string; companyId: string; projectId: string; area: string; unitSize: string; pipeM: number; file: File | null;
}) {
  const ref = crypto.randomUUID();
  let path = housePhotoStoragePath(input.companyId, input.projectId, input.houseId, `${ref}.jpg`);
  if (input.file) {
    const up = await supabase.storage.from("house-photos").upload(path, input.file, { contentType: input.file.type || "image/jpeg" });
    if (up.error) throw up.error;
  }
  const { data, error } = await rpc("record_first_fit_point", {
    p_house: input.houseId, p_area: input.area, p_unit_size: input.unitSize, p_pipe_m: String(input.pipeM),
    p_storage_path: path, p_source_ref: ref,
  });
  if (error) throw error;
  return data;
}

export async function fileSitePhoto(companyId: string, projectId: string, houseId: string, file: File) {
  const { id, path } = await uploadHousePhoto(companyId, projectId, houseId, file);
  const { data, error } = await rpc("record_house_photo", { p_house: houseId, p_storage_path: path, p_source_ref: id });
  if (error) throw error;
  return data;
}

export async function setFirstFitComplete(houseId: string) {
  const { data, error } = await rpc("set_first_fit_complete", { p_house: houseId });
  if (error) throw error;
  return data;
}

export async function undoFirstFitComplete(houseId: string) {
  const { data, error } = await rpc("undo_first_fit_complete", { p_house: houseId });
  if (error) throw error;
  return data;
}

export async function saveHouseUnitList(houseId: string, units: { area: string; unitSize: string }[]) {
  const { data, error } = await rpc("save_house_unit_list", {
    p_house: houseId,
    p_units: units.map((u) => ({ area: u.area, unit_size: u.unitSize })),
  });
  if (error) throw error;
  return data;
}
