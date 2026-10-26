import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }), in: async () => ({ data: [] }) }) }), rpc: async () => ({ data: null }), functions: { invoke: async () => ({}) } } }));
import { QuoteUnitCardsView } from "@/components/quoting/QuoteUnitCards";

const card: any = { modelKey: "AC100NN4DEH/AF", modelCode: "AC100NN4DEH/AF", quantity: 1, rooms: [], brand: "Samsung", name: "Samsung", btu: null, refrigerant: null,
  media: { model_key: "AC100NN4DEH/AF", model_code: "AC100NN4DEH/AF", status: "approved", image_status: "ready", image_url: "/x.png", description: "Samsung WindFree text.", outdoor_model_code: "AC100JX4DEH/AF", outdoor_image_url: null, specs: {} } };

describe("quote card outdoor unit + description", () => {
  it("shows description, outdoor model and an honest placeholder when no outdoor photo", () => {
    render(<QuoteUnitCardsView cards={[card]} companyName="Massair CT" />);
    expect(screen.getByTestId("unit-card-description").textContent).toBe("Samsung WindFree text.");
    expect(screen.getByTestId("unit-card-outdoor-model").textContent).toContain("AC100JX4DEH/AF");
    expect(screen.getByTestId("unit-card-outdoor-placeholder").textContent).toContain("Photo to follow");
  });
  it("renders nothing extra without outdoor_model_code", () => {
    render(<QuoteUnitCardsView cards={[{ ...card, media: { ...card.media, outdoor_model_code: null, description: null } }]} companyName="Massair CT" />);
    expect(screen.queryByTestId("unit-card-outdoor")).toBeNull();
    expect(screen.queryByTestId("unit-card-description")).toBeNull();
  });
});
