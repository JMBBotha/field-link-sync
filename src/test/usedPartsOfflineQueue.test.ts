import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import "./mocks/supabase";
import { offlineDb } from "@/lib/offlineDb";

// Q1 (2026-10-09): offline-added job parts used to be queued as "create_invoice" and the sync
// handler inserted them into `invoices` (lost part; techs may not create invoices).
const src = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

describe("offline used parts queue", () => {
  beforeEach(async () => {
    await offlineDb.clearEverything();
  });

  it("UsedPartsSection queues create_used_part, never create_invoice", () => {
    const s = src("components/UsedPartsSection.tsx");
    expect(s).toContain('queueOperation("create_used_part", "job_used_parts"');
    expect(s).not.toMatch(/queueOperation\("create_invoice"/);
  });

  it("sync handler writes create_used_part to job_used_parts", () => {
    const s = src("hooks/useSyncQueue.ts");
    const block = s.slice(s.indexOf("case 'create_used_part'"), s.indexOf("case 'update_invoice'"));
    expect(block).toContain(".from('job_used_parts'");
    expect(block).not.toContain(".from('invoices')");
  });

  it("counts pending used parts separately from invoices", async () => {
    await offlineDb.queueOperation({
      operationType: "create_used_part",
      tableName: "job_used_parts",
      recordId: "tmp-1",
      data: { lead_id: "lead-1", product_code: "X1", quantity: 2 },
      timestamp: Date.now(),
    });
    const byType = await offlineDb.getPendingOperationsByType();
    expect(byType.create_used_part).toBe(1);
    expect(byType.create_invoice).toBe(0);
  });
});
