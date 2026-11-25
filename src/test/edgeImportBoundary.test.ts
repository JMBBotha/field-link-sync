import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeModelCode as appNormalize, primaryModelCode as appPrimary } from "@/lib/modelCode";
import { isAcUnitLine as appIsAcUnit } from "@/lib/lineDisplay";
import { linesMissingUnitImages as appMissing, missingUnitImageMessage as appMessage } from "@/lib/quoteUnitImages";
import { normalizeModelCode as edgeNormalize, primaryModelCode as edgePrimary } from "../../supabase/functions/_shared/modelCode";
import { isAcUnitLine as edgeIsAcUnit } from "../../supabase/functions/_shared/acUnitLine";
import { linesMissingUnitImages as edgeMissing, missingUnitImageMessage as edgeMessage } from "../../supabase/functions/_shared/quoteUnitImages";

const FUNCTIONS_ROOT = resolve("supabase/functions");
const REMOTE = /^(https?:|npm:|jsr:|node:|deno:|data:|bun:)/;

/** Import specifiers. A quoted "from" inside a prompt is not an import. */
function importSpecifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const specs: string[] = [];
  let pending = false;
  for (const raw of code.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    if (/^(import|export)\b/.test(line)) pending = true;
    if (!pending) continue;
    const side = line.match(/^import\s+["']([^"']+)["']/);
    const from = line.match(/\bfrom\s+["']([^"']+)["']/);
    if (side) specs.push(side[1]);
    if (from) specs.push(from[1]);
    if (side || from || line.endsWith(";")) pending = false;
  }
  return specs;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx|js|mjs|jsx)$/.test(name)) out.push(path);
  }
  return out;
}

function leavesFunctions(file: string, spec: string): boolean {
  if (REMOTE.test(spec)) return false;
  if (!spec.startsWith(".")) return true;
  const target = resolve(dirname(file), spec.split("?")[0]);
  const rel = relative(FUNCTIONS_ROOT, target);
  return rel.startsWith("..") || rel.startsWith("/");
}

describe("edge functions stay inside supabase/functions", () => {
  it("treats a src/lib import as outside the function bundle", () => {
    const file = join(FUNCTIONS_ROOT, "find-product-image/index.ts");
    expect(importSpecifiers('import { primaryModelCode } from "../../../src/lib/modelCode.ts";\n')).toEqual(["../../../src/lib/modelCode.ts"]);
    expect(leavesFunctions(file, "../../../src/lib/modelCode.ts")).toBe(true);
    expect(leavesFunctions(file, "../_shared/modelCode.ts")).toBe(false);
    expect(leavesFunctions(file, "https://deno.land/std@0.168.0/http/server.ts")).toBe(false);
  });

  it("no file under supabase/functions imports from outside that folder", () => {
    const escapes: string[] = [];
    for (const file of walk(FUNCTIONS_ROOT)) {
      for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
        if (leavesFunctions(file, spec)) escapes.push(`${relative(FUNCTIONS_ROOT, file)} -> ${spec}`);
      }
    }
    expect(escapes).toEqual([]);
    const findImage = importSpecifiers(readFileSync(join(FUNCTIONS_ROOT, "find-product-image/index.ts"), "utf8"));
    expect(findImage).toContain("../_shared/modelCode.ts");
    expect(findImage).toContain("../_shared/productImageSearch.ts");
    const sendEmail = importSpecifiers(readFileSync(join(FUNCTIONS_ROOT, "send-quote-email/index.ts"), "utf8"));
    expect(sendEmail).toContain("../_shared/quoteUnitImages.ts");
    expect([...findImage, ...sendEmail].some((spec) => spec.includes("src/lib"))).toBe(false);
  });
});

describe("edge and app copies of primaryModelCode agree", () => {
  const samples = [
    undefined,
    null,
    "",
    "   ",
    " ar70f12c1fw/fa ",
    "FFA60A9 (X2)-DUP2",
    "FFA25A9 (X2) + FFA60A9-DUP3",
    "R32-MICAS-48 (1PH) + CST-R32-MICOND-48-Q + BZE-T-MBQ4-04",
    "MCI-36-FS(3PH)",
    "R32-MIDCT-48(1PH) + CST-R32-MICOND-48-Q",
    "[AR70F12C1FW/FA]",
    "R32-MIUCL-36-Q (1PH)",
    "R32-MIUCL-48 (3Ph)",
    "R32-MICAS-36 (3PH)",
    "(R32-MICAS-48)",
  ];

  it("primaryModelCode and normalizeModelCode return the same value", () => {
    for (const sample of samples) {
      expect(edgePrimary(sample)).toBe(appPrimary(sample));
      expect(edgeNormalize(sample)).toBe(appNormalize(sample));
    }
  });

  it("the send guard still treats the same lines as units", () => {
    const lines = [
      { id: "u", item_name: "Midea 48K INV Under Ceiling", item_type: "product", product_id: "p1", metadata: {} },
      { id: "lab", item_name: "Labour: 2 hours", item_type: "labour", metadata: { labour: true }, product_id: null },
      { id: "kit", item_name: "Piping kit 1/4 + 3/8", item_type: "installation kit", is_bundle: true, metadata: { kit: { name: "Piping kit" } }, product_id: "p2" },
      { id: "remote", item_name: "Wireless remote controller BRC4C65", item_type: "product", product_id: "p3", metadata: {} },
    ];
    const products = [
      { id: "p1", image_url: null, category: "Air Conditioners", btu_rating: 48000 },
      { id: "p2", image_url: null, category: "Installation materials" },
      { id: "p3", image_url: null, category: "Controls" },
    ];
    expect(edgeMissing(lines, products)).toEqual(appMissing(lines, products));
    expect(edgeMessage(["Midea 48K"])).toBe(appMessage(["Midea 48K"]));
    for (const line of lines) {
      const product = products.find((row) => row.id === line.product_id) ?? null;
      expect(edgeIsAcUnit(line, product)).toBe(appIsAcUnit(line, product));
    }
  });
});
