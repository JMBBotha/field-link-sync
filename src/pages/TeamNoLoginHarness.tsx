/** Demo shots for Add technician (no invite). Fixture names only — not live staff. */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AddTechnicianNoInviteDialog, NoLoginBadge } from "@/components/team/AddTechnicianNoInviteDialog";
import { HARNESS_NO_LOGIN_TECHS } from "@/lib/noLoginTechnician";

export default function TeamNoLoginHarness() {
  const [params] = useSearchParams();
  const desktop = params.get("w") === "desktop";
  const [name, setName] = useState("Abie Croy");
  const [phone, setPhone] = useState("");
  const width = desktop ? 960 : 390;
  return (
    <div className="min-h-screen bg-[#eef6fb] text-[#0F2A44]" data-testid="team-nologin-harness">
      <header className="flex items-center justify-between px-3 text-white" style={{ height: 48, background: "#3D9BE8" }}>
        <b>Team</b>
        <small className="text-[11px] font-semibold">Demo — harness, not live staff</small>
      </header>
      <div className="mx-auto space-y-3 px-3 py-3" style={{ width, maxWidth: "100%" }}>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-md px-3 py-2 text-sm font-semibold text-white" style={{ background: "#C2410C" }}>
            Invite Member
          </button>
          <button type="button" className="rounded-md px-3 py-2 text-sm font-semibold text-white" style={{ background: "#C2410C" }} data-testid="add-technician-no-invite">
            Add technician (no invite)
          </button>
        </div>
        <ul className="space-y-2 rounded-2xl bg-white p-3 shadow-sm">
          {HARNESS_NO_LOGIN_TECHS.map((tech) => (
            <li key={tech.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 font-medium">{tech.name} <NoLoginBadge /></span>
              <span className="text-muted-foreground">No login yet</span>
            </li>
          ))}
        </ul>
      </div>
      <AddTechnicianNoInviteDialog
        open
        onOpenChange={() => {}}
        name={name}
        phone={phone}
        onName={setName}
        onPhone={setPhone}
        pending={false}
        duplicates={[]}
        confirmDuplicate={false}
        onConfirmDuplicate={() => {}}
        onSubmit={() => {}}
      />
    </div>
  );
}
