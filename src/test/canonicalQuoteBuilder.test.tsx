import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanonicalAreaCreateControl, nextAreaName, OTHER_AREA_PICKS } from "@/components/quote/AreaNameChips";
import { CORE_SERVICES, serviceLineFields, type CatalogService } from "@/lib/catalogServices";

describe("canonical quote builder", () => {
  it("starts with four primary area blocks and an Other menu", () => {
    render(<CanonicalAreaCreateControl existingNames={[]} onCreate={vi.fn()} />);
    const choices = screen.getByTestId("canonical-area-choices");
    expect(within(choices).getAllByRole("button").map((button) => button.textContent?.trim())).toEqual([
      "Main bedroom", "Guest bedroom", "Lounge", "Office", "Other",
    ]);
    expect(OTHER_AREA_PICKS).toEqual(["Bedroom", "Bedroom 1", "Kitchen", "Dining room", "Study"]);
  });

  it("auto-numbers repeated canonical area names", () => {
    expect(nextAreaName("Main bedroom", ["Main bedroom", "Main bedroom 2"])).toBe("Main bedroom 3");
  });

  it("keeps all twelve services ordered and new blank services at R0", () => {
    expect(CORE_SERVICES.map((service) => service.name).slice(-3)).toEqual(["Package unit", "Extraction system", "Fresh air system"]);
    const service = { id: "fresh", name: "Fresh air system", description: null, sort_order: 12, origin: "core", owner_company_id: "master", is_active: true } satisfies CatalogService;
    expect(serviceLineFields(service)).toMatchObject({ description: null, unit_price: 0, quantity: 1 });
  });
});