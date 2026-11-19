import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  LEAD_EMAIL_ATTEMPTS,
  STAFF_ALERT_FROM_EMAIL,
  STAFF_ALERT_FROM_NAME,
  leadEmailFailedTitle,
  parseTransactionalBody,
  providerErrorMessage,
} from "../../supabase/functions/_shared/leadEmailAlert.ts";

describe("website lead email results", () => {
  it("turns a Resend rejection into a short message and keeps the id on success", () => {
    expect(providerErrorMessage('{"statusCode":422,"name":"validation_error","message":"Invalid `from` field"}'))
      .toBe("Invalid `from` field");
    expect(providerErrorMessage("not json")).toBe("not json");
    const ok = parseTransactionalBody(true, 200, JSON.stringify({ success: true, id: "re_123", provider: "resend" }));
    expect(ok).toEqual({ ok: true, id: "re_123", error: null, status: 200 });
    const bad = parseTransactionalBody(false, 422, JSON.stringify({
      error: "PROVIDER_ERROR",
      provider: "resend",
      status: 422,
      message: "Invalid `from` field",
      details: "{\"message\":\"Invalid `from` field\"}",
    }));
    expect(bad.ok).toBe(false);
    expect(bad.id).toBeNull();
    expect(bad.error).toBe("Invalid `from` field");
    expect(parseTransactionalBody(false, 500, "").error).toBe("Email was not sent (HTTP 500)");
  });

  it("retries once and titles the admin notification with the lead name", () => {
    expect(LEAD_EMAIL_ATTEMPTS).toBe(2);
    expect(STAFF_ALERT_FROM_EMAIL).toBe("johan@0800becool.co.za");
    expect(STAFF_ALERT_FROM_NAME).toBe("0800-BE-COOL");
    expect(leadEmailFailedTitle("Munirah Botha")).toBe("Lead email failed: Munirah Botha");
    expect(leadEmailFailedTitle("  ")).toBe("Lead email failed: Unknown");
  });

  it("logs both kinds, sends the staff alert from Johan, and returns provider errors", () => {
    const receive = readFileSync("supabase/functions/receive-website-lead/index.ts", "utf8");
    const send = readFileSync("supabase/functions/send-transactional-email/index.ts", "utf8");
    const table = readFileSync("supabase/migrations/20261119120000_lead_email_sends.sql", "utf8");
    expect(receive).toContain("from_email: STAFF_ALERT_FROM_EMAIL");
    expect(receive).toContain("from_name: STAFF_ALERT_FROM_NAME");
    expect(receive).toContain("reply_to: email || undefined");
    expect(receive).toContain('kind: "staff_alert"');
    expect(receive).toContain('kind: "client_confirmation"');
    expect(receive).toContain("lead_email_sends");
    expect(receive).toContain("LEAD_EMAIL_ATTEMPTS");
    expect(receive).toContain("leadEmailFailedTitle");
    expect(receive).toContain("notifyLeadEmailFailed");
    expect(send).toContain("providerErrorMessage");
    expect(send).toContain('error: "PROVIDER_ERROR"');
    expect(send).toContain("message,");
    expect(send).toContain('provider: "resend"');
    expect(table).toContain("lead_id");
    expect(table).toContain("recipient");
    expect(table).toContain("subject");
    expect(table).toContain("kind");
    expect(table).toContain("provider_message_id");
    expect(table).toContain("error");
    expect(table).toContain("created_at");
    expect(table).toContain("staff_alert");
    expect(table).toContain("client_confirmation");
    expect(table).toContain("lead_email_sends_admin_read");
    expect(table).toContain("public.is_company_admin(auth.uid(), company_id)");
    expect(table).toContain("public.has_role(auth.uid(), 'admin'::app_role)");
    expect(table).toContain("public.get_user_company_id(auth.uid())");
    expect(table).toContain("lead_email_sends_service_insert");
    expect(table).toContain("FOR INSERT TO service_role");
    expect(table).toContain("GRANT SELECT, INSERT ON public.lead_email_sends TO service_role");
    expect(table).not.toMatch(/FOR INSERT TO authenticated/);
  });
});
