import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Johan 15 Oct: "give me a easy button option" — the quote screen itself must carry the
 * Light / Bold switch. These tests pin the button's behaviour: it shows the company's current
 * look, writes the same company_profiles column the settings dropdown writes, refreshes the
 * documents on screen, refuses a non-admin, and never claims success when the write fails.
 */
const mocks = vi.hoisted(() => {
  const state = { patch: null as any, eqArgs: null as any, fail: false };
  return {
    state,
    toast: vi.fn(),
    clear: vi.fn(),
    update: vi.fn((p: any) => {
      state.patch = p;
      return {
        eq: (c: any, v: any) => {
          state.eqArgs = [c, v];
          return Promise.resolve({ error: state.fail ? { message: "permission denied for table company_profiles" } : null });
        },
      };
    }),
  };
});

const state = vi.hoisted(() => ({ profile: { id: "cp-1", document_style: "bold" } as any, isAdmin: true }));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/hooks/useRole", () => ({ useRole: () => ({ isAdmin: state.isAdmin }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ update: mocks.update }) } }));
vi.mock("@/hooks/useDocumentCompanyProfile", () => ({
  useDocumentCompanyProfile: () => state.profile,
  clearDocumentCompanyProfileCache: () => mocks.clear(),
}));

import DocumentStyleSwitch from "@/components/quoting/DocumentStyleSwitch";

beforeEach(() => {
  vi.clearAllMocks();
  state.profile = { id: "cp-1", document_style: "bold" };
  state.isAdmin = true;
  mocks.state.patch = null;
  mocks.state.eqArgs = null;
  mocks.state.fail = false;
});

describe("DocumentStyleSwitch", () => {
  it("marks the company's current look as selected", () => {
    render(<DocumentStyleSwitch companyId="co-1" />);
    expect(screen.getByTestId("document-style-bold")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("document-style-light")).toHaveAttribute("aria-pressed", "false");
  });

  it("tapping the other look writes it and refreshes the documents on screen", async () => {
    render(<DocumentStyleSwitch companyId="co-1" />);
    fireEvent.click(screen.getByTestId("document-style-light"));
    await waitFor(() => expect(mocks.state.patch?.document_style).toBe("light"));
    expect(mocks.state.eqArgs).toEqual(["id", "cp-1"]);
    expect(mocks.clear).toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Light is now your quote look" }));
  });

  it("tapping the look already in use writes nothing", () => {
    render(<DocumentStyleSwitch companyId="co-1" />);
    fireEvent.click(screen.getByTestId("document-style-bold"));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("sales reps and technicians never see the switch", () => {
    state.isAdmin = false;
    render(<DocumentStyleSwitch companyId="co-1" />);
    expect(screen.queryByTestId("document-style-switch")).toBeNull();
  });

  it("a failed write keeps the current look and says so", async () => {
    mocks.state.fail = true;
    render(<DocumentStyleSwitch companyId="co-1" />);
    fireEvent.click(screen.getByTestId("document-style-light"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't change the quote look", variant: "destructive" }));
  });

  it("shows nothing until the company record has loaded", () => {
    state.profile = null;
    render(<DocumentStyleSwitch companyId="co-1" />);
    expect(screen.queryByTestId("document-style-switch")).toBeNull();
  });
});
