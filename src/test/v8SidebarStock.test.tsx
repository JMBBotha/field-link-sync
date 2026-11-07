import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  isAdmin: true,
  isDispatcher: false,
  isFieldAgent: false,
  isSalesRep: false,
  isMain: true,
  isPlatformOwner: true,
}));

vi.mock("@/hooks/useRole", () => ({
  useRole: () => ({
    isAdmin: state.isAdmin,
    isDispatcher: state.isDispatcher,
    isFieldAgent: state.isFieldAgent,
    roles: state.isAdmin ? ["admin"] : [],
    loading: false,
    userId: "user-1",
  }),
}));
vi.mock("@/hooks/useSalesRep", () => ({
  useSalesRep: () => ({ isSalesRep: state.isSalesRep, loading: false }),
}));
vi.mock("@/hooks/useIsMainCompany", () => ({
  useIsMainCompany: () => ({ isMain: state.isMain, isLoading: false }),
}));
vi.mock("@/components/RequirePlatformOwner", () => ({
  usePlatformOwner: () => ({ isPlatformOwner: state.isPlatformOwner, loading: false }),
}));
vi.mock("@/hooks/useCompanySettings", () => ({
  useCompanySettings: () => ({ settings: { company_name: "Massair CT" }, isLoading: false }),
}));
vi.mock("@/hooks/useSignedInIdentity", () => ({
  useSignedInIdentity: () => ({ name: "Preview User", role: "Admin" }),
}));
vi.mock("@/hooks/useLeadInbox", () => ({
  useLeadInbox: () => ({ leads: [], count: 0, isLoading: false }),
}));
vi.mock("@/hooks/useLeadSla", () => ({
  useLeadSla: () => ({ sla: null, row: null }),
  useNow: () => 0,
}));
vi.mock("@/hooks/usePendingApplicants", () => ({
  usePendingApplicants: () => ({ pending: [], count: 0 }),
}));
vi.mock("@/hooks/useBotProposalCount", () => ({
  useBotProposalCount: () => 0,
}));
vi.mock("@/hooks/usePayType", () => ({
  useIsSalaried: () => false,
}));
vi.mock("@/hooks/useCashHealth", () => ({
  useCashHealthEnabled: () => ({ enabled: false, loading: false, companyId: null }),
}));
vi.mock("@/hooks/useInvoiceDue", () => ({
  useInvoiceDue: () => ({
    summary: { overdue: { count: 0, amount: 0 } },
    rows: [],
    loading: false,
  }),
}));

import V8Sidebar from "@/components/v8/V8Sidebar";

function show() {
  return render(
    <MemoryRouter initialEntries={["/admin"]}>
      <V8Sidebar onCreateLead={() => {}} onSignOut={() => {}} />
    </MemoryRouter>,
  );
}

describe("v8 sidebar Stock pin init order", () => {
  beforeEach(() => {
    cleanup();
    state.isAdmin = true;
    state.isDispatcher = false;
    state.isFieldAgent = false;
    state.isSalesRep = false;
    state.isMain = true;
    state.isPlatformOwner = true;
  });

  it("renders admin Stock without reading isAdmin before it is initialized", () => {
    expect(() => show()).not.toThrow();
    expect(screen.getByRole("button", { name: "Stock" })).toBeInTheDocument();
  });

  it("hides Stock from a non-admin owner without throwing", () => {
    state.isAdmin = false;
    state.isMain = false;
    state.isPlatformOwner = false;
    expect(() => show()).not.toThrow();
    expect(screen.queryByRole("button", { name: "Stock" })).toBeNull();
    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
  });
});
