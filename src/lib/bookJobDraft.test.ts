import { describe, expect, it } from "vitest";
import {
  BOOK_JOB_DRAFT_VERSION, bookJobDraftKey, clearAllBookJobDrafts, clearBookJobDraft, clearOtherUsersBookJobDrafts,
  draftMatchesEntry, freshBookJobBody, readBookJobDraft, writeBookJobDraft, type BookJobDraftRecord, type DraftStorage,
} from "@/lib/bookJobDraft";
import { MASSAIR_CT_ID, MASSAIR_IND_ID } from "@/lib/adminHomeCount";

const JOHAN = "1e795a9b-f8bd-4af5-8f28-5e0426101daa";
const SALES = "420c7731-sales";

function memory(): DraftStorage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
}

function record(over: Partial<BookJobDraftRecord> = {}): BookJobDraftRecord {
  const body = freshBookJobBody();
  body.doing = "past";
  body.visitKinds = ["first_fix"];
  body.past = { ...body.past, techId: "09a7f5af-2752-4835-8738-54f7b53083ea", date: "2026-11-11" };
  body.title = "First fix";
  return {
    version: BOOK_JOB_DRAFT_VERSION,
    userId: JOHAN,
    companyId: MASSAIR_CT_ID,
    context: "jobs",
    open: true,
    body,
    ...over,
  };
}

describe("book a job draft storage", () => {
  it("round-trips a versioned draft for one user, company, and page", () => {
    const store = memory();
    const saved = record();
    expect(writeBookJobDraft(store, saved)).toBe(true);
    expect(readBookJobDraft(store, JOHAN, MASSAIR_CT_ID, "jobs")?.body.past.techId).toBe(saved.body.past.techId);
    expect(readBookJobDraft(store, JOHAN, MASSAIR_CT_ID, "jobs")?.body.doing).toBe("past");
  });

  it("refuses another user, another company, another page, and an old version", () => {
    const store = memory();
    writeBookJobDraft(store, record());
    expect(readBookJobDraft(store, SALES, MASSAIR_CT_ID, "jobs")).toBeNull();
    expect(readBookJobDraft(store, JOHAN, MASSAIR_IND_ID, "jobs")).toBeNull();
    expect(readBookJobDraft(store, JOHAN, MASSAIR_CT_ID, "home")).toBeNull();
    store.setItem(bookJobDraftKey(JOHAN, MASSAIR_CT_ID, "jobs"), JSON.stringify({ ...record(), version: 0 }));
    expect(readBookJobDraft(store, JOHAN, MASSAIR_CT_ID, "jobs")).toBeNull();
  });

  it("ignores a broken payload and a storage that throws", () => {
    const store = memory();
    store.setItem(bookJobDraftKey(JOHAN, MASSAIR_CT_ID, "jobs"), "{");
    expect(readBookJobDraft(store, JOHAN, MASSAIR_CT_ID, "jobs")).toBeNull();
    const broken: DraftStorage = {
      length: 0,
      key: () => null,
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    expect(readBookJobDraft(broken, JOHAN, MASSAIR_CT_ID, "jobs")).toBeNull();
    expect(writeBookJobDraft(broken, record())).toBe(false);
    expect(() => clearBookJobDraft(broken, JOHAN, MASSAIR_CT_ID, "jobs")).not.toThrow();
    expect(readBookJobDraft(null, JOHAN, MASSAIR_CT_ID, "jobs")).toBeNull();
  });

  it("clears one draft on discard, every draft on sign-out, and other people on an account switch", () => {
    const store = memory();
    writeBookJobDraft(store, record());
    writeBookJobDraft(store, record({ userId: SALES, context: "jobs" }));
    clearBookJobDraft(store, JOHAN, MASSAIR_CT_ID, "jobs");
    expect(readBookJobDraft(store, JOHAN, MASSAIR_CT_ID, "jobs")).toBeNull();
    expect(readBookJobDraft(store, SALES, MASSAIR_CT_ID, "jobs")?.userId).toBe(SALES);
    clearOtherUsersBookJobDrafts(JOHAN, store);
    expect(readBookJobDraft(store, SALES, MASSAIR_CT_ID, "jobs")).toBeNull();
    writeBookJobDraft(store, record());
    writeBookJobDraft(store, record({ context: "home" }));
    clearAllBookJobDrafts(store);
    expect(readBookJobDraft(store, JOHAN, MASSAIR_CT_ID, "jobs")).toBeNull();
    expect(readBookJobDraft(store, JOHAN, MASSAIR_CT_ID, "home")).toBeNull();
  });

  it("only restores a lead-specific draft for that same lead", () => {
    const body = record().body;
    expect(draftMatchesEntry(body, {})).toBe(true);
    body.leadId = "lead-1";
    body.customerId = "cust-1";
    expect(draftMatchesEntry(body, { leadId: "lead-1", customerId: "cust-1" })).toBe(true);
    expect(draftMatchesEntry(body, { leadId: "lead-2", customerId: "cust-1" })).toBe(false);
  });
});
