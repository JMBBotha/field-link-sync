import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { defaultTitleForRole, renderReminderSignatureHtml, renderSignatureHtml } from "@/lib/emailSignature";

/** "My email signature": each person edits their own title/phone/email; live preview of what clients see. */
export default function MySignatureCard({ showAdminTest = true }: { showAdminTest?: boolean }) {
  const { user } = useAuth();
  const { isAdmin, roles } = useRole() as { isAdmin: boolean; roles?: string[] };
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("profiles")
        .select("full_name, phone, job_title, signature_phone, signature_email, signature_enabled")
        .eq("id", user.id)
        .maybeSingle();
      setName(data?.full_name ?? "");
      setTitle(data?.job_title ?? "");
      setPhone(data?.signature_phone ?? data?.phone ?? "");
      setEmail(data?.signature_email ?? user.email ?? "");
      setEnabled(data?.signature_enabled ?? true);
      setLoading(false);
    })();
  }, [user?.id, user?.email]);

  const fallbackTitle = defaultTitleForRole(roles?.[0]) ?? "";
  const person = useMemo(
    () => (enabled ? { name: name || "Your name", title: title || fallbackTitle, phone, email } : null),
    [enabled, name, title, fallbackTitle, phone, email],
  );
  const previewHtml = useMemo(() => renderSignatureHtml(person), [person]);
  const reminderHtml = useMemo(() => renderReminderSignatureHtml(person), [person]);

  const save = async () => {
    if (!user?.id) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from("profiles")
      .update({ job_title: title || null, signature_phone: phone || null, signature_email: email || null, signature_enabled: enabled })
      .eq("id", user.id);
    setSaving(false);
    toast(error ? { title: "Could not save", description: error.message, variant: "destructive" } : { title: "Signature saved" });
  };

  const sendTest = async () => {
    setTesting(true);
    const { data, error } = await supabase.functions.invoke("send-quote-email", { body: { signatureTest: true } });
    setTesting(false);
    toast(error || !data?.success
      ? { title: "Test not sent", description: error?.message || JSON.stringify(data?.resend ?? data), variant: "destructive" }
      : { title: "Test sent", description: `Sent only to ${data.sentTo}` });
  };

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>My email signature</CardTitle>
        <CardDescription>Added to quotes and emails you send. Client replies come back to your email address.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div><Label>Name</Label><Input value={name} disabled /></div>
              <div><Label>Title</Label><Input value={title} placeholder={fallbackTitle} onChange={(e) => setTitle(e.target.value)} /></div>
              <div><Label>Phone in signature</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              <div><Label>Email (replies go here)</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            </div>
            <div className="flex items-center gap-2"><Switch checked={enabled} onCheckedChange={setEnabled} /><Label>Show my personal details (off = company block only)</Label></div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save signature"}</Button>
              {showAdminTest && isAdmin && (
                <Button variant="outline" onClick={sendTest} disabled={testing}>{testing ? "Sending…" : "Send test to myself"}</Button>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Preview</p>
              <div className="overflow-x-auto rounded-md border bg-white p-3" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Automatic reminder preview (you + company)</p>
              <div className="overflow-x-auto rounded-md border bg-white p-3" dangerouslySetInnerHTML={{ __html: reminderHtml }} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
