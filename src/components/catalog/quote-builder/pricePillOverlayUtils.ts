export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
  center_x?: number;
}

export interface HeaderCenter {
  centerX: number;
  width: number;
}

export interface PriceColumnExtractionMeta {
  headerCenter: HeaderCenter | null;
  textItemsCount: number;
  extractionSucceeded: boolean;
  usedLayoutFallback: boolean;
}

interface TextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DAIKIN_FALLBACK_HEADER_CENTER: HeaderCenter = {
  centerX: 0.75,
  width: 0.1,
};

function normalizeHeaderText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function isDaikinSupplier(supplierName: string): boolean {
  return supplierName.toLowerCase().includes("daikin");
}

export function findHeaderCenterForPage(
  items: TextItem[],
  pageWidth: number,
  targetHeader: string
): HeaderCenter | null {
  const normalizedTarget = normalizeHeaderText(targetHeader);
  if (!normalizedTarget || !items.length || !pageWidth) return null;

  const targetTokens = normalizedTarget.split(" ").filter((token) => token.length >= 2);
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

  const lines: Array<{ y: number; items: TextItem[] }> = [];
  sorted.forEach((item) => {
    const existing = lines.find((line) => Math.abs(line.y - item.y) <= Math.max(8, item.height));
    if (existing) {
      existing.items.push(item);
      return;
    }
    lines.push({ y: item.y, items: [item] });
  });

  for (const line of lines.sort((a, b) => a.y - b.y)) {
    const lineItems = [...line.items].sort((a, b) => a.x - b.x);
    const lineText = normalizeHeaderText(lineItems.map((item) => item.text).join(" "));
    const matchesHeader =
      lineText.includes(normalizedTarget) ||
      targetTokens.every((token) => lineText.includes(token));

    if (!matchesHeader) continue;

    const matchedItems = lineItems.filter((item) => {
      const itemText = normalizeHeaderText(item.text);
      if (!itemText) return false;
      return (
        normalizedTarget.includes(itemText) ||
        itemText.includes(normalizedTarget) ||
        targetTokens.some((token) => itemText.includes(token) || token.includes(itemText))
      );
    });

    const sourceItems = matchedItems.length > 0 ? matchedItems : lineItems;
    const minX = Math.min(...sourceItems.map((item) => item.x));
    const maxX = Math.max(...sourceItems.map((item) => item.x + item.width));

    return {
      centerX: ((minX + maxX) / 2) / pageWidth,
      width: Math.max(0.08, (maxX - minX) / pageWidth),
    };
  }

  return null;
}

export function buildPriceBboxFromRow(rowBbox: BBox, headerCenter: HeaderCenter): BBox {
  const safeWidth = Math.min(0.25, Math.max(0.05, headerCenter.width || 0.1));
  const safeCenter = Math.min(1, Math.max(0, headerCenter.centerX));

  return {
    x: Math.max(0, Math.min(1 - safeWidth, safeCenter - safeWidth / 2)),
    y: rowBbox.y,
    width: safeWidth,
    height: rowBbox.height,
    center_x: safeCenter,
  };
}
