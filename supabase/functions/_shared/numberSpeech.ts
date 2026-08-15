// Converts numbers into natural spoken English so the voice agent never reads
// amounts digit-by-digit ("1 2 0 0 0") or as "R one zero five nine zero".

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
];

function underThousand(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)];
    const r = n % 10;
    return r ? `${t}-${ONES[r]}` : t;
  }
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return rest ? `${ONES[h]} hundred and ${underThousand(rest)}` : `${ONES[h]} hundred`;
}

/** 10590 -> "ten thousand five hundred and ninety" */
export function numberToWords(value: number): string {
  if (!Number.isFinite(value)) return "";
  let n = Math.floor(Math.abs(value));
  const negative = value < 0;
  if (n === 0) return "zero";

  const parts: string[] = [];
  const scales: Array<[number, string]> = [
    [1_000_000_000, "billion"],
    [1_000_000, "million"],
    [1_000, "thousand"],
  ];
  for (const [scale, label] of scales) {
    if (n >= scale) {
      parts.push(`${numberToWords(Math.floor(n / scale))} ${label}`);
      n %= scale;
    }
  }
  if (n > 0) {
    // "and" only before a sub-hundred tail, matching natural South African speech.
    if (parts.length && n < 100) parts.push("and");
    parts.push(underThousand(n));
  }
  const words = parts.join(" ").replace(/\s+/g, " ").trim();
  return negative ? `minus ${words}` : words;
}

/** 10590 -> "ten thousand five hundred and ninety rand"; 1250.5 -> "... rand fifty cents" */
export function spokenRand(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const amount = Number(value);
  const whole = Math.floor(Math.abs(amount));
  const cents = Math.round((Math.abs(amount) - whole) * 100);
  let text = `${numberToWords(whole)} rand`;
  if (cents > 0) text += ` and ${numberToWords(cents)} cents`;
  return amount < 0 ? `minus ${text}` : text;
}

/** 12000 -> "twelve thousand BTU" */
export function spokenBtu(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return `${numberToWords(Number(value))} BTU`;
}

/** 2.6 -> "two point six kilowatts" */
export function spokenKw(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const n = Number(value);
  const whole = Math.floor(Math.abs(n));
  const decimals = Math.round((Math.abs(n) - whole) * 10);
  const base = decimals > 0
    ? `${numberToWords(whole)} point ${ONES[decimals]}`
    : numberToWords(whole);
  return `${base} kilowatt${n === 1 ? "" : "s"}`;
}

/** Plain count spoken naturally: 24000 -> "twenty-four thousand" */
export function spokenNumber(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  return numberToWords(Number(value));
}
