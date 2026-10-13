/** Website booking timing ("Timing: ASAP" / "Timing: Tue 14 Oct 10:00" / "Timing: Flexible") from lead notes. */
export function leadTiming(notes?: string | null): string | null {
  const m = /^Timing:\s*(.+)$/m.exec(notes || "");
  return m ? m[1].trim() : null;
}
