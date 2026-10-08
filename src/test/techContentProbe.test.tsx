import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { techCardContent } from "@/components/cards/JobCard";
import { Button } from "@/components/ui/button";

const show = (label: string, node: React.ReactNode) => {
  const { container } = render(<div>{techCardContent(node)}</div>);
  console.log(label, ">>>", container.innerHTML || "(empty)");
};

describe("probe techCardContent", () => {
  it("what survives", () => {
    show("plain-button", <Button>Call</Button>);
    show("aschild-button", <Button asChild><a href="tel:0821234567">Call</a></Button>);
    show("anchor-only", <a href="tel:0821234567">Call</a>);
    show("aschild-nohref", <Button asChild><a>Call</a></Button>);
    expect(true).toBe(true);
  });
});
