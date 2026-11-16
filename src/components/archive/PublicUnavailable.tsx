import { PUBLIC_UNAVAILABLE } from "@/lib/archiveGaps";

/** Client-facing page when a public quote or invoice link is archived. */
export function PublicUnavailable({ message = PUBLIC_UNAVAILABLE }: { message?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F3F6FA] p-6" data-testid="public-unavailable">
      <div className="max-w-md rounded-2xl border border-[#D6E4EF] bg-white px-6 py-8 text-center shadow-sm">
        <p className="text-lg font-semibold text-[#0F2A44]">No longer available</p>
        <p className="mt-2 text-sm text-[#3D5166]">{message}</p>
      </div>
    </div>
  );
}
