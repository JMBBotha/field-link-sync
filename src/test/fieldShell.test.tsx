import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import logo from "@/assets/logo.png";
import FieldShell from "@/components/field/FieldShell";

const state = vi.hoisted(() => ({
  company: null as { name: string; logo_url: string | null } | null,
  loading: false,
  isOnline: true,
}));
vi.mock("@/providers/CompanyProvider", () => ({ useCompany: () => state }));
vi.mock("@/contexts/OfflineContext", () => ({ useOfflineContext: () => ({ isOnline: state.isOnline, syncStatus: { pendingCount: 0 } }) }));

describe("FieldShell", () => {
  it("renders title, page content, online badge and bottom navigation", () => {
    render(<MemoryRouter initialEntries={["/field/schedule"]}><FieldShell title="Schedule"><p>Booked visits</p></FieldShell></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByText("Booked visits")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Online");
    for (const name of ["Home", "My Jobs", "Schedule", "Map", "Earnings"]) expect(screen.getByRole("link", { name })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("shows a working back button when requested", () => {
    render(<MemoryRouter initialEntries={["/field/my-jobs", "/field/jobs/j"]} initialIndex={1}>
      <Routes><Route path="/field/my-jobs" element={<p>Previous page</p>} />
        <Route path="/field/jobs/j" element={<FieldShell title="Job sheet" back><p>Packing list</p></FieldShell>} /></Routes>
    </MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Previous page")).toBeInTheDocument();
  });

  it.each([null, "", "   "])("falls back to bundled logo for an empty company logo (%s)", (logo_url) => {
    state.company = { name: "Test Company", logo_url };
    render(<MemoryRouter><FieldShell title="Schedule">Content</FieldShell></MemoryRouter>);
    expect(screen.getByRole("img", { name: "Test Company" })).toHaveAttribute("src", logo);
    state.company = null;
  });

  it("uses the company logo when ready and falls back while loading or without a provider", () => {
    state.company = { name: "Test Company", logo_url: "/company-logo.png" };
    const { rerender } = render(<MemoryRouter><FieldShell title="Schedule">Content</FieldShell></MemoryRouter>);
    expect(screen.getByRole("img", { name: "Test Company" })).toHaveAttribute("src", "/company-logo.png");
    state.loading = true;
    rerender(<MemoryRouter><FieldShell title="Schedule">Content</FieldShell></MemoryRouter>);
    expect(screen.getByRole("img", { name: "Test Company" })).toHaveAttribute("src", logo);
    state.company = null;
    state.loading = false;
    state.isOnline = false;
    rerender(<MemoryRouter><FieldShell title="Schedule">Content</FieldShell></MemoryRouter>);
    expect(screen.getByRole("img", { name: "My Company" })).toHaveAttribute("src", logo);
    expect(screen.getByRole("status")).toHaveTextContent("Offline");
    state.isOnline = true;
  });
});