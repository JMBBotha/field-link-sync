import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { PhotoViewer, PHOTO_GRID } from "@/components/photos/PhotoViewer";

const photos = [1, 2, 3].map((i) => ({ id: String(i), url: `https://x.test/${i}.jpg`, caption: `Photo ${i}` }));
function H({ onClose = () => {} }) { const [i, setI] = useState(0); return <PhotoViewer photos={photos} index={i} onIndex={setI} onClose={onClose} label="Before" />; }

describe("PhotoViewer", () => {
  it("shows counter + label and swipes", () => {
    render(<H />);
    expect(screen.getByTestId("photo-viewer-counter").textContent).toBe("1 / 3");
    expect(screen.getByTestId("photo-viewer-label").textContent).toBe("Before");
    const area = screen.getByTestId("photo-viewer-img").parentElement!;
    fireEvent.touchStart(area, { touches: [{ clientX: 300, clientY: 200 }] });
    fireEvent.touchEnd(area, { touches: [], changedTouches: [{ clientX: 100, clientY: 205 }] });
    expect(screen.getByTestId("photo-viewer-counter").textContent).toBe("2 / 3");
    fireEvent.click(screen.getByLabelText("Previous photo"));
    fireEvent.click(screen.getByLabelText("Previous photo"));
    expect(screen.getByTestId("photo-viewer-counter").textContent).toBe("3 / 3");
  });
  it("closes", () => { const c = vi.fn(); render(<H onClose={c} />); fireEvent.click(screen.getByTestId("photo-viewer-close")); expect(c).toHaveBeenCalled(); });
  it("phone grid is 2 columns, tablet 3, desktop 4", () => { expect(PHOTO_GRID).toMatch(/grid-cols-2 sm:grid-cols-3 lg:grid-cols-4/); });
});
