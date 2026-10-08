import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { techCardContent } from "@/components/cards/JobCard";
import { Button } from "@/components/ui/button";

describe("probe techCardContent", () => {
  it("what survives", () => {
    const { container } = render(<div>{techCardContent(
      <div className="flex gap-2">
        <Button asChild size="sm" variant="outline">
          <a href="tel:0821234567"> Call</a>
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href="https://www.google.com/maps/dir/?api=1&destination=X" target="_blank" rel="noreferrer"> Navigate</a>
        </Button>
      </div>
    )}</div>);
    console.log("HTML>>>", container.innerHTML);
    expect(true).toBe(true);
  });
});
