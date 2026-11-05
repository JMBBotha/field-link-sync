// Screenshot harness, dummy data only. Not shipped. The stub blocks every live call.
import "./harnessStockStub";
import "./index.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/toaster";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { ReceiveForm, type PendingDoc } from "@/components/stock/ReceiveSupplierDocDialog";
import ReceiveSupplierDocDialog from "@/components/stock/ReceiveSupplierDocDialog";
import ReceivePreviewTable from "@/components/stock/ReceivePreviewTable";
import { MaterialsCard } from "@/components/stock/JobMaterialsDrawdown";
import TechUnitSerials from "@/components/stock/TechUnitSerials";
import AdminSupplierDocsPage from "@/pages/admin/AdminSupplierDocsPage";
import AdminStockCountPage from "@/pages/admin/AdminStockCountPage";
import { sb } from "@/components/supplierDocs/api";
import { buildPreview, normaliseModel, withBucket, type PreviewRow, type Product } from "@/lib/stockReceive";
import { buildDrawPlan, toDrawPayload } from "@/lib/materialsDrawdown";
import { CO, products as catalogue, view } from "./harnessStockStub";

const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <BrowserRouter>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          {children}
          <Toaster />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

function Step({ n, text }: { n: string; text: string }) {
  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950">
      <span className="font-semibold">Checklist {n} · test harness.</span> {text}
    </div>
  );
}

const priced: PendingDoc["lines"] = [
  { line_no: 1, description: "IN - TEST MIDWALL INVERTER 24000", model_number: "FCMI-24-P", qty: 1, unit_price_excl: 10900 },
  { line_no: 2, description: "OUT - TEST MIDWALL INVERTER 24000", model_number: "FCMI-24X-P", qty: 1, unit_price_excl: 10900 },
  { line_no: 3, description: "TEST SPARE 18000", model_number: "SPARE-18", qty: 1, unit_price_excl: 4200 },
  { line_no: 4, description: "GAS - R410 DISP 11.3KG", model_number: "G005", qty: 2, unit_price_excl: 2190 },
];

function ReceiveDialog({ pending }: { pending: PendingDoc }) {
  return <ReceiveSupplierDocDialog open onOpenChange={() => {}} companyId={CO} pending={pending} />;
}

function Count({ n, text }: { n: string; text: string }) {
  return (
    <Shell>
      <Step n={n} text={text} />
      <AdminStockCountPage />
    </Shell>
  );
}

function CreditShot() {
  const jobs = [{ id: "j1", label: "Install · job j1" }, { id: "j2", label: "Service · job j2" }];
  const products = catalogue as Product[];
  const [credit, setCredit] = useState<PreviewRow[]>(() =>
    buildPreview("credit_note", [{ line_no: 1, description: "IN - TEST MIDWALL INVERTER 24000", model_number: "FCMI-24-P", qty: 1, unit_price_excl: 10900 }], products, [], "j1")
      .map((r) => withBucket({ ...r, serial_no: "SA" })),
  );
  const [again, setAgain] = useState<PreviewRow[]>(() =>
    buildPreview("delivery_note", [{ line_no: 1, description: "IN - TEST MIDWALL INVERTER 24000", model_number: "FCMI-24-P", qty: 1, unit_price_excl: null }], products, [], "j1")
      .map((r) => withBucket({ ...r, serial_no: "SA" })),
  );
  const refuse = async () => {
    const { error } = await sb.rpc("sjd_receive", { p_document: "00000000-0000-0000-0000-00000000ddc2", p_lines: [{ qty_packs: 2, serial_no: "SA" }] });
    if (error) toast({ title: "Not saved", description: error.message, variant: "destructive" });
  };
  return (
    <Shell>
      <Step n="6" text="Test credit TST-CN-SA for serial SA only. A credit of 2 is refused. Serial SA can be received again." />
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <div className="space-y-3 rounded-2xl border bg-background p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Confirm credit note TST-CN-SA</h2>
          <p className="text-xs text-muted-foreground">One serial on this line. The return is for SA only. Other serials on the same line stay.</p>
          <ReceiveForm docType="credit_note" setDocType={() => {}} docNo="TST-CN-SA" setDocNo={() => {}} poNo="TST-SO0099" setPoNo={() => {}} supplier="Test Supplies" setSupplier={() => {}} file={null} setFile={() => {}} onRead={() => {}} busy={null} />
          <ReceivePreviewTable rows={credit} jobs={jobs} isInvoice onChange={(i, patch) => setCredit((rs) => rs.map((r, k) => (k === i ? withBucket({ ...r, ...patch }) : r)))} />
          <div className="flex justify-end"><Button data-testid="refuse-credit" variant="destructive" onClick={refuse}>Confirm credit of 2</Button></div>
        </div>
        <div className="space-y-3 rounded-2xl border bg-background p-4 shadow-sm">
          <h2 className="text-lg font-semibold">Receive serial SA again</h2>
          <p className="text-xs text-muted-foreground">Returned serial SA is free to receive on a new test delivery note. Serial SB was not returned.</p>
          <ReceivePreviewTable rows={again} jobs={jobs} isInvoice={false} onChange={(i, patch) => setAgain((rs) => rs.map((r, k) => (k === i ? withBucket({ ...r, ...patch }) : r)))} />
        </div>
      </div>
    </Shell>
  );
}

function TechBefore() {
  return (
    <Shell>
      <Step n="8" text="Tech job sheet. Serial only — no prices on this card. Stock value below is the unit at the invoice cost (R100 received + R30 invoice difference = R130) before finish." />
      <div className="mx-auto max-w-3xl space-y-4 p-4">
        <TechUnitSerials jobId="j1" />
        <AdminStockCountPage />
      </div>
    </Shell>
  );
}

const P = (id: string, product_code: string, name: string, cost_price: number, extra: Partial<Product> = {}): Product => ({ id, product_code, name, short_name: name, cost_price, price_per_unit_label: "each", product_type: "material", ...extra });
const legacyProducts: Product[] = [
  P("p1", "FCMI-24", "Test Midwall 24K pair", 10434.09, { product_type: "ac_unit" }),
  P("p2", "G005", "GAS - R410 DISP 11.3KG", 2260),
  P("p3", "CU-14-15", "Copper pipe 1/4 15m coil", 610),
  P("p4", "INS-14", "Pipe insulation 1/4", 18),
  P("p5", "TAPE-PVC", "PVC duct tape", 32),
];
const legacyLines = [
  { line_no: 1, description: "IN - TEST MIDWALL INVERTER 24000", model_number: "FCMI-24-P", qty: 1, unit_price_excl: view === "dn" ? null : 10900 },
  { line_no: 2, description: "OUT - TEST MIDWALL INVERTER 24000", model_number: "FCMI-24X-P", qty: 1, unit_price_excl: view === "dn" ? null : 10900 },
  { line_no: 3, description: "GAS - R410 DISP 11.3KG", model_number: "G005", qty: 2, unit_price_excl: view === "dn" ? null : 2190 },
  { line_no: 4, description: "COPPER 1/4 15M", model_number: "CU-14-15", qty: 3, unit_price_excl: view === "dn" ? null : 610 },
  { line_no: 5, description: "TEST LITE MIDWALL 12000", model_number: "FCMI-L-12", qty: 1, unit_price_excl: view === "dn" ? null : 6200 },
];

function LegacyReceive() {
  const docType = view === "dn" ? "delivery_note" : "supplier_invoice";
  const earlier = view === "inv" ? [{ product_id: "p1", normalised: normaliseModel("FCMI-24"), unit_cost_excl: 10434.09, receive_action: "reserve", receive_job_id: "j1" }] : [];
  const [rows, setRows] = useState(() => buildPreview(docType, legacyLines, legacyProducts, earlier, view === "dn" ? "j1" : null));
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="space-y-4 rounded-2xl border bg-background p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Receive delivery note / invoice</h2>
        <ReceiveForm docType={docType} setDocType={() => {}} docNo={view === "dn" ? "TST-DN0001" : "TST-INV0042"} setDocNo={() => {}} poNo="TST-SO0099" setPoNo={() => {}} supplier="Test Supplies" setSupplier={() => {}} file={null} setFile={() => {}} onRead={() => {}} busy={null} />
        <ReceivePreviewTable rows={rows} jobs={[{ id: "j1", label: "Install · job j1" }, { id: "j2", label: "Service · job j2" }]} isInvoice={docType === "supplier_invoice"} onChange={(i, patch) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))} />
        <div className="flex justify-end gap-2"><Button variant="outline">Back</Button><Button>{docType === "supplier_invoice" ? "Confirm and add stock" : "Confirm delivery note"}</Button></div>
      </div>
    </div>
  );
}

function Draw() {
  const items = [
    { quote_item_id: "q1", product_id: "p1", item_name: "Test Midwall 24K", quantity: 1, product: legacyProducts[0] },
    { quote_item_id: "q2", product_id: "p3", item_name: "Copper 1/4", quantity: 4, product: { ...legacyProducts[2], price_per_unit_label: "m" } },
    { quote_item_id: "q3", product_id: "p4", item_name: "Insulation", quantity: 4, product: { ...legacyProducts[3], price_per_unit_label: "m" } },
    { quote_item_id: "q4", product_id: "p2", item_name: "R410a top-up", quantity: 1, product: legacyProducts[1] },
    { quote_item_id: "q5", product_id: "p5", item_name: "PVC tape", quantity: 2, product: legacyProducts[4] },
    { quote_item_id: "q6", product_id: null, item_name: "Wall bracket (bought on site)", quantity: 1, product: null },
  ];
  const stock = [
    { id: "s1", product_id: "p1", item: "Test Midwall 24K", qty_on_hand: 1, stock_unit: "each" as const, pack_size: 1 },
    { id: "s2", product_id: "p3", item: "Copper pipe 1/4", qty_on_hand: 41.5, stock_unit: "m" as const, pack_size: 15 },
    { id: "s3", product_id: "p4", item: "Pipe insulation 1/4", qty_on_hand: 2.5, stock_unit: "m" as const, pack_size: 1 },
    { id: "s4", product_id: "p2", item: "R410a", qty_on_hand: 9.4, stock_unit: "kg" as const, pack_size: 11.3 },
    { id: "s5", product_id: "p5", item: "PVC duct tape", qty_on_hand: 12, stock_unit: "roll" as const, pack_size: 1 },
  ];
  const rows = buildDrawPlan(items, stock, [{ stock_item_id: "s2", drawn_qty: 1 }], [{ stock_item_id: "s1", qty: 1 }]);
  const [qty, setQty] = useState<Record<string, number>>({ q4: 1.2 });
  return <div className="mx-auto max-w-3xl p-4"><MaterialsCard rows={rows} qty={qty} onQty={(k, v) => setQty((s) => ({ ...s, [k]: v }))} onSave={() => {}} saving={false} count={toDrawPayload(rows, qty).length} /></div>;
}

function App() {
  if (view === "draw") return <Draw />;
  if (view === "inv" || view === "dn") return <LegacyReceive />;
  if (view === "01") return (
    <Shell>
      <Step n="1" text="Admin → Supplier documents. Receive stock opens on test invoice TST-INV0042. No live document." />
      <AdminSupplierDocsPage />
    </Shell>
  );
  if (view === "01d") return (
    <Shell>
      <Step n="1" text="Test invoice TST-INV0042. Indoor is job-reserved, outdoor is general stock, gas is the materials pool. Costs are exclusive of VAT." />
      <ReceiveDialog pending={{ id: "00000000-0000-0000-0000-00000000dd42", docType: "supplier_invoice", docNo: "TST-INV0042", poNo: "TST-SO0099", supplier: "Test Supplies", lines: priced }} />
    </Shell>
  );
  if (view === "02") return <Count n="2" text="Delivery note TST-DN-CU confirmed first. Copper test quantity 4 is in the stock count at the delivery cost (R40.00)." />;
  if (view === "03") return <Count n="3" text="Matching invoice TST-INV-CU confirmed. Quantity stays 4. Value moves to the invoice cost (R48.00)." />;
  if (view === "04") return <Count n="4" text="Invoice TST-INV-W confirmed before the goods arrive. Widget quantity 3 is awaiting delivery and is not in the on-hand count." />;
  if (view === "05") return <Count n="5" text="Delivery note linked to TST-INV-W. The same quantity 3 is now in the count once (R60.00). It is no longer awaiting." />;
  if (view === "06") return <CreditShot />;
  if (view === "07") return (
    <Shell>
      <Step n="7" text="Confirm uses jobs already on file. Test Supplies TST-DN0001 has no client. The job list is Install · job j1 and Service · job j2." />
      <ReceiveDialog pending={{ id: "00000000-0000-0000-0000-00000000dd01", docType: "delivery_note", docNo: "TST-DN0001", poNo: "TST-SO0099", supplier: "Test Supplies", lines: priced.map((l) => ({ ...l, unit_price_excl: null })) }} />
    </Shell>
  );
  if (view === "08a") return <TechBefore />;
  if (view === "08b") return <Count n="8" text="After finish, the indoor unit has left on-hand stock, including the R30 invoice difference. Copper test is still in the materials pool. The unit row is gone." />;
  if (view === "09") return <Count n="9" text="Add allowance stubs. They stay inactive until WALDA fills the quantities. This button does not post a material cost." />;
  return <div className="p-4">Unknown harness view {view}</div>;
}

createRoot(document.getElementById("root")!).render(<App />);
