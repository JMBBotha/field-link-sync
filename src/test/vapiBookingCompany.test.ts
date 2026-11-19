import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OFFICE_WILL_PHONE_BACK,
  UNROUTED_COMPANY_ID,
  CALL_LEAD_WINDOW_MS,
  bookAppointmentForwardBody,
  bookingCompanyOrRefuse,
  businessLineNumber,
  fillLeadFromCall,
  matchInCallLead,
  phoneRouteArgs,
  storedCallerPhone,
  withVapiCallNote,
  type InCallLead,
} from "../../supabase/functions/_shared/vapiBookingCompany";

const CO = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const OTHER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CALL = "0192a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const NOW = Date.parse("2026-11-19T12:00:00.000Z");

const lead = (over: Partial<InCallLead>): InCallLead => ({
  id: "lead-1",
  company_id: CO,
  customer_phone: "+27821234567",
  customer_name: "Phone Caller",
  customer_address: "Address to be confirmed",
  notes: "Booked by phone",
  created_at: "2026-11-19T11:50:00.000Z",
  ...over,
});

describe("phone booking company resolution", () => {
  it("calls phone_route_company with the business line and assistant, like end-of-call", () => {
    expect(phoneRouteArgs("+27860000000", "asst_mandy")).toEqual({
      p_business_phone: "+27860000000",
      p_assistant_id: "asst_mandy",
    });
    expect(phoneRouteArgs("  ", undefined)).toEqual({
      p_business_phone: null,
      p_assistant_id: null,
    });
    expect(businessLineNumber({ number: "+27860000000" })).toBe("+27860000000");
  });

  it("stamps the routed company and refuses when the line does not resolve", () => {
    expect(bookingCompanyOrRefuse(CO)).toEqual({ companyId: CO });
    expect(bookingCompanyOrRefuse(null)).toEqual({ refuse: OFFICE_WILL_PHONE_BACK });
    expect(bookingCompanyOrRefuse("")).toEqual({ refuse: OFFICE_WILL_PHONE_BACK });
    expect(bookingCompanyOrRefuse(UNROUTED_COMPANY_ID)).toEqual({ refuse: OFFICE_WILL_PHONE_BACK });
    expect(OFFICE_WILL_PHONE_BACK).toContain("office will phone back");
  });

  it("forwards the business line, assistant, and Vapi call id ahead of tool arguments", () => {
    const body = bookAppointmentForwardBody(
      {
        phone_number: "082 123 4567",
        date: "2026-11-20",
        time: "10:00",
        business_phone: "spoof-line",
        assistant_id: "spoof-assistant",
        vapi_call_id: "spoof-call",
      },
      {
        callerPhone: "+27829999999",
        businessPhone: "+27860000000",
        assistantId: "asst_real",
        vapiCallId: CALL,
      },
    );
    expect(body).toMatchObject({
      phone_number: "082 123 4567",
      date: "2026-11-20",
      business_phone: "+27860000000",
      assistant_id: "asst_real",
      vapi_call_id: CALL,
    });
    expect(bookAppointmentForwardBody({ date: "2026-11-20" }, { callerPhone: "+27821234567" })).toMatchObject({
      phone_number: "+27821234567",
      business_phone: null,
      assistant_id: null,
      vapi_call_id: null,
    });
  });

  it("stores the caller phone as +27 so the end-of-call lookup can see it", () => {
    expect(storedCallerPhone("082 123 4567")).toBe("+27821234567");
    expect(storedCallerPhone("+27 82 123 4567")).toBe("+27821234567");
    expect(storedCallerPhone("821234567")).toBe("+27821234567");
  });

  it("resolves the company before any customer or lead insert, and only inside that company", () => {
    const book = readFileSync("supabase/functions/book-appointment/index.ts", "utf8");
    const route = book.indexOf("phone_route_company");
    const refuse = book.indexOf("return fail(companyDecision.refuse)");
    const customerFrom = book.indexOf('from("customers")');
    const leadFrom = book.indexOf('from("leads")');
    expect(route).toBeGreaterThan(0);
    expect(refuse).toBeGreaterThan(route);
    expect(customerFrom).toBeGreaterThan(refuse);
    expect(leadFrom).toBeGreaterThan(refuse);
    expect(book).toContain('.eq("company_id", companyId)');
    expect(book).toContain("company_id: companyId");
    expect(book).not.toContain("openLeads?.[0]?.company_id || customer.company_id");
    expect(book).toContain("withVapiCallNote");

    const vapi = readFileSync("supabase/functions/vapi-server-event/index.ts", "utf8");
    const branch = vapi.indexOf('name === "book_appointment"');
    const forward = vapi.indexOf("bookAppointmentForwardBody", branch);
    expect(forward).toBeGreaterThan(branch);
    expect(vapi).toContain("businessLineNumber(call?.phoneNumber)");
    expect(vapi).toContain("assistantId: call?.assistantId");
    expect(vapi).toContain("vapiCallId: call?.id");
    expect(vapi).toContain("matchInCallLead");
    expect(vapi).toContain("fillLeadFromCall");
    expect(vapi).toContain("CALL_LEAD_WINDOW_MS");
    expect(vapi).not.toContain("10 * 60 * 1000");
  });
});

describe("end-of-call lead dedup", () => {
  it("updates the lead tagged with this Vapi call even when the phone differs", () => {
    const booked = lead({
      id: "booked",
      customer_phone: "0821234567",
      customer_name: "Johan Botha",
      customer_address: "2 Thompson Street, Strand",
      notes: withVapiCallNote("Booked by phone: not cooling", CALL),
      created_at: "2026-11-19T11:40:00.000Z",
    });
    const otherCaller = lead({
      id: "other",
      customer_phone: "+27821234567",
      created_at: "2026-11-19T11:55:00.000Z",
    });
    expect(matchInCallLead([otherCaller, booked], {
      companyId: CO,
      callId: CALL,
      callerPhone: "+27820000000",
      nowMs: NOW,
    })?.id).toBe("booked");
    expect(withVapiCallNote(booked.notes, CALL)).toBe(booked.notes);
  });

  it("matches the same caller within 30 minutes and ignores another company or a null company", () => {
    const recent = lead({ id: "recent", created_at: new Date(NOW - 29 * 60 * 1000).toISOString() });
    const stale = lead({ id: "stale", created_at: new Date(NOW - CALL_LEAD_WINDOW_MS - 1).toISOString() });
    const otherCompany = lead({
      id: "other-co",
      company_id: OTHER,
      notes: `Vapi call: ${CALL}`,
      created_at: new Date(NOW - 60 * 1000).toISOString(),
    });
    const unscoped = lead({
      id: "null-co",
      company_id: null,
      notes: `Vapi call: ${CALL}`,
      customer_phone: "+27821234567",
      created_at: new Date(NOW - 60 * 1000).toISOString(),
    });
    expect(matchInCallLead([stale, otherCompany, unscoped, recent], {
      companyId: CO,
      callId: CALL,
      callerPhone: "082 123 4567",
      nowMs: NOW,
    })?.id).toBe("recent");
    expect(matchInCallLead([stale, otherCompany, unscoped], {
      companyId: CO,
      callId: "different-call-id-0001",
      callerPhone: "+27821234567",
      nowMs: NOW,
    })).toBeNull();
    expect(matchInCallLead([recent], { companyId: null, callId: CALL, callerPhone: "+27821234567", nowMs: NOW })).toBeNull();
    expect(matchInCallLead([recent], {
      companyId: UNROUTED_COMPANY_ID,
      callId: CALL,
      callerPhone: "+27821234567",
      nowMs: NOW,
    })).toBeNull();
  });

  it("fills a placeholder name and address and keeps the booking's own", () => {
    const filled = fillLeadFromCall(
      {
        customer_name: "Phone Caller",
        customer_address: "Address pending — inbound call",
        service_type: "General Inquiry",
        priority: "medium",
        notes: "Booked by phone",
      },
      {
        notes: "Booked by phone\nVapi call: x",
        name: "Johan Botha",
        address: "2 Thompson Street, Strand",
        serviceType: "Technical Service Call",
        priority: "high",
      },
    );
    expect(filled.customer_name).toBe("Johan Botha");
    expect(filled.customer_address).toBe("2 Thompson Street, Strand");
    expect(filled.service_type).toBe("Technical Service Call");
    expect(filled.priority).toBe("high");

    const kept = fillLeadFromCall(
      {
        customer_name: "Johan Botha",
        customer_address: "2 Thompson Street, Strand",
        service_type: "Technical Service Call",
        priority: "normal",
        notes: "Booked by phone",
      },
      {
        notes: "updated",
        name: "Unknown Caller",
        address: "Address to be confirmed",
        serviceType: "General Inquiry",
        priority: "medium",
      },
    );
    expect(kept.customer_name).toBeUndefined();
    expect(kept.customer_address).toBeUndefined();
    expect(kept.service_type).toBeUndefined();
    expect(kept.priority).toBeUndefined();
    expect(kept.notes).toBe("updated");
  });
});
