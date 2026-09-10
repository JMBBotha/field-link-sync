import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import PdfPageOverlay from "./components/catalog/quote-builder/PdfPageOverlay";
import type { OverlayRegion } from "./components/catalog/quote-builder/PdfPageOverlay";

const H = 1346;
const rowsY = [97, 125, 153, 181, 257, 285, 313, 341, 488, 516, 544, 572, 600];
const regions: OverlayRegion[] = rowsY.map((y, i) => ({
  id: `r${i}`, x_pct: 4.7, y_pct: ((y - 14) / H) * 100, w_pct: 90, h_pct: (28 / H) * 100,
  product: null, product_code: `CODE${i}`, label: `Row ${i}`, has_price: true, detected_price: 1000 + i, matched: false,
}));

function App() {
  const [sel, setSel] = useState<any[]>([]);
  const [info, setInfo] = useState<string[]>([]);
  const zoom = Number(new URLSearchParams(location.search).get("zoom") || "1");
  (window as any).__sel = sel; (window as any).__info = info;
  const pdfSelection = {
    selectedFromPdf: sel, setSelectedFromPdf: setSel,
    handleSelectProduct: (p: any) => setSel((s) => s.some((x) => x.code === p.code) ? s.filter((x) => x.code !== p.code) : [...s, { ...p, quantity: 1, unitType: "each" }]),
    updateSelectedItem: () => {},
  } as any;
  return (
    <div style={{ width: 390, height: 700, overflow: "auto" }} id="scroll">
      <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: 390 }}>
        <div style={{ position: "relative", width: 390 }} id="page">
          <img src="/__tmp_daikin_p3.jpeg" style={{ width: "100%", display: "block" }} />
          <PdfPageOverlay regions={regions} baskets={[]} pdfSelection={pdfSelection}
            onOpenProductInfo={(p) => setInfo((s) => [...s, p.product_code])} />
        </div>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
