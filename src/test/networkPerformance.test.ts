import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { rand, winRate } from "@/components/settings/NetworkPerformanceCard";

describe("P7 network performance", () => {
  it("formats totals", () => {
    expect(rand(14109.12)).toMatch(/^R 14.109$/);
    expect(winRate({ win_rate: 33 })).toBe("33%");
    expect(winRate({ win_rate: null })).toBe("–");
  });
  it("card is gated to master admins and the network card reads names via the server", () => {
    const card = readFileSync("src/components/settings/NetworkPerformanceCard.tsx", "utf8");
    expect(card).toMatch(/if \(!canWrite\) return null;/);
    const members = readFileSync("src/components/settings/NetworkMembersCard.tsx", "utf8");
    expect(members).toMatch(/network_company_names/);
  });
});
