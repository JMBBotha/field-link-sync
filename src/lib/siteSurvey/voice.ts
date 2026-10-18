/** Voice-note helpers: suggestions from a transcript (plain word matching, no AI) + audio encoding helpers. */
import { ELECTRICAL, WALL_TYPES } from "./model";

const WORDS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50 };

function num(tok: string): number | null {
  const t = tok.toLowerCase().replace(",", ".");
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t in WORDS) return WORDS[t];
  const m = t.match(/^(twenty|thirty|forty)[- ](one|two|three|four|five|six|seven|eight|nine)$/);
  return m ? WORDS[m[1]] + WORDS[m[2]] : null;
}

export interface Suggestion { field: "pipe_run_m" | "wall_type" | "electrical" | "unit_size_btu"; value: number | string; label: string }

/** e.g. "about six and a half metres to the back corner, face brick, plug top" -> pipe 6.5, wall, electrical. */
export function suggestFromTranscript(text: string): Suggestion[] {
  const out: Suggestion[] = [];
  const s = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}.,\- ]+/gu, " ").replace(/\s+/g, " ")} `;
  const re = /([\p{L}\p{N}.,-]+(?: and a half)?)\s*(?:m|metres|meters|metre|meter)\b/gu;
  let best: number | null = null;
  for (const m of s.matchAll(re)) {
    let raw = m[1], half = false;
    if (raw.endsWith(" and a half")) { half = true; raw = raw.replace(" and a half", ""); }
    const n = num(raw);
    if (n != null && n > 0 && n <= 60) { best = n + (half ? 0.5 : 0); }
  }
  if (best != null) out.push({ field: "pipe_run_m", value: Math.round(best * 2) / 2, label: `Pipe run ${Math.round(best * 2) / 2} m` });
  const wall = WALL_TYPES.find((w) => s.includes(` ${w.toLowerCase().split(" /")[0]} `) || (w === "Face brick" && /face ?brick/.test(s)));
  if (wall) out.push({ field: "wall_type", value: wall, label: `Wall: ${wall}` });
  const el = /isolator/.test(s) ? "Isolator from DB" : /plug ?top/.test(s) ? "Plug top" : /plug ?point|socket/.test(s) ? "Plug point" : null;
  if (el && ELECTRICAL.includes(el)) out.push({ field: "electrical", value: el, label: el });
  const btu = s.match(/\b(9|12|18|24|36)\s?(?:k|thousand)\b/);
  if (btu) out.push({ field: "unit_size_btu", value: Number(btu[1]) * 1000, label: `${btu[1]}K unit` });
  return out;
}

export function base64ToBlob(b64: string, type = "audio/wav"): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** WAV 16 kHz mono 16-bit: 32,000 bytes per second after the 44-byte header. */
export const wavSeconds = (bytes: number) => Math.max(0, Math.round(((bytes - 44) / 32000) * 10) / 10);
export const MAX_NOTE_SECONDS = 120;
