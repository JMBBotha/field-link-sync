import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { act, fireEvent, render, screen } from "@testing-library/react";
import AdminHomeBlockLayout from "@/components/admin/AdminHomeBlockLayout";
import {
  ADMIN_HOME_BLOCKS_KEY,
  freshAdminHomeBlocks,
  normalizeAdminHomeBlocks,
  readAdminHomeBlocks,
  reorderAdminHomeBlocks,
  setAdminHomeBlockHidden,
  setAdminHomeBlockPinned,
  visibleAdminHomeBlocks,
  writeAdminHomeBlocks,
} from "@/lib/adminHomeBlocks";

function Layout() {
  return (
    <AdminHomeBlockLayout
      earlier={<p>Earlier body</p>}
      nextSteps={<p>Next body</p>}
      nextStepsPinned={<p>Next body pinned</p>}
      moreDetails={<p>Details body</p>}
    />
  );
}

function openArrange() {
  fireEvent.click(screen.getByTestId("home-blocks-customise-open"));
}

function flowSlots() {
  return [...screen.getByTestId("home-blocks-flow").querySelectorAll(":scope > [data-home-slot]")]
    .map((el) => el.getAttribute("data-home-slot"));
}

describe("admin home block preferences", () => {
  beforeEach(() => localStorage.clear());

  it("starts with the three sections visible, in order, and collapsed", () => {
    expect(freshAdminHomeBlocks()).toEqual({
      order: ["earlier", "next", "details"],
      hidden: [],
      pinned: [],
    });
    expect(readAdminHomeBlocks()).toEqual(freshAdminHomeBlocks());
    render(<Layout />);
    const flow = screen.getByTestId("home-blocks-flow");
    expect(flow).toHaveAttribute("data-flow", "earlier,next,details");
    expect(flow).toHaveClass("space-y-3");
    expect(flowSlots()).toEqual(["earlier", "next", "details"]);
    for (const id of ["home-earlier-detail", "home-all-next-steps", "v8-home-details"]) {
      const block = screen.getByTestId(id);
      expect(block.tagName).toBe("DETAILS");
      expect(block).toHaveAttribute("data-pinned", "false");
      expect(block).not.toHaveAttribute("open");
      expect((block as HTMLDetailsElement).open).toBe(false);
    }
    expect(screen.getByTestId("home-blocks-customise")).toBeInTheDocument();
    expect(screen.getByTestId("home-blocks-customise-open")).toHaveTextContent("Arrange these sections");
  });

  it("drops unknown ids and fills a missing section when reading storage", () => {
    writeAdminHomeBlocks(ADMIN_HOME_BLOCKS_KEY, normalizeAdminHomeBlocks({
      order: ["details", "nope", "details", "next"],
      hidden: ["missing", "next"],
      pinned: ["earlier"],
    }));
    expect(readAdminHomeBlocks()).toEqual({
      order: ["details", "next", "earlier"],
      hidden: ["next"],
      pinned: ["earlier"],
    });
    expect(readAdminHomeBlocks("not-json-checked")).toEqual(freshAdminHomeBlocks());
    localStorage.setItem(ADMIN_HOME_BLOCKS_KEY, "{");
    expect(readAdminHomeBlocks()).toEqual(freshAdminHomeBlocks());
  });

  it("reorders from the drag handle and keeps that order after a reload", async () => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      const testId = this.getAttribute?.("data-testid") || "";
      const index = ["earlier", "next", "details"].indexOf(testId.replace("home-block-row-", ""));
      const top = index >= 0 ? index * 80 : 0;
      const height = index >= 0 ? 64 : 0;
      return {
        x: 0, y: top, top, left: 0, right: height ? 280 : 0, bottom: top + height, width: height ? 280 : 0, height,
        toJSON() { return {}; },
      } as DOMRect;
    };
    try {
      const view = render(<Layout />);
      openArrange();
      const handle = screen.getByTestId("home-block-handle-details");
      handle.focus();
      fireEvent.keyDown(handle, { code: "Space", key: " " });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
      fireEvent.keyDown(document, { code: "ArrowUp", key: "ArrowUp" });
      fireEvent.keyDown(document, { code: "Space", key: " " });
      expect(flowSlots()).toEqual(["earlier", "details", "next"]);
      view.unmount();
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
    }
    expect(JSON.parse(localStorage.getItem(ADMIN_HOME_BLOCKS_KEY) || "{}").order).toEqual(["earlier", "details", "next"]);
    render(<Layout />);
    expect(flowSlots()).toEqual(["earlier", "details", "next"]);
  });

  it("saves a new order and shows it again after a reload", () => {
    const moved = reorderAdminHomeBlocks(freshAdminHomeBlocks(), "details", "earlier");
    expect(moved.order).toEqual(["details", "earlier", "next"]);
    expect(visibleAdminHomeBlocks(moved)).toEqual(["details", "earlier", "next"]);
    writeAdminHomeBlocks(ADMIN_HOME_BLOCKS_KEY, moved);
    const first = render(<Layout />);
    expect(flowSlots()).toEqual(["details", "earlier", "next"]);
    expect(screen.getByTestId("home-blocks-flow").querySelector("summary")?.textContent).toBe("More details (gauges, funnel, comparisons)");
    first.unmount();
    render(<Layout />);
    expect(flowSlots()).toEqual(["details", "earlier", "next"]);
    expect(JSON.parse(localStorage.getItem(ADMIN_HOME_BLOCKS_KEY) || "{}").order).toEqual(["details", "earlier", "next"]);
  });

  it("hides a section and shows it again without deleting it", () => {
    render(<Layout />);
    openArrange();
    fireEvent.click(screen.getByTestId("home-block-visibility-next"));
    expect(flowSlots()).toEqual(["earlier", "details"]);
    expect(screen.queryByTestId("home-all-next-steps")).toBeNull();
    const hiddenRow = screen.getByTestId("home-block-row-next");
    expect(hiddenRow).toHaveAttribute("data-hidden", "true");
    expect(hiddenRow).toHaveTextContent("All next steps (filter, snooze)");
    expect(screen.getByTestId("home-block-visibility-next")).toHaveTextContent("Show");
    fireEvent.click(screen.getByTestId("home-block-visibility-next"));
    expect(flowSlots()).toEqual(["earlier", "next", "details"]);
    expect(screen.getByTestId("home-all-next-steps").tagName).toBe("DETAILS");
    expect(JSON.parse(localStorage.getItem(ADMIN_HOME_BLOCKS_KEY) || "{}").hidden).toEqual([]);
  });

  it("pins a section onto the main page and unpin returns a collapsed bar", () => {
    render(<Layout />);
    openArrange();
    fireEvent.click(screen.getByTestId("home-block-pin-next"));
    const pinned = screen.getByTestId("home-all-next-steps");
    expect(pinned.tagName).toBe("SECTION");
    expect(pinned).toHaveAttribute("data-pinned", "true");
    expect(pinned.querySelector("summary")).toBeNull();
    expect(pinned.closest("details")).toBeNull();
    expect(pinned).toHaveTextContent("Next body pinned");
    expect(screen.getByTestId("home-blocks-flow").firstElementChild).toBe(screen.getByTestId("home-earlier-detail"));
    expect(pinned.parentElement).toBe(screen.getByTestId("home-blocks-flow"));
    expect(screen.getByTestId("home-earlier-detail").tagName).toBe("DETAILS");
    expect(screen.getByTestId("v8-home-details").tagName).toBe("DETAILS");
    expect((screen.getByTestId("home-earlier-detail") as HTMLDetailsElement).open).toBe(false);

    fireEvent.click(screen.getByTestId("home-block-pin-next"));
    const collapsed = screen.getByTestId("home-all-next-steps");
    expect(collapsed.tagName).toBe("DETAILS");
    expect(collapsed).not.toHaveAttribute("open");
    expect((collapsed as HTMLDetailsElement).open).toBe(false);
    expect(collapsed.querySelector("summary")).toHaveTextContent("All next steps (filter, snooze)");
    expect(collapsed).toHaveTextContent("Next body");
    expect(JSON.parse(localStorage.getItem(ADMIN_HOME_BLOCKS_KEY) || "{}").pinned).toEqual([]);
  });

  it("does not leave a slot when a section is hidden, and the arrange control stays", () => {
    const prefs = setAdminHomeBlockHidden(freshAdminHomeBlocks(), "next", true);
    writeAdminHomeBlocks(ADMIN_HOME_BLOCKS_KEY, setAdminHomeBlockHidden(setAdminHomeBlockHidden(prefs, "earlier", true), "details", true));
    const { unmount } = render(<Layout />);
    const flow = screen.getByTestId("home-blocks-flow");
    expect(flow).toHaveAttribute("data-flow", "");
    expect(flow.querySelector("[data-home-slot]")).toBeNull();
    expect([...flow.children].map((el) => el.getAttribute("data-testid"))).toEqual(["home-blocks-customise"]);
    expect(screen.getByTestId("home-blocks-customise")).toBeInTheDocument();
    expect(screen.getByTestId("home-blocks-customise-open")).toBeInTheDocument();
    unmount();

    writeAdminHomeBlocks(ADMIN_HOME_BLOCKS_KEY, setAdminHomeBlockHidden(freshAdminHomeBlocks(), "next", true));
    render(<Layout />);
    const again = screen.getByTestId("home-blocks-flow");
    expect(flowSlots()).toEqual(["earlier", "details"]);
    const children = [...again.children];
    expect(children.map((el) => el.getAttribute("data-home-slot") || el.getAttribute("data-testid"))).toEqual([
      "earlier",
      "details",
      "home-blocks-customise",
    ]);
    expect(children.some((el) => el.childElementCount === 0 && !el.textContent?.trim())).toBe(false);
    openArrange();
    expect(screen.getByTestId("home-block-row-next")).toHaveTextContent("Show");
  });

  it("keeps a hidden section in the arrange list so it can be shown in its saved place", () => {
    const hidden = setAdminHomeBlockHidden(freshAdminHomeBlocks(), "next", true);
    const reordered = reorderAdminHomeBlocks(hidden, "next", "earlier");
    expect(reordered.order).toEqual(["next", "earlier", "details"]);
    expect(visibleAdminHomeBlocks(reordered)).toEqual(["earlier", "details"]);
    writeAdminHomeBlocks(ADMIN_HOME_BLOCKS_KEY, setAdminHomeBlockHidden(reordered, "next", false));
    render(<Layout />);
    expect(flowSlots()).toEqual(["next", "earlier", "details"]);
  });

  it("remembers a pin after reload", () => {
    writeAdminHomeBlocks(ADMIN_HOME_BLOCKS_KEY, setAdminHomeBlockPinned(freshAdminHomeBlocks(), "earlier", true));
    render(<Layout />);
    const earlier = screen.getByTestId("home-earlier-detail");
    expect(earlier.tagName).toBe("SECTION");
    expect(earlier).toHaveTextContent("Earlier body");
    expect(earlier.querySelector("summary")).toBeNull();
    expect((screen.getByTestId("v8-home-details") as HTMLDetailsElement).open).toBe(false);
  });

  it("leaves sales and tech on the nested collapsed details", () => {
    const page = readFileSync("src/pages/admin/AdminHomePage.tsx", "utf8");
    expect(page).toContain('v8Role === "admin" || v8Role === "owner"');
    expect(page).toContain("<AdminHomeBlockLayout");
    expect(page).toMatch(/home-earlier-detail[\s\S]*home-all-next-steps[\s\S]*v8-home-details[\s\S]*<\/details>/);
    expect(page).not.toContain("dashboard-layout-switch");
    expect(page).not.toContain("Switch to classic view");
  });
});
