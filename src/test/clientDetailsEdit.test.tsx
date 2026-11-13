import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpcCalls: { fn: string; args: any }[] = [];
const writes: { op: string; table: string; payload: any; eq?: any[] }[] = [];
let customer: Record<string, any> = {};
let locations: any[] = [];

const resetFixture = () => {
  customer = {
    id: "c1",
    company_id: "co1",
    first_name: "Johan",
    last_name: "Botha",
    name: "Johan Botha",
    company_name: "Botha Air",
    is_company: false,
    client_type: "private",
    phone: "0820000000",
    secondary_phone: "0210000000",
    email: "johan@example.com",
    vat_number: "4123456789",
    primary_address_line1: "14 Industry Road",
    primary_address_line2: "Unit 3",
    city: "Cape Town",
    postal_code: "8001",
    address: "14 Industry Road, Unit 3, Cape Town, 8001",
    status: "active",
    notes: "Gate code",
    lead_source: null,
    owner_rep_id: null,
  };
  locations = [
    { id: "loc-home", customer_id: "c1", company_id: "co1", label: "Home", address: "9 Oak Lane, Durbanville", is_primary: false, created_at: "2026-01-01" },
    { id: "loc-work", customer_id: "c1", company_id: "co1", label: "Work", address: "14 Industry Road, Unit 3, Cape Town, 8001", is_primary: true, created_at: "2026-01-02" },
    { id: "loc-rent", customer_id: "c1", company_id: "co1", label: "Rental", address: "5 Site Road", is_primary: false, created_at: "2026-01-03" },
  ];
  rpcCalls.length = 0;
  writes.length = 0;
};

function tableResult(table: string, mode: "list" | "one") {
  if (table === "customers") return { data: mode === "one" ? { ...customer } : [{ ...customer }], error: null };
  if (table === "customer_locations") return { data: locations.map((row) => ({ ...row })), error: null };
  return { data: mode === "one" ? null : [], error: null };
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      let pending: { op: string; payload: any } | null = null;
      const api: any = {
        select: () => api,
        eq: (...eq: any[]) => {
          if (pending) {
            writes.push({ op: pending.op, table, payload: pending.payload, eq });
            if (table === "customers" && pending.payload && "is_company" in pending.payload) customer.is_company = pending.payload.is_company;
            pending = null;
          }
          return api;
        },
        in: () => api,
        or: () => api,
        neq: () => api,
        is: () => api,
        not: () => api,
        gte: () => api,
        lte: () => api,
        limit: () => api,
        order: () => api,
        range: () => api,
        filter: () => api,
        insert: (payload: any) => {
          writes.push({ op: "insert", table, payload });
          return api;
        },
        update: (payload: any) => {
          pending = { op: "update", payload };
          return api;
        },
        delete: () => api,
        single: async () => tableResult(table, "one"),
        maybeSingle: async () => tableResult(table, "one"),
        then: (resolve: any, reject: any) => Promise.resolve(tableResult(table, "list")).then(resolve, reject),
      };
      return api;
    },
    rpc: async (fn: string, args?: any) => {
      rpcCalls.push({ fn, args });
      if (fn === "update_entity") {
        customer = { ...customer, ...args.p_patch };
        return { data: { ...customer }, error: null };
      }
      return { data: [], error: null };
    },
    channel: () => {
      const ch: any = { on: () => ch, subscribe: () => ch };
      return ch;
    },
    removeChannel: () => {},
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, loading: false, session: { user: { id: "u1" } } }),
}));
vi.mock("@/hooks/useRole", () => ({
  useRole: () => ({
    isAdmin: true, isDispatcher: false, canAccessAdmin: true, canDelete: true, canWrite: true,
    userId: "u1", loading: false, role: "admin", roles: ["admin"], isFieldAgent: false, isViewer: false,
  }),
}));
vi.mock("@/hooks/useSalesRep", () => ({ useSalesRep: () => ({ isSalesRep: false, loading: false }) }));
vi.mock("@/hooks/useInvoiceDue", () => ({
  useInvoiceDue: () => ({ rows: [], summary: {}, byInvoice: new Map(), canSee: false, loading: false, refetch: () => {} }),
}));
vi.mock("@/hooks/useSalesHeartbeat", () => ({ useSalesHeartbeat: () => ({ hb: { hot: [] } }) }));
vi.mock("@/hooks/useAssistantContextTracker", () => ({
  useRegisterAssistantContext: () => {},
  pageNameFromPath: () => "customers",
}));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
}));

import AdminCustomerDetailPage from "@/pages/admin/AdminCustomerDetailPage";
import AdminCustomersPage from "@/pages/admin/AdminCustomersPage";
import CreateCustomerDialog from "@/components/customers/CreateCustomerDialog";
import ClientDetailsEditor from "@/components/customers/ClientDetailsEditor";

const wrap = (ui: ReactNode) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  resetFixture();
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLElement.prototype.hasPointerCapture = () => false;
  window.HTMLElement.prototype.releasePointerCapture = () => {};
});

const hiddenByClass = (el: HTMLElement | null) => {
  while (el) {
    const cls = typeof el.className === "string" ? el.className : "";
    if (/(?:^|\s)hidden(?:\s|$)/.test(cls)) return true;
    el = el.parentElement;
  }
  return false;
};

describe("client details edit", () => {
  it("header Edit details is visible and opens private, company, home and work for a private client", async () => {
    wrap(
      <MemoryRouter initialEntries={["/admin/customers/c1"]}>
        <Routes>
          <Route path="/admin/customers/:id" element={<AdminCustomerDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const edit = await screen.findByTestId("edit-client-details");
    expect(edit.textContent).toMatch(/Edit details/);
    expect(hiddenByClass(edit)).toBe(false);
    expect(edit.querySelector("svg")).toBeTruthy();
    fireEvent.click(edit);
    expect(await screen.findByTestId("client-private-details")).toBeTruthy();
    expect(screen.getByTestId("client-company-details")).toBeTruthy();
    expect(screen.getByTestId("client-home-address")).toBeTruthy();
    expect(screen.getByTestId("client-work-address")).toBeTruthy();
    expect(screen.getByText("Changing this does not hide private or company details.")).toBeTruthy();
    expect(within(screen.getByTestId("client-private-details")).getByText("Johan Botha")).toBeTruthy();
    expect(within(screen.getByTestId("client-company-details")).getByText("Botha Air")).toBeTruthy();
    expect(screen.getByTestId("home-address-input")).toHaveProperty("value", "9 Oak Lane, Durbanville");
    expect(screen.getByTestId("work-line1")).toHaveProperty("value", "14 Industry Road");
    expect(screen.getByRole("heading", { name: "Johan Botha" })).toBeTruthy();
  });

  it("opens on the details tab from the list pencil", async () => {
    wrap(
      <MemoryRouter initialEntries={["/admin/customers/c1?tab=details"]}>
        <Routes>
          <Route path="/admin/customers/:id" element={<AdminCustomerDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("client-work-address")).toBeTruthy();
    expect(screen.getByTestId("client-home-address")).toBeTruthy();
  });

  it("saving company leaves private fields untouched and saving work updates billing plus the Work location", async () => {
    wrap(
      <ClientDetailsEditor customerId="c1" companyId="co1" initialData={customer} locations={locations} />,
    );
    const company = await screen.findByTestId("client-company-details");
    fireEvent.click(within(company).getByRole("button", { name: /Botha Air/ }));
    fireEvent.change(within(company).getByRole("textbox"), { target: { value: "Botha Air (Pty) Ltd" } });
    fireEvent.blur(within(company).getByRole("textbox"));
    await waitFor(() => expect(rpcCalls.some((c) => c.fn === "update_entity" && c.args.p_patch.company_name === "Botha Air (Pty) Ltd")).toBe(true));
    const companySave = rpcCalls.find((c) => c.fn === "update_entity" && c.args.p_patch.company_name === "Botha Air (Pty) Ltd")!;
    expect(Object.keys(companySave.args.p_patch)).toEqual(["company_name"]);
    expect(writes.some((w) => w.table === "customers" && w.payload.is_company === true)).toBe(true);
    expect(within(screen.getByTestId("client-private-details")).getByText("Johan Botha")).toBeTruthy();
    expect(within(screen.getByTestId("client-private-details")).getByText("johan@example.com")).toBeTruthy();

    fireEvent.change(screen.getByTestId("work-line1"), { target: { value: "99 New Work Road" } });
    fireEvent.click(screen.getByTestId("save-work-address"));
    await waitFor(() => expect(rpcCalls.some((c) => c.args?.p_patch?.primary_address_line1 === "99 New Work Road")).toBe(true));
    const workSave = rpcCalls.find((c) => c.args?.p_patch?.primary_address_line1 === "99 New Work Road")!;
    expect(workSave.args.p_patch).toMatchObject({
      primary_address_line1: "99 New Work Road",
      primary_address_line2: "Unit 3",
      city: "Cape Town",
      postal_code: "8001",
    });
    for (const key of ["name", "phone", "email", "company_name", "vat_number"]) {
      expect(workSave.args.p_patch).not.toHaveProperty(key);
    }
    expect(writes.some((w) => w.table === "customer_locations" && w.op === "update" && w.eq?.[0] === "id" && w.eq?.[1] === "loc-work" && w.payload.label === "Work" && String(w.payload.address).includes("99 New Work Road"))).toBe(true);

    fireEvent.change(screen.getByTestId("home-address-input"), { target: { value: "12 New Home Lane" } });
    fireEvent.click(screen.getByTestId("save-home-address"));
    await waitFor(() => expect(writes.some((w) => w.table === "customer_locations" && w.payload.label === "Home" && w.payload.address === "12 New Home Lane" && w.eq?.[1] === "loc-home")).toBe(true));
    expect(writes.some((w) => w.eq?.[1] === "loc-rent" || w.payload?.label === "Rental")).toBe(false);
    expect(rpcCalls.some((c) => c.args?.p_patch && "primary_address_line1" in c.args.p_patch && c.args.p_patch.primary_address_line1 === "12 New Home Lane")).toBe(false);
  });

  it("shows a pencil on each client list row that is not hidden on a phone", async () => {
    wrap(
      <MemoryRouter>
        <AdminCustomersPage />
      </MemoryRouter>,
    );
    const edit = await screen.findByTestId("edit-client-row");
    expect(edit.textContent).toMatch(/Edit/);
    expect(edit.querySelector("svg")).toBeTruthy();
    expect(hiddenByClass(edit)).toBe(false);
    expect(edit.getAttribute("aria-label")).toMatch(/Edit Johan Botha/);
  });

  it("shows company details on create without a switch", () => {
    wrap(<CreateCustomerDialog open onOpenChange={() => {}} onCreated={() => {}} />);
    expect(screen.getByTestId("create-company-name")).toBeTruthy();
    expect(screen.getByText("Company details")).toBeTruthy();
    expect(screen.getByText("Private details")).toBeTruthy();
    expect(screen.getByText("Work address")).toBeTruthy();
    expect(screen.getByText("Home address")).toBeTruthy();
    expect(screen.queryByText("This is a company")).toBeNull();
  });
});
