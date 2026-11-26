/**
 * Office reopen of a stored job / warranty card. Private signed URL, same company only.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { JOB_CARD_BUCKET, UNSIGNED_CLIENT } from "@/lib/jobCard";

type Row = {
  id: string;
  job_id: string;
  client_name: string | null;
  signed: boolean;
  completed_at: string | null;
  storage_path: string;
};

async function loadCards(jobId?: string | null, customerId?: string | null): Promise<Row[]> {
  try {
    let q = (supabase.from as any)("job_cards").select("id, job_id, client_name, signed, completed_at, storage_path, created_at");
    q = jobId ? q.eq("job_id", jobId) : q.eq("customer_id", customerId);
    if (typeof q.order === "function") q = q.order("created_at", { ascending: false });
    const res = await q;
    if (!res || res.error || !Array.isArray(res.data)) return [];
    return res.data as Row[];
  } catch {
    return [];
  }
}

export default function JobCardLink({ jobId, customerId }: { jobId?: string | null; customerId?: string | null }) {
  const enabled = !!(jobId || customerId);
  const { data = [] } = useQuery({
    queryKey: ["job-cards", jobId || "", customerId || ""],
    enabled,
    queryFn: () => loadCards(jobId, customerId),
  });
  if (!data.length) return null;

  const open = async (path: string) => {
    const storage = (supabase as any).storage;
    if (!storage?.from) return;
    const signed = await storage.from(JOB_CARD_BUCKET).createSignedUrl(path, 300);
    const url = signed?.data?.signedUrl as string | undefined;
    if (url) window.open(url, "_blank", "noopener");
  };

  return (
    <div className="rounded-2xl border border-border p-4" data-testid="job-card-link">
      <p className="mb-2 text-sm font-semibold">Job / warranty card</p>
      <ul className="space-y-2">
        {data.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">
              {row.client_name || "Client"} · {row.signed ? "Signed" : UNSIGNED_CLIENT}
            </span>
            <Button type="button" size="sm" className="bg-[#C2410C] text-white hover:bg-[#C2410C]/90" onClick={() => void open(row.storage_path)} data-testid="job-card-open">
              Open
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
