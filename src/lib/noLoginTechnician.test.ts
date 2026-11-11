import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MASSAIR_CT_ID } from "@/lib/adminHomeCount";
import {
  DEVICE_ALERT_RULES,
  HARNESS_NO_LOGIN_TECHS,
  decideAdminCompanyAccess,
  decideLinkLogin,
  duplicateNameBlock,
  expectsDeviceChannel,
  noLoginEmail,
  skipDeviceAlert,
  takesLiveOffer,
  validateTechnicianName,
} from "@/lib/noLoginTechnician";

const CT = MASSAIR_CT_ID;
const OTHER = "00000000-0000-4000-8000-000000000099";
const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261111153000_no_login_technicians.sql"), "utf8");
const addFn = readFileSync(resolve(__dirname, "../../supabase/functions/add-technician-no-invite/index.ts"), "utf8");
const linkFn = readFileSync(resolve(__dirname, "../../supabase/functions/link-technician-login/index.ts"), "utf8");
const team = readFileSync(resolve(__dirname, "../pages/admin/AdminTeamPage.tsx"), "utf8");

describe("add technician without invite", () => {
  const admin = { userId: "johan", roles: ["admin"], companyId: CT };

  it("refuses anyone who is not a signed-in company admin", () => {
    expect(decideAdminCompanyAccess({ userId: null, roles: [], companyId: null })).toMatchObject({ ok: false, status: 401 });
    expect(decideAdminCompanyAccess({ ...admin, userId: null })).toMatchObject({ ok: false, status: 401 });
    expect(decideAdminCompanyAccess({ ...admin, serviceRole: true })).toMatchObject({ ok: false, status: 403 });
    expect(decideAdminCompanyAccess({ ...admin, roles: ["dispatcher"] })).toMatchObject({ ok: false, status: 403 });
    expect(decideAdminCompanyAccess({ ...admin, roles: ["field_agent"] })).toMatchObject({ ok: false, status: 403 });
    expect(decideAdminCompanyAccess({ ...admin, companyId: null })).toMatchObject({ ok: false, status: 403 });
    expect(decideAdminCompanyAccess(admin)).toEqual({ ok: true, companyId: CT });
  });

  it("keeps the technician inside the caller's company", () => {
    expect(decideAdminCompanyAccess({ ...admin, requestedCompanyId: OTHER })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(decideAdminCompanyAccess({ ...admin, requestedCompanyId: CT })).toEqual({ ok: true, companyId: CT });
    expect(decideAdminCompanyAccess(admin)).toMatchObject({ ok: true, companyId: CT });
  });

  it("blocks a duplicate name in the company unless the admin confirms", () => {
    const existing = [
      { id: "abie", full_name: "Abie Croy", archived_at: null },
      { id: "old", full_name: "Abie Croy", archived_at: "2026-01-01" },
      { id: "other", full_name: "George King", archived_at: null },
    ];
    const blocked = duplicateNameBlock("  abie   croy ", existing, false);
    expect(blocked.blocked).toBe(true);
    if (blocked.blocked) expect(blocked.matches.map((row) => row.id)).toEqual(["abie"]);
    expect(duplicateNameBlock("Abie Croy", existing, true).blocked).toBe(false);
    expect(duplicateNameBlock("George  King", existing, false).blocked).toBe(true);
    expect(duplicateNameBlock("New Tech", existing, false).blocked).toBe(false);
    expect(validateTechnicianName("Abie Croy")).toEqual({ ok: true, name: "Abie Croy" });
    expect(validateTechnicianName(" ").ok).toBe(false);
  });

  it("excludes no-login technicians from live offers and device alerts", () => {
    const abie = { no_login: true, dispatch_active: true, archived_at: null };
    const loggedIn = { no_login: false, dispatch_active: true, archived_at: null };
    expect(takesLiveOffer(abie)).toBe(false);
    expect(takesLiveOffer(loggedIn)).toBe(true);
    expect(expectsDeviceChannel(abie)).toBe(false);
    expect(expectsDeviceChannel(loggedIn)).toBe(true);
    for (const rule of DEVICE_ALERT_RULES) expect(skipDeviceAlert(abie, rule)).toBe(true);
    expect(skipDeviceAlert(loggedIn, "no_en_route")).toBe(false);
    expect(skipDeviceAlert(abie, "office_note")).toBe(false);

    expect(sql).toContain("coalesce(p.no_login, false) = false");
    expect(sql.match(/coalesce\(p\.no_login, false\) = false/g)?.length).toBeGreaterThanOrEqual(2);
    expect(sql).toContain("skip_nologin_offer");
    expect(sql).toContain("skip_nologin_request_offer");
    expect(sql).toContain("skip_nologin_device_alert");
    expect(sql).toContain("skip_nologin_push");
    expect(sql).toContain("skip_nologin_notification");
    expect(sql).toContain("block_nologin_location_write");
    expect(sql).toContain("freeze_nologin_location");
    for (const rule of ["no_en_route", "not_started", "not_accepted", "not_accepted_urgent", "not_finished"]) {
      expect(sql).toContain(`'${rule}'`);
    }
    expect(sql).not.toContain("CREATE OR REPLACE FUNCTION public._p3_is_tech");
    expect(sql).toContain("OR COALESCE((SELECT p.no_login FROM public.profiles p WHERE p.id = t.id), false)");
    expect(sql).toContain("no_login_technician");
    expect(sql).toContain("public.rh_ops_ok(company_id)");
    expect(sql).toContain("public._person_bookings");
  });

  it("keeps every other line of the replaced live functions", () => {
    const live = readFileSync(resolve(__dirname, "../test/fixtures/noLoginLiveFunctions.sql"), "utf8");
    const grab = (src: string, name: string) => {
      const match = src.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\b[\\s\\S]*?\\$function\\$;`));
      if (!match) throw new Error(`missing ${name}`);
      return match[0];
    };
    const strip = (name: string, body: string) => {
      if (name.startsWith("find_dispatch_candidates")) {
        return body.replace("    AND coalesce(p.no_login, false) = false\n", "");
      }
      if (name === "dispatchable_technicians") {
        return body.replace(
          "    AND (public.staff_is_available(t.id) OR COALESCE((SELECT p.no_login FROM public.profiles p WHERE p.id = t.id), false))\n",
          "    AND public.staff_is_available(t.id)\n",
        );
      }
      if (name === "fl_alert_deliver") {
        return body.replace(
          "  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user AND coalesce(p.no_login, false)) THEN\n    RETURN NULL;\n  END IF;\n",
          "",
        );
      }
      return body.replace(/  IF coalesce\(NEW\.raw_app_meta_data->>'provision', ''\) = 'no_login_technician' THEN[\s\S]*?  END IF;\n\n/, "");
    };
    for (const name of [
      "find_dispatch_candidates_multi",
      "find_dispatch_candidates",
      "dispatchable_technicians",
      "fl_alert_deliver",
      "handle_new_user",
    ]) {
      expect(strip(name, grab(sql, name)), name).toBe(grab(live, name));
    }
  });

  it("creates one auth user with a non-deliverable email and no password, and links login onto that same id", () => {
    expect(noLoginEmail("abc")).toBe("tech+abc@no-login.fieldlynk.invalid");
    expect(addFn).toContain("decideAdminCompanyAccess");
    expect(addFn).toContain("duplicateNameBlock");
    expect(addFn).toContain("email_confirm: true");
    expect(addFn).toContain("createUser");
    expect(addFn).toContain('ban_duration: "876000h"');
    expect(addFn).not.toContain("signInWithOtp");
    expect(addFn).not.toMatch(/password\s*:/);
    expect(linkFn).toContain("decideLinkLogin");
    expect(linkFn).toContain("updateUserById");
    expect(linkFn).not.toContain("createUser");
    expect(linkFn).not.toContain("signInWithOtp");
    const linked = decideLinkLogin({
      callerCompanyId: CT,
      target: { id: "abie", company_id: CT, no_login: true },
      email: "abie@example.com",
      emailOwnerId: null,
    });
    expect(linked).toMatchObject({ ok: true, profileId: "abie", createsUser: false });
    expect(decideLinkLogin({
      callerCompanyId: CT,
      target: { id: "abie", company_id: OTHER, no_login: true },
      email: "abie@example.com",
      emailOwnerId: null,
    }).ok).toBe(false);
    expect(decideLinkLogin({
      callerCompanyId: CT,
      target: { id: "abie", company_id: CT, no_login: true },
      email: "taken@example.com",
      emailOwnerId: "someone-else",
    })).toMatchObject({ ok: false, status: 409 });
  });

  it("puts the dialog, the No login badge, and the later invite on the Team page", () => {
    expect(team).toContain('data-testid="add-technician-no-invite"');
    expect(team).toContain("Add technician (no invite)");
    expect(team).toContain("No login yet");
    expect(team).toContain('data-testid="send-login-invite"');
    expect(team).toContain("shouldCreateUser: false");
    expect(team).toContain("add-technician-no-invite");
    expect(team).toContain("link-technician-login");
    expect(HARNESS_NO_LOGIN_TECHS.map((tech) => tech.name)).toEqual(["Abie Croy", "George King"]);
    expect(readFileSync(resolve(__dirname, "../pages/BookJobHarness.tsx"), "utf8")).toContain("HARNESS_NO_LOGIN_TECHS");
  });
});
