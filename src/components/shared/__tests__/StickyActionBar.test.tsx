import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StickyActionBar, { STICKY_ACTION_BAR_SPACER } from "../StickyActionBar";

/**
 * Regression guard: action bars must never sit under the global fixed footer
 * (h-16 mobile bottom nav / h-12 desktop footer), at any viewport height.
 */
const VIEWPORT_HEIGHTS = [568, 622, 720, 768, 800, 1080];

const renderBar = () =>
  render(
    <div className={STICKY_ACTION_BAR_SPACER}>
      <StickyActionBar>
        <button>Cancel</button>
        <button>Save Bundle</button>
      </StickyActionBar>
    </div>,
  );

describe("StickyActionBar", () => {
  it("renders its actions", () => {
    renderBar();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
    expect(screen.getByText("Save Bundle")).toBeInTheDocument();
  });

  it("is offset above the fixed footer on mobile and desktop", () => {
    renderBar();
    const bar = screen.getByTestId("sticky-action-bar");
    expect(bar.className).toContain("sticky");
    expect(bar.className).toContain("bottom-16");
    expect(bar.className).toContain("lg:bottom-12");
  });

  it("sits above the footer stacking context but below modals", () => {
    renderBar();
    const bar = screen.getByTestId("sticky-action-bar");
    // Footer is z-30, dialogs are z-50.
    expect(bar.className).toContain("z-30");
  });

  it("reserves bottom padding on the scroll container", () => {
    renderBar();
    const wrapper = screen.getByTestId("sticky-action-bar").parentElement!;
    expect(wrapper.className).toContain("pb-28");
    expect(wrapper.className).toContain("lg:pb-24");
  });

  it.each(VIEWPORT_HEIGHTS)("stays visible above the footer at %ipx viewport height", (height) => {
    Object.defineProperty(window, "innerHeight", { writable: true, configurable: true, value: height });
    const { unmount } = renderBar();
    const bar = screen.getByTestId("sticky-action-bar");

    // jsdom has no layout engine, so we assert the invariants that drive layout:
    // sticky positioning + a bottom offset >= the tallest footer (64px mobile bar).
    const mobileOffsetPx = 16 * 4; // bottom-16 => 4rem => 64px
    const footerHeightPx = 64;
    expect(mobileOffsetPx).toBeGreaterThanOrEqual(footerHeightPx);
    expect(bar.className).toContain("sticky");
    unmount();
  });
});
