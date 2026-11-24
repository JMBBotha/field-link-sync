import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** WCAG relative luminance + contrast for the dark-mode field colours in index.css. */
function channel(c: number) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance([r, g, b]: [number, number, number]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(fg: [number, number, number], bg: [number, number, number]) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
function hex(value: string): [number, number, number] {
  const n = value.replace("#", "");
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
const fieldStart = css.indexOf("Dark-mode field ink");
const fieldEnd = css.indexOf("Labour editors keep their explicit outline");
const field = css.slice(fieldStart, fieldEnd);

describe("dark mode field ink", () => {
  it("paints typed text, placeholder, caret and autofill light on an opaque field", () => {
    expect(field.startsWith("Dark-mode field ink")).toBe(true);
    expect(field).toContain("background-color: #102033 !important;");
    expect(field).toContain("color: #f2f7fc !important;");
    expect(field).toContain("caret-color: #f2f7fc;");
    expect(field).toContain("color: #d2e0ec !important;");
    expect(field).toContain("-webkit-text-fill-color: #f2f7fc !important;");
    expect(field).toContain("box-shadow: 0 0 0 1000px #102033 inset !important;");
    // Quote paper and the sign-in card keep their own ink.
    for (const skip of [".option1-solid *", ".pdf-page *", ".fl-auth *", ".fl-terms-page *"]) {
      expect(field).toContain(skip);
    }
    // Every declaration that sets the light ink is inside a .dark rule.
    const rules = field.split("}").filter((block) => block.includes("#f2f7fc") || block.includes("#102033") || block.includes("#d2e0ec"));
    expect(rules.length).toBeGreaterThan(0);
    for (const block of rules) expect(block).toContain(".dark");
  });

  it("clears WCAG AA on the dark field, including a dimmer placeholder", () => {
    const fieldBg = hex("#102033");
    expect(contrast(hex("#f2f7fc"), fieldBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex("#d2e0ec"), fieldBg)).toBeGreaterThanOrEqual(4.5);
    // The Clients search bug: dark navy ink on the glassified field.
    expect(contrast(hex("#0F2A44"), fieldBg)).toBeLessThan(4.5);
  });
});
