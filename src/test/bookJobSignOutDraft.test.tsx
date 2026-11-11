import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MASSAIR_CT_ID } from "@/lib/adminHomeCount";
import { BOOK_JOB_DRAFT_VERSION, bookJobDraftKey, freshBookJobBody, writeBookJobDraft } from "@/lib/bookJobDraft";

const JOHAN = "1e795a9b-f8bd-4af5-8f28-5e0426101daa";
const SALES = "420c7731";
const authEvents = vi.hoisted(() => ({
  fn: null as null | ((event: string, session: { user?: { id: string } } | null) => void),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: (cb: (event: string, session: { user?: { id: string } } | null) => void) => {
        authEvents.fn = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
  },
}));
vi.mock("@/lib/invitePassword", () => ({ redirectIfPasswordMissing: async () => {} }));

import { AuthProvider } from "@/contexts/AuthContext";

describe("Book a job drafts follow sign-out and refresh", () => {
  it("drops every draft on sign-out, other people's drafts on refresh, and nothing on a blank initial session", async () => {
    sessionStorage.clear();
    const body = freshBookJobBody();
    body.title = "keep";
    const write = (userId: string) => writeBookJobDraft(sessionStorage, {
      version: BOOK_JOB_DRAFT_VERSION, userId, companyId: MASSAIR_CT_ID, context: "jobs", open: true, body,
    });
    write(JOHAN);
    write(SALES);
    render(<AuthProvider><div>app</div></AuthProvider>);
    await waitFor(() => expect(authEvents.fn).toBeTruthy());

    authEvents.fn?.("INITIAL_SESSION", null);
    expect(sessionStorage.getItem(bookJobDraftKey(JOHAN, MASSAIR_CT_ID, "jobs"))).toBeTruthy();

    authEvents.fn?.("TOKEN_REFRESHED", { user: { id: JOHAN } });
    expect(sessionStorage.getItem(bookJobDraftKey(JOHAN, MASSAIR_CT_ID, "jobs"))).toBeTruthy();
    expect(sessionStorage.getItem(bookJobDraftKey(SALES, MASSAIR_CT_ID, "jobs"))).toBeNull();

    write(SALES);
    authEvents.fn?.("SIGNED_OUT", null);
    expect(sessionStorage.getItem(bookJobDraftKey(JOHAN, MASSAIR_CT_ID, "jobs"))).toBeNull();
    expect(sessionStorage.getItem(bookJobDraftKey(SALES, MASSAIR_CT_ID, "jobs"))).toBeNull();
  });
});
