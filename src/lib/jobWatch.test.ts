import { describe, expect, it } from "vitest";
import { clampWatch, DEFAULT_JOB_WATCH, driveMinutesEstimate, enRouteLeadMinutes, leaveBy, looksLikeEmail, planText, smsHref, TELL_CLIENT_RULES, WATCH_RULE_LABEL } from "./jobWatch";

const CBD = { lat: -33.9249, lng: 18.4241 };
const BELLVILLE = { lat: -33.9002, lng: 18.6292 };

describe("job watch (a2)", () => {
  it("estimates drive time from addresses like the SQL (CBD -> Bellville = 36 min)", () => {
    expect(driveMinutesEstimate(CBD, BELLVILLE)).toBe(36);
    expect(driveMinutesEstimate(CBD, CBD)).toBe(5);
    expect(driveMinutesEstimate(CBD, { lat: null, lng: null })).toBeNull();
    expect(driveMinutesEstimate(null, CBD)).toBeNull();
  });
  it("lead = max(drive + 15, 20), 60 when unknown", () => {
    expect(enRouteLeadMinutes(36)).toBe(51);
    expect(enRouteLeadMinutes(5)).toBe(20);
    expect(enRouteLeadMinutes(null)).toBe(60);
    expect(enRouteLeadMinutes(5, { ...DEFAULT_JOB_WATCH, en_route_buffer_minutes: 10, en_route_floor_minutes: 30 })).toBe(30);
    expect(enRouteLeadMinutes(null, { ...DEFAULT_JOB_WATCH, en_route_fallback_minutes: 45 })).toBe(45);
  });
  it("leave-by and plan text in SAST", () => {
    const lb = leaveBy("2026-10-23T08:00:00+02:00", 51);
    expect(lb.toISOString()).toBe("2026-10-23T05:09:00.000Z");
    expect(planText({ drive_minutes: 36, drive_from: "home base", fallback: false, lead_minutes: 51, leave_by: lb.toISOString() })).toBe("Leave by 07:09 (~36 min drive from home base)");
    expect(planText({ drive_minutes: null, drive_from: "none", fallback: true, lead_minutes: 60, leave_by: "2026-10-23T06:00:00Z" })).toBe("Leave by 08:00 (no drive estimate, 60-min default)");
    expect(planText(null)).toBeNull();
  });
  it("settings are clamped to the DB limits", () => {
    expect(clampWatch("late_checkin_minutes", 2)).toBe(5);
    expect(clampWatch("en_route_floor_minutes", "25")).toBe(25);
    expect(clampWatch("en_route_fallback_minutes", "x")).toBe(60);
  });
  it("labels and tell-client rules", () => {
    expect(WATCH_RULE_LABEL.no_en_route).toMatch(/At risk/);
    expect(WATCH_RULE_LABEL.not_started).toMatch(/Late/);
    expect(TELL_CLIENT_RULES.has("no_en_route")).toBe(true);
    expect(TELL_CLIENT_RULES.has("not_accepted")).toBe(false);
  });
  it("SMS goes through the office phone's SMS app, never WhatsApp", () => {
    const h = smsHref("082 000 0000", "Running late & sorry");
    expect(h).toBe("sms:0820000000?&body=Running%20late%20%26%20sorry");
    expect(h).not.toMatch(/wa\.me|whatsapp/i);
    expect(looksLikeEmail("a@b.co")).toBe(true);
    expect(looksLikeEmail("nope")).toBe(false);
  });
});
