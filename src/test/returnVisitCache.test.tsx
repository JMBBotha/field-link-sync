import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockSupabase } from "@/test/mocks/supabase";
import { queryDefaults } from "@/lib/queryDefaults";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { readQuoteSnapshot, rememberQuoteSnapshot, setQuoteSnapshotCacheEnabled } from "@/lib/quoteSnapshotCache";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" }, loading: false, session: null }),
}));

function companyChain(companyId: string) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    single: async () => ({ data: { company_id: companyId }, error: null }),
  };
  return builder;
}

function Probe() {
  const { companyId, loading } = useUserCompanyId();
  return <div data-testid="co">{loading ? "loading" : (companyId ?? "none")}</div>;
}

describe("return visit keeps the last result", () => {
  afterEach(() => {
    cleanup();
    setQuoteSnapshotCacheEnabled(null);
  });

  it("holds screen data for the session and still refetches in the background", () => {
    expect(queryDefaults.queries?.staleTime).toBe(30_000);
    expect(queryDefaults.queries?.gcTime).toBe(30 * 60_000);
    expect(queryDefaults.queries?.refetchOnWindowFocus).toBe(true);
    expect(queryDefaults.queries?.refetchOnMount).toBe(true);
  });

  it("shows the company id immediately the next time a page mounts", async () => {
    mockSupabase.from.mockImplementation(() => companyChain("co-9"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (node: JSX.Element) => <QueryClientProvider client={client}>{node}</QueryClientProvider>;
    render(tree(<Probe />));
    await waitFor(() => expect(screen.getByTestId("co").textContent).toBe("co-9"));
    cleanup();
    render(tree(<Probe />));
    expect(screen.getByTestId("co").textContent).toBe("co-9");
  });

  it("does not keep an empty snapshot that would paint a blank quote", () => {
    setQuoteSnapshotCacheEnabled(true);
    rememberQuoteSnapshot("q-empty", { meta: { id: "q-empty" }, areas: [], items: [] });
    expect(readQuoteSnapshot("q-empty")).toBeNull();
  });

  it("remembers the quote that was just open", () => {
    setQuoteSnapshotCacheEnabled(true);
    expect(readQuoteSnapshot("q1")).toBeNull();
    rememberQuoteSnapshot("q1", { meta: { id: "q1" }, areas: [{ id: "a" }], items: [{ id: "i" }] });
    expect(readQuoteSnapshot<{ meta: { id: string } }>("q1")?.meta.id).toBe("q1");
    setQuoteSnapshotCacheEnabled(false);
    expect(readQuoteSnapshot("q1")).toBeNull();
  });
});
