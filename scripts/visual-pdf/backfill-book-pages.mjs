#!/usr/bin/env node
/**
 * Go-live only. Create the supplier_pdf_pages rows a Visual PDF book is missing.
 *
 * Sir Air already has product rows with page_number + row_bbox, but no
 * supplier_pdf_pages, so the page never opens and the PDF radio never draws.
 * The in-app path is capturePdfPages(), which always inserts a NEW pdf_uploads
 * book. This script reuses that storage layout
 * (supplier-pdf-pages/<supplier>/<file>/page-N.jpg) and stamps the EXISTING
 * pdf_upload_id. It does not create a book, and it does not touch prices,
 * markups, sell prices, or product rows.
 *
 * A SQL migration cannot render the page images or upload them, so this runs
 * once at go-live, after the data migration in this PR.
 *
 * Needs poppler-utils (pdftoppm). Writes need these environment variables,
 * never committed and never passed on the command line:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Dry run (no storage upload, no insert) — prints the book and pages already there:
 *   node scripts/visual-pdf/backfill-book-pages.mjs --upload <pdf_uploads.id>
 *
 * Apply — render, upload, insert the missing pages:
 *   node scripts/visual-pdf/backfill-book-pages.mjs --upload <pdf_uploads.id> --apply
 *
 * Sir Air books with row_bbox and zero supplier_pdf_pages (24 Nov 2026):
 *   15e13eb9-63c6-4ddf-846f-15a6674f6035  SirAir_Materials_2026-11-02.pdf
 *     supplier 3b18cab0-b3aa-47d0-9491-92213c64b221, 8 pages, 164 live rows
 *   4f4fecb7-07a6-48b7-b6fc-b81b1ae6f615  SirAir_Units_2026-11-02.pdf
 *     same supplier, 3 pages, 37 live rows
 * The public supplier-pdfs object at each file_path was missing (NoSuchKey).
 * Before --apply, put the PDF in supplier-pdfs at that file_path, or set
 * file_url on the book. Re-running skips pages that already exist.
 */
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const uploadFlag = args.indexOf("--upload");
const uploadId = uploadFlag >= 0 ? args[uploadFlag + 1] : "";

if (!uploadId || uploadId.startsWith("--")) {
  console.error("Pass --upload <pdf_uploads.id>. Add --apply to write. Default is a dry run.");
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const safeName = (name) => String(name || "book.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");

async function loadBook() {
  const { data, error } = await db
    .from("pdf_uploads")
    .select("id, supplier_id, file_name, file_url, file_path, storage_path, brand, is_active, page_count")
    .eq("id", uploadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`No pdf_uploads row ${uploadId}`);
  return data;
}

async function existingPages(bookId) {
  const { data, error } = await db.from("supplier_pdf_pages").select("page_number").eq("pdf_upload_id", bookId);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((r) => Number(r.page_number)));
}

async function downloadPdf(book) {
  const path = book.storage_path || book.file_path;
  if (path && !String(path).startsWith("http")) {
    for (const bucket of ["supplier-pdfs", "supplier-pdf-pages", "price-lists"]) {
      const { data, error } = await db.storage.from(bucket).download(path);
      if (!error && data) return new Uint8Array(await data.arrayBuffer());
    }
  }
  if (book.file_url) {
    const res = await fetch(book.file_url);
    if (!res.ok) throw new Error(`PDF download failed ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  throw new Error("Book has no file_url or storage path to download");
}

function renderPages(pdfBytes) {
  const probe = spawnSync("pdftoppm", ["-v"], { encoding: "utf8" });
  if (probe.error) throw new Error("pdftoppm is not installed. Install poppler-utils, then re-run.");
  const dir = mkdtempSync(join(tmpdir(), "fl-pdf-pages-"));
  const pdfPath = join(dir, "book.pdf");
  writeFileSync(pdfPath, pdfBytes);
  const out = spawnSync("pdftoppm", ["-jpeg", "-r", "144", pdfPath, join(dir, "page")], { encoding: "utf8" });
  if (out.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(out.stderr || "pdftoppm failed");
  }
  const files = readdirSync(dir)
    .filter((f) => /^page-\d+\.jpg$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  return { dir, files };
}

const book = await loadBook();
const have = await existingPages(book.id);
console.log(JSON.stringify({
  id: book.id,
  file_name: book.file_name,
  brand: book.brand,
  supplier_id: book.supplier_id,
  is_active: book.is_active,
  existing_pages: [...have].sort((a, b) => a - b),
  mode: apply ? "apply" : "dry-run",
}, null, 2));

if (!apply) {
  console.log("Dry run only. Re-run with --apply at go-live to render and insert the missing pages.");
  process.exit(0);
}

const pdfBytes = await downloadPdf(book);
const rendered = renderPages(pdfBytes);
try {
  const supplierId = book.supplier_id;
  const folder = `${supplierId}/${safeName(book.file_name)}`;
  let inserted = 0;
  for (const file of rendered.files) {
    const pageNumber = Number(file.match(/\d+/)[0]);
    if (have.has(pageNumber)) continue;
    const storagePath = `${folder}/page-${pageNumber}.jpg`;
    const up = await db.storage.from("supplier-pdf-pages").upload(storagePath, readFileSync(join(rendered.dir, file)), {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (up.error) throw new Error(`upload page ${pageNumber}: ${up.error.message}`);
    const { data: pub } = db.storage.from("supplier-pdf-pages").getPublicUrl(storagePath);
    const ins = await db.from("supplier_pdf_pages").insert({
      supplier_id: supplierId,
      pdf_upload_id: book.id,
      pdf_filename: book.file_name,
      page_number: pageNumber,
      page_image_url: pub.publicUrl,
      brand: book.brand || null,
    });
    if (ins.error) throw new Error(`insert page ${pageNumber}: ${ins.error.message}`);
    inserted += 1;
  }
  const pdfStoragePath = `${supplierId}/${safeName(book.file_name)}`;
  const pdfUp = await db.storage.from("supplier-pdf-pages").upload(pdfStoragePath, pdfBytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (pdfUp.error) throw new Error(`upload pdf: ${pdfUp.error.message}`);
  const { data: pdfPub } = db.storage.from("supplier-pdf-pages").getPublicUrl(pdfStoragePath);
  const upd = await db.from("supplier_pdf_pages").update({ pdf_storage_path: pdfPub.publicUrl }).eq("pdf_upload_id", book.id);
  if (upd.error) throw new Error(upd.error.message);
  console.log(`Inserted ${inserted} supplier_pdf_pages row(s) for ${book.file_name}. Prices were not changed.`);
} finally {
  rmSync(rendered.dir, { recursive: true, force: true });
}
