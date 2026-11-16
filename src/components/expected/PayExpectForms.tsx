import type { CSSProperties, ReactNode } from "react";
import type { DateMode, PayExpectSettings, ProjectExpectOverride, ProjectTiming } from "@/lib/expectedPayDates";

const inputStyle: CSSProperties = {
  minHeight: 40, border: "1px solid rgba(140, 180, 210, .8)", borderRadius: 8, padding: "6px 8px",
  background: "rgba(255,255,255,.9)", color: "#1d3a54", fontSize: 14, width: "100%",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 700, color: "#4e6d86" }}>
      {label}
      {children}
    </label>
  );
}

function Save({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="money-add" onClick={onClick} style={{ background: "#C2410C", color: "#fff" }}>
      {label}
    </button>
  );
}

export function PayExpectSettingsForm({
  value, onChange, onSave,
}: {
  value: PayExpectSettings;
  onChange: (next: PayExpectSettings) => void;
  onSave: () => void;
}) {
  const set = (key: keyof PayExpectSettings, raw: string) => onChange({ ...value, [key]: Number(raw) });
  const num = (key: keyof PayExpectSettings, label: string) => (
    <Field label={label}>
      <input aria-label={label} type="number" min={0} value={value[key]} onChange={(event) => set(key, event.target.value)} style={inputStyle} />
    </Field>
  );
  return (
    <form data-testid="pay-expect-settings" onSubmit={(event) => { event.preventDefault(); onSave(); }} style={{ display: "grid", gap: 10 }}>
      <p style={{ margin: 0, fontSize: 13, color: "#4e6d86" }}>
        A project with several houses uses the project timing. One house uses the normal timing. Days after the invoice also show a window, for example Expected 1 Dec (1 to 6 Dec).
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {num("projectDepositDays", "Project deposit days")}
        {num("projectFinalDays", "Project final days")}
        {num("windowExtraDays", "Window extra days")}
        {num("normalDepositDays", "Normal deposit days")}
        {num("normalFinalDays", "Normal final days")}
        {num("lateGraceDays", "Late after this many days")}
      </div>
      <Save label="Save company timing" onClick={onSave} />
    </form>
  );
}

export function ProjectExpectForm({
  value, houseCount, hint, onChange, onSave, onClear,
}: {
  value: ProjectExpectOverride;
  houseCount: number;
  hint?: string | null;
  onChange: (next: ProjectExpectOverride) => void;
  onSave: () => void;
  onClear: () => void;
}) {
  const automatic = houseCount > 1 ? "Automatic uses the project timing, because this project has several houses." : "Automatic uses the normal timing, because this is a single house.";
  return (
    <form data-testid="pay-expect-project" onSubmit={(event) => { event.preventDefault(); onSave(); }} style={{ display: "grid", gap: 10 }}>
      <p style={{ margin: 0, fontSize: 13, color: "#4e6d86" }}>{houseCount} {houseCount === 1 ? "house" : "houses"}. {automatic}</p>
      {hint && <p data-testid="pay-expect-hint" style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#9a3412" }}>{hint}</p>}
      <Field label="Which timing">
        <select aria-label="Which timing" value={value.timing ?? ""} onChange={(event) => onChange({ ...value, timing: (event.target.value || null) as ProjectTiming | null })} style={inputStyle}>
          <option value="">Automatic</option>
          <option value="project">Project timing</option>
          <option value="normal">Normal job timing</option>
        </select>
      </Field>
      <Field label="Project date rule">
        <select aria-label="Project date rule" value={value.dateMode ?? "days_after"} onChange={(event) => onChange({ ...value, dateMode: event.target.value as DateMode })} style={inputStyle}>
          <option value="days_after">Days after the invoice date</option>
          <option value="day_of_month">A fixed day of the month</option>
          <option value="month_end">The last day of the month</option>
        </select>
      </Field>
      {(value.dateMode ?? "days_after") === "days_after" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <Field label="Deposit days">
            <input aria-label="Deposit days" type="number" min={0} value={value.depositDays ?? ""} placeholder="Company" onChange={(event) => onChange({ ...value, depositDays: event.target.value === "" ? null : Number(event.target.value) })} style={inputStyle} />
          </Field>
          <Field label="Final days">
            <input aria-label="Final days" type="number" min={0} value={value.finalDays ?? ""} placeholder="Company" onChange={(event) => onChange({ ...value, finalDays: event.target.value === "" ? null : Number(event.target.value) })} style={inputStyle} />
          </Field>
          <Field label="Window extra days">
            <input aria-label="Window extra days" type="number" min={0} value={value.windowExtraDays ?? ""} placeholder="Company" onChange={(event) => onChange({ ...value, windowExtraDays: event.target.value === "" ? null : Number(event.target.value) })} style={inputStyle} />
          </Field>
        </div>
      )}
      {(value.dateMode === "day_of_month" || value.dateMode === "month_end") && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {value.dateMode === "day_of_month" && (
            <Field label="Day of the month">
              <input aria-label="Day of the month" type="number" min={1} max={31} value={value.dayOfMonth ?? ""} onChange={(event) => onChange({ ...value, dayOfMonth: event.target.value === "" ? null : Number(event.target.value) })} style={inputStyle} />
            </Field>
          )}
          <Field label="Which month">
            <select aria-label="Which month" value={String(value.monthOffset ?? 0)} onChange={(event) => onChange({ ...value, monthOffset: Number(event.target.value) })} style={inputStyle}>
              <option value="0">The invoice's own month</option>
              <option value="1">The next month</option>
            </select>
          </Field>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Save label="Save project rule" onClick={onSave} />
        <button type="button" onClick={onClear} style={{ minHeight: 44, padding: "8px 14px", borderRadius: 10, border: "1px solid #3D9BE8", background: "#fff", color: "#1d3a54", fontWeight: 700 }}>
          Use automatic
        </button>
      </div>
    </form>
  );
}

export function InvoiceExpectForm({
  deposit, finalOn, onDeposit, onFinal, onSave,
}: {
  deposit: string;
  finalOn: string;
  onDeposit: (value: string) => void;
  onFinal: (value: string) => void;
  onSave: () => void;
}) {
  return (
    <form data-testid="pay-expect-invoice" onSubmit={(event) => { event.preventDefault(); onSave(); }} style={{ display: "grid", gap: 10 }}>
      <p style={{ margin: 0, fontSize: 13, color: "#4e6d86" }}>A date here replaces the company and project timing for this invoice. Clear the date to go back.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Field label="Deposit expected on">
          <input aria-label="Deposit expected on" type="date" value={deposit} onChange={(event) => onDeposit(event.target.value)} style={inputStyle} />
        </Field>
        <Field label="Final expected on">
          <input aria-label="Final expected on" type="date" value={finalOn} onChange={(event) => onFinal(event.target.value)} style={inputStyle} />
        </Field>
      </div>
      <Save label="Save invoice dates" onClick={onSave} />
    </form>
  );
}
