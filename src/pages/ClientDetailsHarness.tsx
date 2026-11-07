import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Mail, Phone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ClientDetailsSections from "@/components/customers/ClientDetailsSections";
import { ClientRowEditButton, EditClientButton } from "@/components/customers/EditClientButton";
import type { WorkAddressFields } from "@/lib/clientAddresses";

const PERSON = {
  name: "Johan Botha",
  phone: "082 000 0000",
  secondary_phone: "021 000 0000",
  email: "johan@example.com",
  company_name: "Botha Air (Pty) Ltd",
  vat_number: "4123456789",
  status: "active",
  notes: "Gate code is on the work buzzer.",
};

const WORK: WorkAddressFields = {
  line1: "14 Industry Road",
  line2: "Unit 3",
  city: "Cape Town",
  postal: "8001",
};

/**
 * Signed-out fixture for the client edit screen. Dev only.
 * Client type can change; the four detail areas stay on screen.
 */
export default function ClientDetailsHarness() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<"header" | "details">(params.get("view") === "details" ? "details" : "header");
  const [clientType, setClientType] = useState("private");
  const [saved, setSaved] = useState("Nothing saved yet.");

  return (
    <div className="mx-auto max-w-6xl space-y-4 bg-background p-4 md:p-6" data-testid="client-details-harness">
      <p className="text-xs text-muted-foreground">Preview fixture. Not a live client. Nothing here is saved.</p>

      <div className="rounded-2xl bg-gradient-to-br from-[#0F2A44] to-[#1590D6] p-4 text-white sm:p-5" data-testid="harness-client-header">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold leading-tight sm:text-2xl">Johan Botha</h1>
            <p className="mt-1 text-sm text-[#CFE6F6]">Private · Website</p>
            <p className="mt-0.5 text-sm text-[#CFE6F6]">082 000 0000 · johan@example.com · 14 Industry Road, Unit 3, Cape Town, 8001</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <a href="tel:0820000000" className="inline-flex items-center gap-1 rounded-xl bg-white/15 px-3 py-2 text-sm hover:bg-white/25"><Phone className="h-4 w-4" /> Call</a>
            <a href="mailto:johan@example.com" className="inline-flex items-center gap-1 rounded-xl bg-white/15 px-3 py-2 text-sm hover:bg-white/25"><Mail className="h-4 w-4" /> Email</a>
            <EditClientButton onClick={() => setTab("details")} />
            <Button type="button" className="rounded-xl bg-[#F7941D] text-white hover:bg-[#e08310]"><Plus className="h-4 w-4" /> New quote</Button>
            <Button type="button" aria-label="More actions" className="rounded-xl bg-white/15 px-3 text-white hover:bg-white/25">⋯</Button>
          </div>
        </div>
      </div>

      {tab === "header" && (
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">Open Edit details to see private, company, home and work together.</p>
        </div>
      )}

      {tab === "details" && (
        <div className="rounded-2xl border bg-card p-6" data-testid="harness-details">
          <div className="mb-4 max-w-xs space-y-1.5">
            <Label className="text-xs text-muted-foreground">Client type</Label>
            <Select value={clientType} onValueChange={setClientType}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="private">Private</SelectItem>
                <SelectItem value="company">Company</SelectItem>
                <SelectItem value="developer">Developer</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Changing this does not hide private or company details.</p>
          </div>
          <ClientDetailsSections
            values={PERSON}
            homeAddress="9 Oak Lane, Durbanville"
            work={WORK}
            onSavePrivate={(key, value) => setSaved(`Private ${key} = ${value ?? ""}`)}
            onSaveCompanyName={(value) => setSaved(`Company = ${value ?? ""} (private fields unchanged)`)}
            onSaveVat={(value) => setSaved(`VAT = ${value ?? ""}`)}
            onSaveStatus={(value) => setSaved(`Status = ${value ?? ""}`)}
            onSaveNotes={(value) => setSaved(`Notes = ${value ?? ""}`)}
            onSaveHome={(address) => setSaved(`Home location = ${address}`)}
            onSaveWork={(work) => setSaved(`Work billing = ${work.line1}, ${work.city} ${work.postal}`)}
          />
          <p className="mt-3 text-xs text-muted-foreground" data-testid="harness-saved">{saved}</p>
        </div>
      )}

      <div className="rounded-2xl border bg-card p-4" data-testid="harness-client-list">
        <p className="mb-2 text-sm font-semibold">Clients</p>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-t py-2.5 text-sm">
          <div className="min-w-0">
            <p className="truncate font-semibold">Johan Botha</p>
            <p className="truncate text-xs text-muted-foreground">Private · Cape Town</p>
          </div>
          <span className="text-muted-foreground">R 0</span>
          <ClientRowEditButton name="Johan Botha" onClick={() => setTab("details")} />
        </div>
      </div>
    </div>
  );
}
