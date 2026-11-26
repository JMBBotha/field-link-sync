import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildTermsBlocks, installedUnitWarrantyLines, WARRANTY_EXCLUSIONS, WARRANTY_MOVING_PARTS } from "@/lib/defaultTerms";
import {
  MASSAIR_CT_LEGAL_NAME,
  UNSIGNED_CLIENT,
  addCalendarMonths,
  buildJobCard,
  companyForJobCard,
  companyHeaderLines,
  jobCardStoragePath,
  labourWarrantySentence,
  materialLines,
  pickJobCardProfile,
  selectJobCardPhotos,
  type JobCardCompany,
} from "@/lib/jobCard";
import { renderJobCardPdf } from "@/lib/jobCardPdf";
import { buildJobCardEmail, JOB_CARD_FROM_EMAIL, JOB_CARD_FROM_NAME } from "../../supabase/functions/_shared/jobCardEmail";

const COMPANY_ID = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const JOB_ID = "11111111-1111-4111-8111-111111111111";

function pdfLiteral(chunk: string): string {
  const parts: string[] = [];
  const re = /\((?:\\.|[^\\)])*\)/g;
  for (const match of chunk.matchAll(re)) {
    parts.push(match[0].slice(1, -1).replace(/\\([()\\])/g, "$1").replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8))));
  }
  return parts.join(" ").replace(/\s+/g, " ");
}

function pdfStrings(bytes: Uint8Array): string {
  return pdfLiteral(Buffer.from(bytes).toString("latin1"));
}

function pdfPageCount(bytes: Uint8Array): number {
  const raw = Buffer.from(bytes).toString("latin1");
  const count = raw.match(/\/Type\s*\/Pages\b[\s\S]{0,120}?\/Count\s+(\d+)/);
  return count ? Number(count[1]) : 0;
}

function pdfPageTexts(bytes: Uint8Array): string[] {
  const raw = Buffer.from(bytes).toString("latin1");
  return [...raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)]
    .map((m) => pdfLiteral(m[1]))
    .filter((text) => /[A-Za-z]{3}/.test(text));
}

function png(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): string {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 3 + 1);
    raw[o] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      raw[o + 1 + x * 3] = r;
      raw[o + 2 + x * 3] = g;
      raw[o + 3 + x * 3] = b;
    }
  }
  const compressed = deflateSync(raw);
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    Buffer.from(data).copy(out, 8);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)) >>> 0, 0);
    crc.copy(out, 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const file = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${file.toString("base64")}`;
}

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c;
}

const ctProfile = {
  legal_name: "Massair CT (Pty) Ltd t/a 0800-BE-COOL",
  trading_name: "t/a 0800-BE-COOL",
  vat_number: "4630313080",
  phone: "(021) 802-2889",
  email: "info@0800becool.co.za",
  website: "www.0800becool.co.za",
  address_lines: ["9A Cabernet Rd, Blackheath Ind", "Cape Town", "7580"],
  is_default: false,
  company_id: COMPANY_ID,
};

function sampleCard(signed: boolean) {
  const picked = pickJobCardProfile([
    { legal_name: "Massair Ind CC", is_default: true, vat_number: "9999999999", company_id: COMPANY_ID },
    ctProfile,
  ]);
  const company = companyForJobCard(picked, COMPANY_ID);
  return buildJobCard({
    company,
    clientName: "Example Homes (Pty) Ltd",
    clientVat: "4987654321",
    siteAddress: "14 Oak Close, Durbanville, 7550",
    jobTitle: "Lounge split installation",
    jobType: "installation",
    jobDates: ["2026-11-24", "2026-11-26T09:00:00+02:00"],
    completedAt: "2026-11-26T11:10:00+02:00",
    workDone: "Installed one midwall split in the lounge. Tested cooling and heating. Site left clean.",
    units: [
      { label: "Lounge", position: "indoor", brand: "Samsung", model: "AR12TXHQASINEU", serial: "IN-EX-1001" },
      { label: "Lounge", position: "outdoor", brand: "Samsung", model: "AR12TXHQASIXEU", serial: "OUT-EX-1001" },
    ],
    photos: [
      { label: "Before", caption: "Lounge wall", dataUrl: png(80, 48, (x, y) => [40 + x, 90, 80 + y]) },
      { label: "After", caption: "Unit in place", dataUrl: png(80, 48, (x, y) => [61, 155 - Math.floor(y / 2), 232]) },
    ],
    materials: [
      { name: "3/8 copper pipe", qty: 6, unit: "m" },
      { item: "16 mm trunking", qty: 4, unit: "m" },
      { name: "Wall bracket", qty: 1 },
      { name: "3/8 copper pipe", qty: 1, unit: "m", unit_price: 999 } as { name: string; qty: number; unit: string },
    ],
    times: [
      { start: "2026-11-24T08:00:00+02:00", end: "2026-11-24T12:30:00+02:00", minutes: 270 },
      { start: "2026-11-26T07:40:00+02:00", end: "2026-11-26T11:10:00+02:00", minutes: 210 },
    ],
    technicianName: "Alex Naidoo",
    signatureDataUrl: signed ? png(90, 30, (x, y) => (Math.abs(y - 15 - Math.sin(x / 6) * 6) < 2 ? [15, 27, 42] : [255, 255, 255])) : null,
    signerName: signed ? "Example Client" : "Example Homes (Pty) Ltd",
  });
}

describe("job / warranty card", () => {
  it("uses the Massair CT record, the logo name only, and never Ind CC or a trading-as line", () => {
    const card = sampleCard(true);
    expect(card.company.legalName).toBe(MASSAIR_CT_LEGAL_NAME);
    expect(card.company.legalName).toBe("Massair CT (Pty) Ltd");
    const blob = JSON.stringify(card.companyLines);
    expect(blob).not.toMatch(/t\/a/i);
    expect(blob).not.toMatch(/massair ind/i);
    expect(blob).not.toContain("0800-BE-COOL");
    expect(card.company.vatNo).toBe("4630313080");
    expect(companyHeaderLines(card.company).join("\n")).toContain("(021) 802-2889");
  });

  it("prints the client VAT only when the client has one, and keeps materials to names and quantities", () => {
    const card = sampleCard(false);
    expect(card.clientVat).toBe("4987654321");
    const noVat = buildJobCard({ ...sampleDraft(card.company), clientVat: "  " });
    expect(noVat.clientVat).toBeNull();
    expect(materialLines([{ name: "Trunking", qty: 2, unit: "m" }, { name: "Hidden price", qty: 1 }])).toEqual([
      { name: "Trunking", qty: 2, unit: "m" },
      { name: "Hidden price", qty: 1, unit: null },
    ]);
    expect(card.materials.map((m) => `${m.name} ${m.qtyLabel}`)).toEqual([
      "3/8 copper pipe 7 m",
      "16 mm trunking 4 m",
      "Wall bracket 1",
    ]);
    expect(JSON.stringify(card.materials)).not.toMatch(/999|price|cost/i);
  });

  it("reuses the quote warranty wording and counts 12 months of labour from the completed date", () => {
    const card = sampleCard(true);
    const terms = buildTermsBlocks({ companyName: MASSAIR_CT_LEGAL_NAME }).filter((b) => /^5\.\d /.test(b.text)).map((b) => b.text.replace(/^5\.\d /, ""));
    expect(installedUnitWarrantyLines(MASSAIR_CT_LEGAL_NAME)).toEqual(terms);
    expect(card.warrantyLines.slice(0, 3)).toEqual(terms);
    expect(card.warrantyLines[0]).toBe(WARRANTY_MOVING_PARTS);
    expect(card.warrantyLines).toContain(WARRANTY_EXCLUSIONS);
    expect(card.labourWarranty).toBe(labourWarrantySentence("2026-11-26T11:10:00+02:00"));
    expect(card.labourWarranty).toContain("12 months");
    expect(card.labourWarranty).toContain("26 Nov 2026");
    expect(card.labourWarranty).toContain("26 Nov 2027");
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("puts show-to-client photos on the card, otherwise the after photos, and the choice is configurable", () => {
    const photos = [
      { id: "a", client_visible: false, photo_type: "before" },
      { id: "b", client_visible: false, photo_type: "after" },
      { id: "c", client_visible: true, photo_type: "site" },
    ];
    expect(selectJobCardPhotos(photos).map((p) => p.id)).toEqual(["c"]);
    expect(selectJobCardPhotos(photos, "client_visible_only").map((p) => p.id)).toEqual(["c"]);
    expect(selectJobCardPhotos(photos.filter((p) => !p.client_visible)).map((p) => p.id)).toEqual(["b"]);
    expect(selectJobCardPhotos(photos.filter((p) => !p.client_visible), "client_visible_only")).toEqual([]);
  });

  it("allows an unsigned card and keeps the technician to a name and tick", () => {
    const unsigned = sampleCard(false);
    expect(unsigned.signed).toBe(false);
    expect(unsigned.unsignedLabel).toBe(UNSIGNED_CLIENT);
    expect(unsigned.signatureDataUrl).toBeNull();
    expect(unsigned.techSignOff).toBe("Alex Naidoo (name and tick)");
    const signed = sampleCard(true);
    expect(signed.signed).toBe(true);
    expect(signed.signatureName).toBe("Example Client");
    expect(signed.signatureDate).toBe("26 Nov 2026");
  });

  it("stores the PDF at {company}/{job}/job-card.pdf", () => {
    expect(jobCardStoragePath(COMPANY_ID, JOB_ID)).toBe(`${COMPANY_ID}/${JOB_ID}/job-card.pdf`);
  });

  it("renders a PDF with the V8 bar colour, the warranty wording, and no prices", () => {
    const card = sampleCard(true);
    const logo = `data:image/png;base64,${readFileSync("src/assets/brand/logo-light.png").toString("base64")}`;
    const bytes = renderJobCardPdf(card, logo);
    const text = pdfStrings(bytes);
    expect(text).toContain("JOB / WARRANTY CARD");
    expect(text).toContain("Massair CT (Pty) Ltd");
    expect(text).toContain("Example Homes (Pty) Ltd");
    expect(text).toContain("VAT 4987654321");
    expect(text).toContain("14 Oak Close, Durbanville, 7550");
    expect(text).toContain("Samsung");
    expect(text).toContain("IN-EX-1001");
    expect(text).toContain("Indoor");
    expect(text).toContain("Outdoor");
    expect(text).toContain("3/8 copper pipe");
    expect(text).toContain("Names and quantities only");
    expect(text).toContain(WARRANTY_MOVING_PARTS);
    expect(text).toContain("12 months");
    expect(text).toContain("Alex Naidoo (name and tick)");
    expect(text).toContain("Example Client");
    expect(text).toContain("photos are kept as the record of this job");
    expect(text.toLowerCase()).not.toContain("t/a");
    expect(text.toLowerCase()).not.toContain("massair ind");
    expect(text.toLowerCase()).not.toContain("pressure");
    expect(text).not.toMatch(/\bR\s?\d/);
    expect(text).not.toContain("999");
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("fits a typical card on one page and keeps the signature with the consent line", () => {
    const typicalBytes = renderJobCardPdf(sampleCard(true));
    expect(pdfPageCount(typicalBytes)).toBe(1);
    expect(pdfPageCount(renderJobCardPdf(sampleCard(false)))).toBe(1);
    const typical = pdfPageTexts(typicalBytes).join(" ");
    expect(typical).toContain("CLIENT SIGNATURE");
    expect(typical).toContain("photos are kept as the record of this job");
    expect(typical).toContain("Example Client");

    const manyPhotos = buildJobCard({
      ...sampleCard(true),
      photos: Array.from({ length: 8 }, (_, i) => ({ label: i % 2 ? "After" : "Before", caption: `Shot ${i + 1}`, dataUrl: null })),
    });
    const photoBytes = renderJobCardPdf(manyPhotos);
    const photoPages = pdfPageTexts(photoBytes);
    expect(pdfPageCount(photoBytes)).toBeGreaterThan(1);
    expect(photoPages.some((p) => p.includes("CLIENT SIGNATURE"))).toBe(true);

    const manyUnits = buildJobCard({
      ...sampleCard(false),
      units: Array.from({ length: 40 }, (_, i) => ({ label: "Room", position: i % 2 ? "outdoor" : "indoor", brand: "Samsung", model: `M${i}`, serial: `SN-${i}` })),
      photos: [],
    });
    const unitBytes = renderJobCardPdf(manyUnits);
    const unitPages = pdfPageTexts(unitBytes);
    expect(pdfPageCount(unitBytes)).toBeGreaterThan(1);
    for (const page of unitPages) {
      const hasSign = page.includes("CLIENT SIGNATURE");
      const hasConsent = page.includes("photos are kept as the record of this job");
      expect(hasSign).toBe(hasConsent);
    }
  });

  it("marks an unsigned PDF as not signed by the client", () => {
    const text = pdfStrings(renderJobCardPdf(sampleCard(false)));
    expect(text).toContain(UNSIGNED_CLIENT);
    expect(text).not.toContain("Example Client");
  });

  it("writes a fake-data sample PDF for review when the artifacts folder exists", () => {
    const dir = "/opt/cursor/artifacts";
    if (!existsSync(dir)) return;
    mkdirSync(dir, { recursive: true });
    const logo = `data:image/png;base64,${readFileSync("src/assets/brand/logo-light.png").toString("base64")}`;
    const bytes = renderJobCardPdf(sampleCard(true), logo);
    const pdfPath = `${dir}/job-warranty-card-sample.pdf`;
    writeFileSync(pdfPath, bytes);
    const pngBase = `${dir}/job-warranty-card-sample`;
    spawnSync("pdftoppm", ["-png", "-r", "130", pdfPath, pngBase], { encoding: "utf8" });
    expect(existsSync(pdfPath)).toBe(true);
  });
});

function sampleDraft(company: JobCardCompany) {
  return {
    company,
    clientName: "Example Homes (Pty) Ltd",
    completedAt: "2026-11-26T11:10:00+02:00",
    workDone: "Done as quoted",
    technicianName: "Alex Naidoo",
  };
}

describe("job card email stays off unless the company switch is on", () => {
  const base = {
    to: "client@example-homes.test",
    clientName: "Example Homes (Pty) Ltd",
    jobTitle: "Lounge split installation",
    completedLabel: "26 Nov 2026",
    signed: true,
    pdfBase64: "JVBERi0=",
  };

  it("does not build a send when auto-send is off, missing, or not exactly true", () => {
    expect(buildJobCardEmail({ ...base, autoSend: false }).send).toBe(false);
    expect(buildJobCardEmail({ ...base, autoSend: false })).toEqual({ send: false, reason: "auto_send_off" });
    for (const autoSend of [false, undefined, null, 0, "true"] as boolean[]) {
      expect(buildJobCardEmail({ ...base, autoSend: autoSend as boolean }).send).toBe(false);
    }
  });

  it("sends from johan@0800becool.co.za with the PDF and no prices when the switch is on", () => {
    const email = buildJobCardEmail({ ...base, autoSend: true });
    expect(email.send).toBe(true);
    if (!email.send) return;
    expect(email.fromEmail).toBe("johan@0800becool.co.za");
    expect(email.fromEmail).toBe(JOB_CARD_FROM_EMAIL);
    expect(email.fromName).toBe(JOB_CARD_FROM_NAME);
    expect(email.fromName).toBe("Massair CT (Pty) Ltd");
    expect(email.filename).toBe("Job-warranty-card.pdf");
    expect(email.html.toLowerCase()).not.toContain("t/a");
    expect(email.html).not.toMatch(/\bR\s?\d/);
    expect(email.html).not.toContain("unit price");
    expect(email.subject).toContain("Example Homes");
  });

  it("refuses a send with no address or no PDF even when the switch is on", () => {
    expect(buildJobCardEmail({ ...base, autoSend: true, to: "" })).toEqual({ send: false, reason: "no_recipient" });
    expect(buildJobCardEmail({ ...base, autoSend: true, pdfBase64: null })).toEqual({ send: false, reason: "no_pdf" });
  });

  it("checks the company switch before it calls the transactional email function", () => {
    const src = readFileSync("supabase/functions/send-job-card/index.ts", "utf8");
    const gate = src.indexOf('reason: "auto_send_off"');
    const post = src.indexOf("/functions/v1/send-transactional-email");
    expect(gate).toBeGreaterThan(0);
    expect(post).toBeGreaterThan(gate);
    expect(src).toContain("buildJobCardEmail");
    expect(src).toContain('from_email: decision.fromEmail');
    expect(src).not.toContain("src/lib");
    const sql = readFileSync("supabase/migrations/20261126120000_job_warranty_card.sql", "utf8");
    expect(sql).toContain("auto_send_job_card boolean NOT NULL DEFAULT false");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("job_card_storage_ok");
    expect(sql).not.toContain("GRANT SELECT, INSERT, UPDATE ON public.job_cards TO anon");
    const rollback = readFileSync("supabase/manual/20261126120000_job_warranty_card_rollback.sql", "utf8");
    expect(rollback).toContain("DROP TABLE IF EXISTS public.job_cards");
    expect(rollback).toContain("DROP COLUMN IF EXISTS auto_send_job_card");
    expect(readFileSync("supabase/migrations/20261126120000_job_warranty_card.sql", "utf8")).not.toContain("MANUAL ROLLBACK");
  });
});
