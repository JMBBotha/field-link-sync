import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { extractEntryScript, isStaleEntry, checkForNewBuild, useBuildStatus, BUILD_ID, staleWriteRefusal, STALE_WRITE_MESSAGE, setUnsavedChanges, hasUnsavedChanges } from "@/lib/buildInfo";
import { parseKitSwapSizes, kitPipeSizes, kitSizeLabel, swappableKits, kitForUnitPipes, pipeFraction } from "@/lib/kitSizes";
import { parseInstallCommand, runInstallEdit } from "@/lib/mandy/installEdits";
import { kitRowFields, planStandardInstall } from "@/lib/mandy/quoteOps";
import { setActiveQuoteMarkupRates } from "@/lib/pricing";
import { TEMPLATES, LIVE } from "./standardInstall.test";

const html = (h: string) => `<!doctype html><html><head><script type="module" crossorigin src="/assets/index-${h}.js"></script></head></html>`;
const fakeFetch = (body: string) => (async () => ({ ok: true, text: async () => body, headers: { get: () => "text/html" }, json: async () => ({}) })) as any;

describe("stale build guard", () => {
  beforeEach(() => useBuildStatus.getState().setLatest(BUILD_ID));
  it("reads the entry script from index.html", () => {
    expect(extractEntryScript(html("AbC123"))).toBe("/assets/index-AbC123.js");
    expect(extractEntryScript('<script src="/assets/index-x.js" type="module"></script>')).toBe("/assets/index-x.js");
    expect(extractEntryScript("<html></html>")).toBeNull();
  });
  it("compares hashed entries; dev never counts", () => {
    expect(isStaleEntry("/assets/index-a.js", "/assets/index-b.js")).toBe(true);
    expect(isStaleEntry("/assets/index-a.js", "/assets/index-a.js")).toBe(false);
    expect(isStaleEntry("/src/main.tsx", "/src/main.tsx")).toBe(false);
    expect(isStaleEntry(null, "/assets/index-b.js")).toBe(false);
  });
  it("checkForNewBuild marks stale on a newer index.html and write tools refuse", async () => {
    expect(await checkForNewBuild(fakeFetch(html("same")), "/assets/index-same.js")).toBe(false);
    expect(await checkForNewBuild(fakeFetch(html("new")), "/assets/index-old.js")).toBe(true);
    expect(staleWriteRefusal("edit_install", useBuildStatus.getState().stale)).toBe(STALE_WRITE_MESSAGE);
    expect(STALE_WRITE_MESSAGE).toBe("I've been updated — please save and reload so I use the latest version.");
  });
  it("unsaved flag registry", () => {
    setUnsavedChanges("a", true); expect(hasUnsavedChanges()).toBe(true);
    setUnsavedChanges("a", false); expect(hasUnsavedChanges()).toBe(false);
  });
});

const cu = (code: string, name: string, ppm: number, len: number) => ({
  quantity: 1, length_metres: 1, is_length_item: true, is_optional: false,
  product: { id: code, product_code: code, short_name: name, product_category: "Consumables", category: "Consumables",
    cost_price: ppm * len, cost_excl_vat: ppm * len, price_per_metre: ppm, sold_in_length: true, unit_length: len, default_markup_percent: 100, supplier_name: "One Stop" },
});
const C = {
  q: cu("COPRL001", "Soft Drawn Copper 1/4 Inch 15.24 mtr", 52.55, 15.24), e: cu("COPRL002", "Soft Drawn Copper 3/8 Inch 15.24 mtr", 83.03, 15.24),
  h: cu("COPRL003", "Soft Drawn Copper 1/2 Inch 15.24 mtr", 111.3, 15.24), f: cu("COPRL004", "Soft Drawn Copper 5/8 Inch 15.24 mtr", 141.93, 15.24),
  i10: cu("IT010", "Arma Flex 3/8 x 1/4 (1.8mtr)", 8.59, 1.8), i11: cu("IT011", "Arma Flex 1/2 x 1/4 (1.8mtr)", 9.45, 1.8),
  i12: cu("IT012", "Arma Flex 5/8 x 1/4 (1.8mtr)", 10.99, 1.8), t: cu("TAPE006", "Lasso Tape 48mm x 30mtr", 2.14, 30),
};
const K38_12 = { id: "k3812", name: "24K INV 3/8&1/2 PIPING KIT COPPER LASSO ISO", min_btu: 22000, max_btu: 26000, items: [C.e, C.h, C.i10, C.i11, C.t] };
const K38_58 = { id: "6b62cd9f", name: "24K INV 3/8 & 5/8 PIPING KIT", min_btu: null, max_btu: null, items: [C.f, C.e, C.i10, C.i12, C.t] };
const K14_12 = { id: "k1412", name: "12K INV 1/4&1/2 PIPING KIT", min_btu: 11000, max_btu: 13000, items: [C.q, C.h, C.t] };
const KITS = [K38_12, K38_58, K14_12];
const liveIds = KITS.flatMap((k) => k.items.map((i) => ({ id: i.product.id })));

afterEach(() => setActiveQuoteMarkupRates(null));

describe("kit sizes + spoken swaps", () => {
  it("spoken fractions → sizes", () => {
    expect(parseKitSwapSizes("use the three eighths half kit")).toEqual(["3/8", "1/2"]);
    expect(parseKitSwapSizes("change the kit to 3/8 and 1/2")).toEqual(["3/8", "1/2"]);
    expect(parseKitSwapSizes("quarter and half kit")).toEqual(["1/4", "1/2"]);
    expect(parseKitSwapSizes("three eighths five eighths kit")).toEqual(["3/8", "5/8"]);
    expect(parseKitSwapSizes("make the piping 3 metres")).toBeNull();
    expect(parseKitSwapSizes("half the price")).toBeNull();
    expect(parseInstallCommand("use the three eighths half kit")).toEqual({ op: "kit_swap", sizes: ["3/8", "1/2"] });
    expect(parseInstallCommand("make the piping 4 metres")).toEqual({ op: "kit_length", metres: 4 });
  });
  it("labels from copper components; all-live filter; pipe preference", () => {
    expect(kitSizeLabel(K38_12)).toBe("3/8 + 1/2");
    expect(kitPipeSizes(K38_58)).toEqual(["3/8", "5/8"]);
    expect(swappableKits(KITS, liveIds).length).toBe(3);
    expect(swappableKits(KITS, liveIds.filter((p) => p.id !== "COPRL004")).map((k) => k.id)).not.toContain("6b62cd9f");
    expect(pipeFraction('3/8"')).toBe("3/8");
    expect(kitForUnitPipes(KITS, { pipe_liquid: "3/8", pipe_gas: "5/8" })?.id).toBe("6b62cd9f");
    expect(kitForUnitPipes(KITS, { pipe_liquid: null, pipe_gas: null })).toBeNull();
  });
  it("new 24K kit prices R429.02/m from the book", () => {
    setActiveQuoteMarkupRates({ units: 25, materials: 100 } as any);
    const r = kitRowFields(K38_12 as any, 3);
    expect(r.perMetre).toBeCloseTo(429.02, 2);
    expect(r.length).toBe(3);
    expect(r.fields.unit_price).toBeCloseTo(1287.06, 2);
  });
  it("template → piping kit; unit pipes override; no template is reported", () => {
    const t24 = TEMPLATES.map((t) => t.id === "t24" ? { ...t, items: t.items.map((i) => i.role === "piping_kit" ? { ...i, bundle_id: "k3812" } : i) } : t);
    const u = { product_category: "Air Conditioning", short_name: "Samsung 24K", btu_rating: 24000 } as any;
    expect(planStandardInstall(u, t24, KITS as any, LIVE).kitBundle?.id).toBe("k3812");
    expect(planStandardInstall({ ...u, pipe_liquid: "3/8", pipe_gas: "5/8" }, t24, KITS as any, LIVE).kitBundle?.id).toBe("6b62cd9f");
    const none = planStandardInstall({ ...u, btu_rating: 36000, short_name: "36K" }, t24, KITS as any, LIVE);
    expect(none.notes[0]).toMatch(/No standard install template for 36K/);
  });
  it("swap keeps metres + install tag, reprices; two units → chips", async () => {
    setActiveQuoteMarkupRates({ units: 25, materials: 100 } as any);
    const tag = (u: string) => ({ install: { unit_item_id: u, role: "piping_kit", template_id: "t24" } });
    const k1 = { id: "kit1", item_name: K38_58.name, length: 4, ...kitRowFields(K38_58 as any, 4).fields };
    (k1 as any).metadata = { ...k1.metadata, ...tag("u1") };
    let items: any[] = [{ id: "u1", item_name: "Samsung 24K", area_id: "a" }, k1];
    const patches: any[] = [];
    const deps = { items, areaName: () => "Test", liveProducts: liveIds, bundles: KITS as any,
      addItem: async (r: any) => r, deleteItem: async () => true,
      updateItem: async (id: string, p: any) => { patches.push({ id, p }); return true; } };
    const r = await runInstallEdit(deps, { op: "kit_swap", sizes: ["3/8", "1/2"] });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/3\/8 \+ 1\/2.*4 m, R\s?1\s?716,08/);
    expect(patches[0].p.length).toBe(4);
    expect(patches[0].p.metadata.install).toEqual(tag("u1").install);
    expect(patches[0].p.metadata.kit.bundle_id).toBe("k3812");
    items = [...items, { id: "u2", item_name: "Samsung 12K", area_id: "a" }, { ...k1, id: "kit2", metadata: { ...k1.metadata, ...tag("u2") } }];
    const c = await runInstallEdit({ ...deps, items }, { op: "kit_swap", sizes: ["3/8", "1/2"] });
    expect(c.choices?.length).toBe(2);
    const miss = await runInstallEdit({ ...deps, items: items.slice(0, 2) }, { op: "kit_swap", sizes: ["1/4", "5/8"] });
    expect(miss.ok).toBe(false);
  });
});
