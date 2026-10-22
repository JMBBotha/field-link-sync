import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Download } from "lucide-react";

type Doc = { id: string; filename: string };

/** Client quote link: PDFs the company attached to this quote. */
export default function ClientQuoteDocuments({ token }: { token: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  useEffect(() => {
    supabase.rpc("public_quote_documents", { p_token: token }).then(({ data }) => setDocs((data as Doc[]) || []));
  }, [token]);
  if (!docs.length) return null;
  const open = async (d: Doc) => {
    const { data } = await supabase.functions.invoke("quote-document-download", { body: { token, id: d.id } });
    if (data?.url) window.location.href = data.url;
  };
  return (
    <Card className="rounded-2xl border-0 shadow-md print:hidden">
      <CardContent className="p-4 space-y-2">
        <p className="text-sm font-semibold">Documents</p>
        {docs.map((d) => (
          <button key={d.id} type="button" onClick={() => void open(d)} className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-muted">
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate flex-1">{d.filename}</span>
            <Download className="h-4 w-4 text-muted-foreground" />
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
