import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AreaLabourRow from "@/components/quoting/AreaLabourRow";
import type { EstimateEditLine } from "@/components/quoting/EstimateDocument";

afterEach(cleanup);
describe("estimate labour outlines", () => {
  it.each([0, 3.5])("outlines missing and existing labour at %s hours", (quantity) => {
    render(<AreaLabourRow areaId="bedroom" areaName="Bedroom" defaultHours={3.5} lines={[{ id: "labour", quantity, unit_price: 680 } as EstimateEditLine]} onAdd={vi.fn()} onChange={vi.fn()} />);
    const rows = [screen.getByTestId("area-labour-hours-row")];
    if (!quantity) rows.push(screen.getByTestId("labour-needed-row"));
    for (const row of rows) {
      for (const token of ["border-2", "border-orange-500", "rounded-md", "bg-card", "text-foreground"]) expect(row.classList.contains(token)).toBe(true);
      expect(row.className).not.toMatch(/bg-amber|first:border|border-0/);
    }
  });
});