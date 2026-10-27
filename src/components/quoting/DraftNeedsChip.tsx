/** Red "Needs: …" chip on a draft that can't be sent yet (Johan 27 Oct). */
export function DraftNeedsChip({ needs }: { needs?: string[] }) {
  if (!needs?.length) return null;
  return (
    <span data-testid="draft-needs-chip" title="Finish these before sending" className="inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 whitespace-nowrap">
      Needs: {needs.join(", ")}
    </span>
  );
}
