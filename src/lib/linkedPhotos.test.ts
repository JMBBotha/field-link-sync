import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  groupLinkedPhotos,
  linkedPhotosQuietError,
  linkedSourceLabel,
  mayReadLinkedPhotos,
  parseLinkedPhotoRows,
  unionLinkedPhotos,
  visibleLinkedPhotos,
  type LinkedPhotoAccess,
  type LinkedPhotoRaw,
} from "./linkedPhotos";

const CT = "11111111-1111-4111-8111-111111111111";
const OT = "22222222-2222-4222-8222-222222222222";

function access(over: Partial<LinkedPhotoAccess> = {}): LinkedPhotoAccess {
  return {
    signedIn: true,
    callerCompanyId: CT,
    jobCompanyId: CT,
    techOnly: false,
    salesRep: false,
    office: false,
    assignedToJob: false,
    repBookedOrAssigned: false,
    ...over,
  };
}

function row(over: Partial<LinkedPhotoRaw> & Pick<LinkedPhotoRaw, "id" | "storage_path" | "source">): LinkedPhotoRaw {
  return {
    bucket: "quote-photos",
    display_path: over.storage_path,
    caption: null,
    ref: null,
    lead_id: null,
    created_at: "2026-11-01T00:00:00Z",
    ...over,
  };
}

describe("linked photo labels, union, and dedupe", () => {
  it("names the quote, the invoice, the site visit, and the customer's site", () => {
    expect(linkedSourceLabel("quote", "Q-2026-0063")).toBe("From quote Q-2026-0063");
    expect(linkedSourceLabel("invoice", "INV-045")).toBe("From invoice INV-045");
    expect(linkedSourceLabel("site_visit", null)).toBe("From site visit");
    expect(linkedSourceLabel("site", null)).toBe("From the customer's site");
    expect(linkedSourceLabel("quote", "  ")).toBe("From quote");
  });

  it("keeps one file when the quote and its invoice point at the same path, and keeps the quote label", () => {
    const path = `${CT}/q/outdoor.jpg`;
    const photos = unionLinkedPhotos([
      row({ id: "inv", storage_path: path, source: "invoice", ref: "INV-045", created_at: "2026-11-02T00:00:00Z", caption: "From the invoice row" }),
      row({ id: "q", storage_path: path, source: "quote", ref: "Q-2026-0063", created_at: "2026-11-03T00:00:00Z", display_path: `${CT}/q/outdoor-marked.jpg` }),
      row({ id: "board", storage_path: `${CT}/q/board.jpg`, source: "quote", ref: "Q-2026-0063", bucket: "quote-photos" }),
      row({ id: "visit", storage_path: `${CT}/visit/front.jpg`, source: "site_visit", bucket: "site-surveys", lead_id: "lead-visit" }),
      row({ id: "house", storage_path: `${CT}/house/site.jpg`, source: "site", bucket: "house-photos", created_at: "2026-10-01T00:00:00Z" }),
    ]);
    expect(photos.map((p) => p.id)).toEqual(["board", "q", "visit", "house"]);
    const outdoor = photos.find((p) => p.id === "q");
    expect(outdoor?.label).toBe("From quote Q-2026-0063");
    expect(outdoor?.displayPath).toBe(`${CT}/q/outdoor-marked.jpg`);
    expect(outdoor?.caption).toBe("From the invoice row");
    expect(photos[2].label).toBe("From site visit");
    expect(photos[3].label).toBe("From the customer's site");
    expect(groupLinkedPhotos(photos).map((g) => g.label)).toEqual([
      "From quote Q-2026-0063",
      "From site visit",
      "From the customer's site",
    ]);
  });

  it("drops a copied path and a photo already on this job's own lead", () => {
    const photos = unionLinkedPhotos([
      row({ id: "bad", storage_path: "../secret.jpg", source: "quote", ref: "Q-1" }),
      row({ id: "url", storage_path: "https://files.example/a.jpg", source: "quote", ref: "Q-1" }),
      row({ id: "own", storage_path: "co/lead/own.jpg", source: "site_visit", bucket: "job-photos", lead_id: "lead-job" }),
      row({ id: "other", storage_path: "co/lead/visit.jpg", source: "site_visit", bucket: "job-photos", lead_id: "lead-visit" }),
    ].filter((r) => !r.storage_path.includes("..") && !r.storage_path.includes("://")));
    expect(parseLinkedPhotoRows([
      { id: "bad", bucket: "quote-photos", storage_path: "../secret.jpg", display_path: "../secret.jpg", source: "quote" },
      { id: "url", bucket: "quote-photos", storage_path: "https://x/a.jpg", display_path: "https://x/a.jpg", source: "quote" },
      { id: "ok", bucket: "quote-photos", storage_path: "co/q/a.jpg", display_path: "co/q/a.jpg", source: "quote", ref: "Q-2026-0063" },
      { id: "nope", bucket: "public-bucket", storage_path: "co/q/a.jpg", display_path: "co/q/a.jpg", source: "quote" },
    ]).map((r) => r.id)).toEqual(["ok"]);
    const visible = visibleLinkedPhotos(photos, "lead-job");
    expect(visible.map((p) => p.id)).toEqual(["other"]);
  });

  it("parses a jsonb string and ignores junk", () => {
    expect(parseLinkedPhotoRows("not json")).toEqual([]);
    expect(parseLinkedPhotoRows({ id: "x" })).toEqual([]);
    const raw = JSON.stringify([{ id: "1", bucket: "job-photos", storage_path: "co/l/a.jpg", display_path: "co/l/a.jpg", source: "site_visit", caption: "Front" }]);
    expect(parseLinkedPhotoRows(raw)[0].caption).toBe("Front");
  });
});

describe("who may see a job's linked photos", () => {
  it("allows the assigned technician, the salesperson on that job, and office staff in the same company", () => {
    expect(mayReadLinkedPhotos(access({ techOnly: true, assignedToJob: true }))).toBe(true);
    expect(mayReadLinkedPhotos(access({ techOnly: true, assignedToJob: false }))).toBe(false);
    expect(mayReadLinkedPhotos(access({ salesRep: true, repBookedOrAssigned: true }))).toBe(true);
    expect(mayReadLinkedPhotos(access({ salesRep: true, repBookedOrAssigned: false }))).toBe(false);
    expect(mayReadLinkedPhotos(access({ office: true }))).toBe(true);
    expect(mayReadLinkedPhotos(access())).toBe(false);
  });

  it("refuses another company, a signed-out caller, and a technician who is not assigned even if they have an office flag", () => {
    expect(mayReadLinkedPhotos(access({ office: true, jobCompanyId: OT }))).toBe(false);
    expect(mayReadLinkedPhotos(access({ techOnly: true, assignedToJob: true, callerCompanyId: OT }))).toBe(false);
    expect(mayReadLinkedPhotos(access({ signedIn: false, office: true }))).toBe(false);
    expect(mayReadLinkedPhotos(access({ techOnly: true, assignedToJob: false, office: true }))).toBe(false);
    expect(mayReadLinkedPhotos(access({ callerCompanyId: null, office: true }))).toBe(false);
  });

  it("stays quiet when the reader is not installed yet, and the pages ask for the linked strip", () => {
    expect(linkedPhotosQuietError("function public.job_linked_photos(uuid) does not exist")).toBe(true);
    expect(linkedPhotosQuietError("Job not found")).toBe(true);
    expect(linkedPhotosQuietError("42501")).toBe(true);
    expect(linkedPhotosQuietError("network down")).toBe(false);
    const sql = readFileSync("supabase/migrations/20261118121500_job_linked_photos.sql", "utf8");
    expect(sql).not.toMatch(/INSERT INTO public\.(job_photos|quote_attachments|house_photos|site_survey)/i);
    expect(sql).not.toMatch(/UPDATE public\.(job_photos|quote_attachments|jobs|quotes) /i);
    expect(sql).toContain("FOR SELECT");
    expect(sql).not.toContain("FOR INSERT");
    expect(sql).not.toContain("FOR UPDATE");
    expect(sql).not.toContain("FOR DELETE");
    expect(sql).toContain("caller_company_id()");
    expect(sql).toContain("is_field_tech_only");
    expect(readFileSync("src/pages/FieldJobSheetPage.tsx", "utf8")).toContain("<JobLinkedPhotos jobId={id} jobLeadId={j.lead_id} />");
    expect(readFileSync("src/pages/admin/AdminJobDetailPage.tsx", "utf8")).toContain("<JobLinkedPhotos jobId={j.id} jobLeadId={j.lead_id} />");
    const hook = readFileSync("src/hooks/useJobLinkedPhotos.ts", "utf8");
    expect(hook).toContain('rpc as any)("job_linked_photos"');
    expect(hook).toContain("createSignedUrl");
    expect(hook).not.toContain(".upload(");
    expect(hook).not.toContain(".insert(");
    expect(hook).not.toContain("getPublicUrl");
  });
});
