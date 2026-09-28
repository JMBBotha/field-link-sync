import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ClientTypeahead from "@/components/ClientTypeahead";
import type { UnifiedClient } from "@/hooks/useUnifiedClients";

const clients = [
  { customer_id: "c1", name: "Sipho Ndlovu", phone: "0821112222", email: null, address: "12 Oak St, Sandton" },
  { customer_id: "c2", name: "Maria Botha", phone: "0833334444", email: "maria@example.com", address: "5 Pine Ave, Centurion" },
  { customer_id: "c3", name: "Sipho Dlamini", phone: "0845556666", email: null, address: null },
  { customer_id: null, name: "Ghost Row", phone: "0800000000", email: null, address: null },
] as unknown as UnifiedClient[];

describe("ClientTypeahead", () => {
  it("renders nothing when the field is empty", () => {
    const { container } = render(
      <ClientTypeahead query="" clients={clients} onSelect={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("client-typeahead")).not.toBeInTheDocument();
  });

  it("renders nothing for whitespace-only input", () => {
    const { container } = render(
      <ClientTypeahead query="   " clients={clients} onSelect={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows matching clients from the first character", () => {
    render(<ClientTypeahead query="s" clients={clients} onSelect={vi.fn()} />);
    expect(screen.getByText("Sipho Ndlovu")).toBeInTheDocument();
    expect(screen.getByText("Sipho Dlamini")).toBeInTheDocument();
    expect(screen.queryByText("Maria Botha")).not.toBeInTheDocument();
  });

  it("filters by name, phone and address", () => {
    render(<ClientTypeahead query="sandton" clients={clients} onSelect={vi.fn()} />);
    expect(screen.getByText("Sipho Ndlovu")).toBeInTheDocument();
    expect(screen.queryByText("Sipho Dlamini")).not.toBeInTheDocument();
  });

  it("never lists rows without a customer id", () => {
    render(<ClientTypeahead query="ghost" clients={clients} onSelect={vi.fn()} />);
    expect(screen.queryByTestId("client-typeahead")).not.toBeInTheDocument();
  });

  it("selecting a match calls onSelect with that client", () => {
    const onSelect = vi.fn();
    render(<ClientTypeahead query="maria" clients={clients} onSelect={onSelect} />);
    fireEvent.mouseDown(screen.getByText("Maria Botha"));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: "c2", name: "Maria Botha" })
    );
  });

  it("shows nothing when nothing matches, so the form continues as a new client", () => {
    const { container } = render(
      <ClientTypeahead query="zzz nobody" clients={clients} onSelect={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
