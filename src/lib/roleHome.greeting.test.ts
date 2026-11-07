import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { ADMIN_HOME_ROUTES, greetingEyebrow, greetingTitle, johannesburgHour } from "@/lib/roleHome";
import { countAdminHome, MASSAIR_CT_ID } from "@/lib/adminHomeCount";

describe("admin home greeting", () => {
  it("uses Johannesburg time of day plus the signed-in first name", () => {
    const afternoon = new Date("2026-11-07T15:33:00Z");
    expect(johannesburgHour(afternoon)).toBe(17);
    expect(greetingTitle(afternoon, "Johan Botha")).toBe("Good afternoon, Johan");
    expect(greetingTitle(afternoon, "Johan Admin")).toBe("Good afternoon, Johan");
    expect(greetingEyebrow(afternoon)).toBe("SATURDAY, 07 NOV");
    expect(greetingTitle(new Date("2026-11-07T04:00:00Z"), "Johan")).toBe("Good morning, Johan");
    expect(greetingTitle(new Date("2026-11-07T16:00:00Z"), "Johan")).toBe("Good evening, Johan");
    expect(greetingTitle(afternoon, "  ")).toBe("Good afternoon");
  });
});

describe("admin home routes", () => {
  it("points Review & send at the draft list and keeps the other cards on real routes", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const counts = countAdminHome({
      companyId: MASSAIR_CT_ID,
      now: new Date("2026-11-07T15:33:00Z"),
      invoices: [{ id: "inv", company_id: MASSAIR_CT_ID, status: "draft", grand_total: 76426.79, invoice_number: "0010016", customer_name: "Sample" }],
    });
    expect(counts.waiting.actionLabel).toBe("Review & send");
    expect(counts.waiting.actionHref).toBe(ADMIN_HOME_ROUTES.reviewSend);
    expect(ADMIN_HOME_ROUTES.reviewSend).toBe("/admin/invoices?state=draft");
    for (const path of [ADMIN_HOME_ROUTES.jobs, ADMIN_HOME_ROUTES.map, "/admin/invoices", ADMIN_HOME_ROUTES.stock, ADMIN_HOME_ROUTES.cash, "/admin/schedule"]) {
      const leaf = path.split("?")[0].replace(/^\/admin\//, "");
      expect(app.includes(`path="${path.split("?")[0]}"`) || app.includes(`path="${leaf}"`), path).toBe(true);
    }
    expect(ADMIN_HOME_ROUTES.bookJob).toBe("/admin/jobs?new=1");
    expect(ADMIN_HOME_ROUTES.job("abc")).toBe("/admin/jobs/abc");
    const home = readFileSync("src/components/v8/roleHome/LiveHomes.tsx", "utf8");
    expect(home).toContain("greetingTitle(now, identity?.name)");
    expect(home).toContain("onReview={() => navigate(counts?.waiting.actionHref || ADMIN_HOME_ROUTES.reviewSend)");
    expect(home).not.toContain("invoice_email");
    expect(home).not.toContain(".from(\"invoices\").update");
    const page = readFileSync("src/pages/admin/AdminHomePage.tsx", "utf8");
    expect(page).toContain("hideGreeting");
    expect(page).toContain("hideInvoiceBanner");
    const lower = readFileSync("src/components/v8/V8RoleHome.tsx", "utf8");
    expect(lower).toContain("!hideGreeting");
    expect(lower).toContain("!hideInvoiceBanner");
    const jobs = readFileSync("src/components/jobs/calm/JobsCalm.tsx", "utf8");
    expect(jobs).toContain('sp.get("new")');
    expect(jobs).toContain("CreateJobDialog");
  });
});
