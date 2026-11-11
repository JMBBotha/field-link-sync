/** Demo shots for the sign-up bell and the applications row. Fixture people only — not live staff. */
import { useSearchParams } from "react-router-dom";
import { Bell } from "lucide-react";
import NotificationsList, { notificationHref } from "@/components/notifications/NotificationsList";
import CompanySignupsPanel from "@/components/team/CompanySignupsPanel";

const CREATED = "2026-11-11T14:05:00.000Z";

const INVITE_NOTICE = {
  id: "demo-invite-notice",
  type: "network_applicant",
  title: "New sign-up waiting for approval",
  body: "Demo Invitee (demo.invitee@example.test) was invited as dispatcher / sales.",
  read: false,
  related_id: "demo-invitee",
  created_at: CREATED,
  metadata: {
    full_name: "Demo Invitee",
    email: "demo.invitee@example.test",
    invite_role: "dispatcher",
    invite_lane: "sales",
    source: "team_invite",
    created: CREATED,
  },
};

const staffHref = notificationHref("network_applicant", INVITE_NOTICE.related_id, "admin", INVITE_NOTICE.metadata);

export default function SignupNoticeHarness() {
  const [params] = useSearchParams();
  const shot = params.get("shot") === "panel" ? "panel" : "bell";
  return (
    <div className="min-h-screen bg-[#eef6fb] text-[#0F2A44]" data-testid="signup-notice-harness">
      <header className="flex items-center justify-between px-3 text-white" style={{ height: 48, background: "#3D9BE8" }}>
        <b className="inline-flex items-center gap-2"><Bell className="h-4 w-4" /> Team</b>
        <small className="text-[11px] font-semibold">Demo — harness, not live sign-ups</small>
      </header>
      <div className="mx-auto max-w-md space-y-3 px-3 py-3">
        {shot === "bell" ? (
          <div className="overflow-hidden rounded-xl border bg-white shadow-sm" data-testid="bell-approval-item">
            <NotificationsList
              notifications={[INVITE_NOTICE]}
              onMarkAsRead={() => {}}
              onMarkAllRead={() => {}}
              onClose={() => {}}
              role="admin"
            />
            <p className="border-t px-4 py-2 text-sm font-medium" data-testid="bell-target">
              Opens {staffHref === "/admin/team?tab=staff" ? "Team → Staff" : staffHref}
            </p>
          </div>
        ) : (
          <div data-testid="signup-panel-shot">
            <CompanySignupsPanel
              previewRows={[
                {
                  id: "demo-invitee",
                  full_name: "Demo Invitee",
                  signup_role: "company_new",
                  notice: {
                    email: "demo.invitee@example.test",
                    full_name: "Demo Invitee",
                    invite_role: "dispatcher",
                    invite_lane: "sales",
                    source: "team_invite",
                  },
                },
                {
                  id: "demo-founder",
                  full_name: "Demo Founder",
                  signup_role: "company_new",
                  signup_company: "Harness Air",
                  notice: {
                    email: "demo.founder@example.test",
                    full_name: "Demo Founder",
                    signup_role: "company_new",
                    source: "public_signup",
                  },
                },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}
