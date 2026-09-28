import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useState } from "react";
import ClientTypeahead from "@/components/ClientTypeahead";
import type { UnifiedClient } from "@/hooks/useUnifiedClients";

const clients = [
  { customer_id: "c1", name: "Sipho Ndlovu", phone: "0821112222", email: null, address: "12 Oak St, Sandton" },
  { customer_id: "c2", name: "Maria Botha", phone: "0833334444", email: "maria@example.com", address: "5 Pine Ave, Centurion" },
  { customer_id: "c3", name: "Sipho Dlamini", phone: "0845556666", email: null, address: null },
  { customer_id: null, name: "Ghost Row", phone: "0800000000", email: null, address: null },
] as unknown as UnifiedClient[];

/** Mirrors the CreateLeadDialog wiring: focus opens, blur closes after 150ms, Escape closes. */
const Wrapper = ({ onSelect = vi.fn() }: { onSelect?: (c: UnifiedClient) => void }) => {
  const [name, setName] = useState("");
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <input
        aria-label="Customer name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setFocused(false);
        }}
      />
      <ClientTypeahead query={name} open={focused} clients={clients} onSelect={onSelect} />
      <button>Other field</button>
    </div>
  );
};

describe("ClientTypeahead", () => {
  it("renders nothing when the field is empty", () => {
    const { container } = render(
      <ClientTypeahead query="" open clients={clients} onSelect={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when not open, even with text", () => {
    const { container } = render(
      <ClientTypeahead query="sipho" open={false} clients={clients} onSelect={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows matching clients from the first character", () => {
    render(<ClientTypeahead query="s" open clients={clients} onSelect={vi.fn()} />);
    expect(screen.getByText("Sipho Ndlovu")).toBeInTheDocument();
    expect(screen.getByText("Sipho Dlamini")).toBeInTheDocument();
    expect(screen.queryByText("Maria Botha")).not.toBeInTheDocument();
  });

  it("filters by name, phone and address", () => {
    render(<ClientTypeahead query="sandton" open clients={clients} onSelect={vi.fn()} />);
    expect(screen.getByText("Sipho Ndlovu")).toBeInTheDocument();
    expect(screen.queryByText("Sipho Dlamini")).not.toBeInTheDocument();
  });

  it("never lists rows without a customer id", () => {
    render(<ClientTypeahead query="ghost" open clients={clients} onSelect={vi.fn()} />);
    expect(screen.queryByTestId("client-typeahead")).not.toBeInTheDocument();
  });

  it("shows nothing when nothing matches, so the form continues as a new client", () => {
    const { container } = render(
      <ClientTypeahead query="zzz nobody" open clients={clients} onSelect={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("selecting via pointerdown (mouse or touch) calls onSelect", () => {
    const onSelect = vi.fn();
    render(<ClientTypeahead query="maria" open clients={clients} onSelect={onSelect} />);
    fireEvent.pointerDown(screen.getByText("Maria Botha"));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: "c2", name: "Maria Botha" })
    );
  });
});

describe("ClientTypeahead focus wiring (as in CreateLeadDialog)", () => {
  it("closed when not focused; opens on focus with text; closes on blur; reopens on refocus", async () => {
    vi.useFakeTimers();
    try {
      render(<Wrapper />);
      const input = screen.getByLabelText("Customer name");
      fireEvent.change(input, { target: { value: "sipho" } });
      // typed but never focused -> closed
      expect(screen.queryByTestId("client-typeahead")).not.toBeInTheDocument();

      fireEvent.focus(input);
      expect(screen.getByTestId("client-typeahead")).toBeInTheDocument();

      fireEvent.blur(input);
      expect(screen.getByTestId("client-typeahead")).toBeInTheDocument(); // still open within the delay
      act(() => vi.advanceTimersByTime(200));
      expect(screen.queryByTestId("client-typeahead")).not.toBeInTheDocument();

      fireEvent.focus(input); // text still there -> reopens
      expect(screen.getByTestId("client-typeahead")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Escape closes the list", () => {
    render(<Wrapper />);
    const input = screen.getByLabelText("Customer name");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "sipho" } });
    expect(screen.getByTestId("client-typeahead")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("client-typeahead")).not.toBeInTheDocument();
  });

  it("tapping a suggestion selects it before blur closes the list", () => {
    const onSelect = vi.fn();
    render(<Wrapper onSelect={onSelect} />);
    const input = screen.getByLabelText("Customer name");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "maria" } });
    fireEvent.pointerDown(screen.getByText("Maria Botha"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ customer_id: "c2" }));
  });
});
