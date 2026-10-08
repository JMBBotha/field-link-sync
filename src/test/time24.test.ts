import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const SKIP = join(ROOT, "components", "mandy");
const NATIVE = 'type="' + 'time"';
const TWELVE = [/h:mm a/, / a["']/];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (p.startsWith(SKIP)) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

describe("24-hour times everywhere", () => {
  const files = walk(ROOT);
  it("no native time inputs outside Mandy", () => {
    const bad = files.filter((f) => readFileSync(f, "utf8").includes(NATIVE));
    expect(bad).toEqual([]);
  });
  it("no 12-hour date-fns formats outside Mandy", () => {
    const bad = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /format\(/.test(src) && src.split("\n").some((l) => /format\(/.test(l) && TWELVE.some((r) => r.test(l)));
    });
    expect(bad).toEqual([]);
  });
});
