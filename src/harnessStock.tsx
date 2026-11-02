// Screenshot harness, dummy data only. Not shipped.
import "./index.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ReceiveForm } from "@/components/stock/ReceiveSupplierDocDialog";
import ReceivePreviewTable from "@/components/stock/ReceivePreviewTable";
import { MaterialsCard } from "@/components/stock/JobMaterialsDrawdown";
import { buildPreview, normaliseModel, type Product } from "@/lib/stockReceive";
import { buildDrawPlan, toDrawPayload } from "@/lib/materialsDrawdown";
import { Button } from "@/components/ui/button";

const q = new URLSearchParams(location.search); const view = q.get("v") || "inv";
const P = (id: string, product_code: string, name: string, cost_price: number, extra: Partial<Product> = {}): Product => ({ id, product_code, name, short_name: name, cost_price, price_per_unit_label: "each", product_type: "material", ...extra });
const products: Product[] = [
  P("p1", "FCMI-24", "Test Midwall 24K pair", 10434.09, { product_type: "ac_unit" }),
  P("p2", "G005", "GAS - R410 DISP 11.3KG", 2260),
  P("p3", "CU-14-15", "Copper pipe 1/4 15m coil", 610),
  P("p4", "INS-14", "Pipe insulation 1/4", 18),
  P("p5", "TAPE-PVC", "PVC duct tape", 32),
];
const lines = [
  { line_no: 1, description: "IN - TEST MIDWALL INVERTER 24000", model_number: "FCMI-24-P", qty: 1, unit_price_excl: view === "dn" ? null : 10900 },
  { line_no: 2, description: "OUT - TEST MIDWALL INVERTER 24000", model_number: "FCMI-24X-P", qty: 1, unit_price_excl: view === "dn" ? null : 10900 },
  { line_no: 3, description: "GAS - R410 DISP 11.3KG", model_number: "G005", qty: 2, unit_price_excl: view === "dn" ? null : 2190 },
  { line_no: 4, description: "COPPER 1/4 15M", model_number: "CU-14-15", qty: 3, unit_price_excl: view === "dn" ? null : 610 },
  { line_no: 5, description: "TEST LITE MIDWALL 12000", model_number: "FCMI-L-12", qty: 1, unit_price_excl: view === "dn" ? null : 6200 },
];
const jobs = [{ id: "j1", label: "Install 2×24K — Test Client A" }, { id: "j2", label: "Service — Test Client B" }];
const earlier = view === "inv" ? [{ product_id: "p1", normalised: normaliseModel("FCMI-24"), unit_cost_excl: 10434.09, receive_action: "reserve", receive_job_id: "j1" }] : [];
const docType = view === "dn" ? "delivery_note" : "supplier_invoice";

function Receive() {
  const [rows, setRows] = useState(() => buildPreview(docType, lines, products, earlier, view === "dn" ? "j1" : null));
  const noop = () => {};
  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="rounded-2xl border bg-background p-4 space-y-4 shadow-sm">
        <h2 className="text-lg font-semibold">Receive delivery note / invoice</h2>
        <ReceiveForm docType={docType} setDocType={noop} docNo={view === "dn" ? "TST-DN0001" : "TST-INV0042"} setDocNo={noop} poNo="TST-SO0099" setPoNo={noop} supplier="Test Supplies" setSupplier={noop} file={null} setFile={noop} onRead={noop} busy={null} />
        <ReceivePreviewTable rows={rows} jobs={jobs} isInvoice={docType === "supplier_invoice"} onChange={(i, patch) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))} />
        <div className="flex justify-end gap-2"><Button variant="outline">Back</Button><Button>{docType === "supplier_invoice" ? "Confirm and add stock" : "Confirm delivery note"}</Button></div>
      </div>
    </div>
  );
}
function Draw() {
  const items = [
    { quote_item_id: "q1", product_id: "p1", item_name: "Test Midwall 24K", quantity: 1, product: products[0] },
    { quote_item_id: "q2", product_id: "p3", item_name: "Copper 1/4", quantity: 4, product: { ...products[2], price_per_unit_label: "m" } },
    { quote_item_id: "q3", product_id: "p4", item_name: "Insulation", quantity: 4, product: { ...products[3], price_per_unit_label: "m" } },
    { quote_item_id: "q4", product_id: "p2", item_name: "R410a top-up", quantity: 1, product: products[1] },
    { quote_item_id: "q5", product_id: "p5", item_name: "PVC tape", quantity: 2, product: products[4] },
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
  return <div className="max-w-3xl mx-auto p-4"><MaterialsCard rows={rows} qty={qty} onQty={(k, v) => setQty((s) => ({ ...s, [k]: v }))} onSave={() => {}} saving={false} count={toDrawPayload(rows, qty).length} /></div>;
}
createRoot(document.getElementById("root")!).render(view === "draw" ? <Draw /> : <Receive />);
