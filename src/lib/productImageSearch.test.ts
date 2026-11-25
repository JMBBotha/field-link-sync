import { describe, expect, it } from "vitest";
import {
  candidateMentionsModel,
  candidateMentionsOtherModel,
  hostScore,
  imageDataUrlFromGateway,
  isAlphaPng,
  isOwnProductImageUrl,
  lookupDecision,
  outboundProductText,
  productImagePatch,
  productImagePublicUrl,
  rankImageCandidates,
  visionSaysMatch,
} from "./productImageSearch";

const samsung = "https://images.samsung.com/is/image/samsung/p6/za/ar70f12c1fw-fa.png";
const other = "https://images.samsung.com/is/image/samsung/p6/za/ar50f09c1fw-fa.png";

describe("product image search rules", () => {
  it("sends only the brand and model code", () => {
    expect(outboundProductText("Samsung", "AR70F12C1FW/FA")).toBe("Samsung AR70F12C1FW/FA");
    expect(outboundProductText("  Midea  ", " R32-MICAS-48 (1PH) ")).toBe("Midea R32-MICAS-48 (1PH)");
  });

  it("keeps only image columns", () => {
    expect(productImagePatch({
      image_url: "https://x/a.png",
      image_source_url: "https://samsung.com/a",
      image_needs_review: true,
      cost_price: 100,
      selling_price: 250,
      unit_price: 250,
    })).toEqual({
      image_url: "https://x/a.png",
      image_source_url: "https://samsung.com/a",
      image_needs_review: true,
    });
  });

  it("builds the existing product-images path as a full https url", () => {
    expect(productImagePublicUrl("https://rvzapfbifggovccebrjp.supabase.co/", "abc", "png"))
      .toBe("https://rvzapfbifggovccebrjp.supabase.co/storage/v1/object/public/product-images/abc.png");
    expect(isOwnProductImageUrl("https://rvzapfbifggovccebrjp.supabase.co/storage/v1/object/public/product-images/abc.png", "https://rvzapfbifggovccebrjp.supabase.co", "abc")).toBe(true);
    expect(isOwnProductImageUrl("https://images.samsung.com/a.png", "https://rvzapfbifggovccebrjp.supabase.co", "abc")).toBe(false);
  });

  it("prefers an official photo of this model and drops a different model", () => {
    expect(candidateMentionsModel(samsung, "AR70F12C1FW/FA")).toBe(true);
    expect(candidateMentionsOtherModel(other, "AR70F12C1FW/FA")).toBe(true);
    expect(hostScore("https://pinterest.com/pin/ar70f12c1fw.png", "Samsung")).toBe(-1);
    const ranked = rankImageCandidates([
      { url: "https://pinterest.com/pin/ar70f12c1fw-fa.png", title: "AR70F12C1FW/FA" },
      { url: other, model: "AR50F09C1FW/FA" },
      { url: "https://random.example/ar70f12c1fw-fa.jpg", title: "AR70F12C1FW/FA" },
      { url: samsung, page: "https://www.samsung.com/za/air-conditioners/ar70/", model: "AR70F12C1FW/FA" },
    ], { modelCode: "AR70F12C1FW/FA", brand: "Samsung" });
    expect(ranked.map((row) => row.url)).toEqual([samsung, "https://random.example/ar70f12c1fw-fa.jpg"]);
  });

  it("accepts a phase-suffix model on an official host when the searcher names it", () => {
    const ranked = rankImageCandidates([
      { url: "https://www.midea.com/content/dam/midea/cassette.png", model: "R32-MICAS-48", title: "Midea cassette" },
    ], { modelCode: "R32-MICAS-48 (1PH) + CST-R32-MICOND-48-Q", brand: "Midea" });
    expect(ranked).toHaveLength(1);
  });

  it("does not search again once a photo is linked, rejected, or already tried", () => {
    expect(lookupDecision({ productImageUrl: "https://x/a.png" }).action).toBe("return");
    expect(lookupDecision({ mediaImageUrl: "https://x/a.png" }).action).toBe("link_existing");
    expect(lookupDecision({ sourceUrl: "https://samsung.com/a", needsReview: false }).action).toBe("skip");
    expect(lookupDecision({ sourceUrl: "https://samsung.com/a", needsReview: false }, { retry: true }).action).toBe("search");
    const tried = lookupDecision({ fetchError: "image:no matching photo" });
    const busy = lookupDecision({ fetchError: "image:fetching" });
    expect(tried.action === "skip" && tried.reason).toBe("already_tried");
    expect(busy.action === "skip" && busy.reason).toBe("in_progress");
    expect(lookupDecision({}).action).toBe("search");
  });

  it("reads a gateway image and a transparent png", () => {
    const png = new Uint8Array(30);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    png[25] = 6;
    expect(isAlphaPng(png)).toBe(true);
    expect(isAlphaPng(new Uint8Array([1, 2, 3]))).toBe(false);
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    expect(imageDataUrlFromGateway({ choices: [{ message: { images: [{ image_url: { url: dataUrl } }] } }] })).toBe(dataUrl);
    expect(visionSaysMatch('{"match":true}')).toBe(true);
    expect(visionSaysMatch("not sure")).toBe(false);
  });
});
