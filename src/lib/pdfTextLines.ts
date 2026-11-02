/** Read the PDF text layer in the browser and rebuild rows (columns joined with 2 spaces). Nothing leaves the device here. */
export async function pdfTextPages(file: File | ArrayBuffer): Promise<string[][]> {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  const data = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[][] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const tc = await (await pdf.getPage(n)).getTextContent();
    const items = (tc.items as any[]).filter((i) => typeof i.str === "string" && i.str.trim())
      .map((i) => ({ s: i.str as string, x: i.transform[4] as number, y: i.transform[5] as number, w: (i.width as number) ?? 0 }));
    const rows: { y: number; it: typeof items }[] = [];
    for (const it of items) {
      const r = rows.find((r) => Math.abs(r.y - it.y) < 2.5);
      if (r) r.it.push(it); else rows.push({ y: it.y, it: [it] });
    }
    rows.sort((a, b) => b.y - a.y);
    pages.push(rows.map((r) => {
      const cells = r.it.sort((a, b) => a.x - b.x); let out = ""; let end = -1;
      for (const c of cells) { out += end < 0 ? c.s : (c.x - end > 6 ? "  " : c.x - end > 1 ? " " : "") + c.s; end = c.x + c.w; }
      return out;
    }));
  }
  return pages;
}
