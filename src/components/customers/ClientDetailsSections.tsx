import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EditableField, EditableNotes, EditableSelect } from "@/components/entity/EditableFields";
import type { WorkAddressFields } from "@/lib/clientAddresses";

export interface ClientDetailValues {
  name: string | null;
  phone: string | null;
  secondary_phone: string | null;
  email: string | null;
  company_name: string | null;
  vat_number: string | null;
  status: string | null;
  notes: string | null;
}

const STATUS = ["lead", "active", "inactive", "archived"].map((v) => ({ value: v, label: v }));

const Section = ({
  testId,
  title,
  hint,
  children,
}: {
  testId: string;
  title: string;
  hint: string;
  children: React.ReactNode;
}) => (
  <section data-testid={testId} className="space-y-3 rounded-xl border bg-muted/30 p-4">
    <div className="flex items-start gap-2">
      <Pencil className="mt-0.5 h-4 w-4 shrink-0 text-[#1590D6]" aria-hidden />
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
    {children}
  </section>
);

/**
 * Private, company, home and work are always rendered together.
 * Client type is not a prop: it must not hide one side.
 */
const ClientDetailsSections = ({
  values,
  homeAddress,
  work,
  savingField,
  savingHome,
  savingWork,
  onSavePrivate,
  onSaveCompanyName,
  onSaveVat,
  onSaveStatus,
  onSaveNotes,
  onSaveHome,
  onSaveWork,
}: {
  values: ClientDetailValues;
  homeAddress: string;
  work: WorkAddressFields;
  savingField?: string | null;
  savingHome?: boolean;
  savingWork?: boolean;
  onSavePrivate: (key: "name" | "phone" | "secondary_phone" | "email", value: string | null) => Promise<any> | void;
  onSaveCompanyName: (value: string | null) => Promise<any> | void;
  onSaveVat: (value: string | null) => Promise<any> | void;
  onSaveStatus: (value: string | null) => Promise<any> | void;
  onSaveNotes: (value: string | null) => Promise<any> | void;
  onSaveHome: (address: string) => Promise<any> | void;
  onSaveWork: (work: WorkAddressFields) => Promise<any> | void;
}) => {
  const [home, setHome] = useState(homeAddress);
  const [workDraft, setWorkDraft] = useState(work);
  const workKey = `${work.line1}|${work.line2}|${work.city}|${work.postal}`;

  useEffect(() => { setHome(homeAddress); }, [homeAddress]);
  useEffect(() => { setWorkDraft(work); }, [workKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setWork = (key: keyof WorkAddressFields, value: string) =>
    setWorkDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-4" data-testid="client-details-sections">
      <p data-testid="client-details-hint" className="text-xs text-muted-foreground">
        Tap a field to edit. Private details, company details, home and work are always shown, whichever client type you pick.
      </p>

      <Section
        testId="client-private-details"
        title="Private details"
        hint="The person. Saving company or VAT does not clear these."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EditableField label="Name" value={values.name} saving={savingField === "name"} showPencil onSave={(v) => onSavePrivate("name", v)} />
          <EditableField label="Phone" value={values.phone} type="tel" saving={savingField === "phone"} showPencil onSave={(v) => onSavePrivate("phone", v)} />
          <EditableField label="Alt phone" value={values.secondary_phone} type="tel" saving={savingField === "secondary_phone"} showPencil onSave={(v) => onSavePrivate("secondary_phone", v)} />
          <EditableField label="Email" value={values.email} type="email" saving={savingField === "email"} showPencil onSave={(v) => onSavePrivate("email", v)} />
        </div>
      </Section>

      <Section
        testId="client-company-details"
        title="Company details"
        hint="Optional. Leave the company name empty for a private client. Invoices use this name with the work address."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EditableField label="Company" value={values.company_name} saving={savingField === "company_name"} showPencil onSave={(v) => onSaveCompanyName(v)} />
          <EditableField label="VAT number" value={values.vat_number} saving={savingField === "vat_number"} showPencil onSave={(v) => onSaveVat(v)} />
        </div>
      </Section>

      <Section
        testId="client-home-address"
        title="Home address"
        hint="Where the person lives. Invoices do not bill to this address."
      >
        <div className="space-y-2">
          <Label htmlFor="client-home-address-input">Address</Label>
          <Input
            id="client-home-address-input"
            data-testid="home-address-input"
            value={home}
            placeholder="Street, suburb, city"
            onChange={(e) => setHome(e.target.value)}
          />
          <Button type="button" size="sm" variant="outline" data-testid="save-home-address" disabled={savingHome} onClick={() => onSaveHome(home)}>
            Save home
          </Button>
        </div>
      </Section>

      <Section
        testId="client-work-address"
        title="Work address"
        hint="Company address. This is what invoices bill to."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="client-work-line1">Address line 1</Label>
            <Input id="client-work-line1" data-testid="work-line1" value={workDraft.line1} onChange={(e) => setWork("line1", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="client-work-line2">Address line 2</Label>
            <Input id="client-work-line2" data-testid="work-line2" value={workDraft.line2} placeholder="Unit, floor, building" onChange={(e) => setWork("line2", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-work-city">City</Label>
            <Input id="client-work-city" data-testid="work-city" value={workDraft.city} onChange={(e) => setWork("city", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="client-work-postal">Postal code</Label>
            <Input id="client-work-postal" data-testid="work-postal" value={workDraft.postal} onChange={(e) => setWork("postal", e.target.value)} />
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" data-testid="save-work-address" disabled={savingWork} onClick={() => onSaveWork(workDraft)}>
          Save work
        </Button>
      </Section>

      <section className="space-y-3 rounded-xl border p-4" data-testid="client-record-fields">
        <h3 className="text-sm font-semibold">Record</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EditableSelect label="Status" value={values.status} saving={savingField === "status"} options={STATUS} onSave={(v) => onSaveStatus(v)} />
          <EditableNotes label="Notes" value={values.notes} saving={savingField === "notes"} className="sm:col-span-2" onSave={(v) => onSaveNotes(v)} />
        </div>
      </section>
    </div>
  );
};

export default ClientDetailsSections;
