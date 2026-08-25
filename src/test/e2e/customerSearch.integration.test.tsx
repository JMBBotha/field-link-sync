import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: any[]) => rpc(...args),
    from: vi.fn(),
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

import CustomerSearchSelector from "@/components/customers/CustomerSearchSelector";
import { useCheckDuplicates } from "@/hooks/useCustomerSearch";
import { renderHook, act } from "@testing-library/react";

const SEARCH_ROW = {
  id: "cust-1",
  first_name: "Jules",
  last_name: "Harding",
  company_name: null,
  is_company: false,
  phone: "082 123 4567",
  email: "jules@example.com",
  primary_address_line1: "12 Beach Road",
  city: "Cape Town",
  status: "active",
  relevance: 1,
};

const DUP_ROW = {
  id: "cust-1",
  first_name: "Jules",
  last_name: "Harding",
  phone: "082 123 4567",
  email: "jules@example.com",
  primary_address_line1: "12 Beach Road",
  match_type: "exact_phone",
  match_score: 1,
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("customer search + duplicate check integration", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "search_customers") return { data: [SEARCH_ROW], error: null };
      if (fn === "check_customer_duplicates") return { data: [DUP_ROW], error: null };
      return { data: null, error: new Error(`unexpected rpc ${fn}`) };
    });
  });

  it("calls search_customers and renders primary_address_line1", async () => {
    render(
      <CustomerSearchSelector value="" onSelect={vi.fn()} />,
      { wrapper },
    );

    const input = screen.getByPlaceholderText(/search by name/i);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Jules" } });

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("search_customers", {
        search_term: "Jules",
        max_results: 20,
      });
    });

    expect(await screen.findByText("12 Beach Road")).toBeInTheDocument();
    expect(screen.getByText("Jules Harding")).toBeInTheDocument();
  });

  it("calls check_customer_duplicates and maps the renamed address field", async () => {
    const { result } = renderHook(() => useCheckDuplicates(), { wrapper });

    let matches: any[] = [];
    await act(async () => {
      matches = await result.current.checkDuplicates({
        phone: "082 123 4567",
        email: "jules@example.com",
        firstName: "Jules",
        lastName: "Harding",
        address: "12 Beach Road",
      });
    });

    expect(rpc).toHaveBeenCalledWith("check_customer_duplicates", {
      p_phone: "082 123 4567",
      p_email: "jules@example.com",
      p_first_name: "Jules",
      p_last_name: "Harding",
      p_address: "12 Beach Road",
    });
    expect(matches[0].primary_address_line1).toBe("12 Beach Road");
    expect(matches[0]).not.toHaveProperty("address_line1");
  });

  it("never references the pre-rename address columns in RPC payloads", async () => {
    renderHook(() => useCheckDuplicates(), { wrapper });
    const { result } = renderHook(() => useCheckDuplicates(), { wrapper });

    await act(async () => {
      await result.current.checkDuplicates({ phone: "082 123 4567" });
    });

    const serialized = JSON.stringify(rpc.mock.calls);
    expect(serialized).not.toContain("address_line1\"");
    expect(serialized).not.toMatch(/"p_city"|"city"/);
  });
});
