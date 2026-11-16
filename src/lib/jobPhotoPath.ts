/** New job photos are stored under the company. Older files stay at `{leadId}/{file}`. */
export function jobPhotoStoragePath(companyId: string | null | undefined, leadId: string, fileName: string): string {
  const file = String(fileName || "").replace(/^\/+/, "");
  const lead = String(leadId || "").replace(/^\/+|\/+$/g, "");
  if (!lead || !file) throw new Error("Photo path needs a lead and a file name");
  const company = String(companyId || "").trim();
  return company ? `${company}/${lead}/${file}` : `${lead}/${file}`;
}

/** House photos: `{company}/{project}/{house}/{file}` in the private house-photos bucket. */
export function housePhotoStoragePath(companyId: string, projectId: string, houseId: string, fileName: string): string {
  const file = String(fileName || "").replace(/^\/+/, "");
  if (!companyId || !projectId || !houseId || !file) throw new Error("House photo path is incomplete");
  return `${companyId}/${projectId}/${houseId}/${file}`;
}
