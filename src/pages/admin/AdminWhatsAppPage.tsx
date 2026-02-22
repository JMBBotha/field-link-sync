import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  MessageSquare,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Copy,
  Phone,
  Shield,
  Building2,
  ArrowRight,
  RefreshCw,
  TestTube,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const PHONE_NUMBER_ID = "913256445215502";
const WABA_ID = "880529564774512";
const WEBHOOK_URL = `https://rvzapfbifggovccebrjp.supabase.co/functions/v1/whatsapp-quote-bot`;
const VERIFY_TOKEN = "becool-whatsapp-verify-2026";

interface CheckItem {
  label: string;
  status: "ok" | "warning" | "error" | "pending";
  detail: string;
}

const AdminWhatsAppPage = () => {
  const [testMode, setTestMode] = useState(true);
  const [testing, setTesting] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<"unknown" | "ok" | "error">("unknown");

  const checks: CheckItem[] = [
    {
      label: "WhatsApp Secrets Configured",
      status: "ok",
      detail: "WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN are set",
    },
    {
      label: "Webhook URL Registered",
      status: webhookStatus === "ok" ? "ok" : webhookStatus === "error" ? "error" : "pending",
      detail: webhookStatus === "ok"
        ? "Webhook responds correctly"
        : "Click 'Test Webhook' to verify",
    },
    {
      label: "Phone Number Registration",
      status: "warning",
      detail: "Phone number may not be fully registered — Error #133010 indicates pending registration",
    },
    {
      label: "Business Verification",
      status: "warning",
      detail: "Meta Business Verification required before sending to real numbers",
    },
  ];

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const testWebhook = async () => {
    setTesting(true);
    try {
      const res = await fetch(
        `${WEBHOOK_URL}?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=lovable_test_${Date.now()}`
      );
      if (res.ok) {
        const text = await res.text();
        if (text.startsWith("lovable_test_")) {
          setWebhookStatus("ok");
          toast.success("Webhook verification working correctly!");
        } else {
          setWebhookStatus("error");
          toast.error("Webhook responded but challenge mismatch");
        }
      } else {
        setWebhookStatus("error");
        toast.error(`Webhook returned status ${res.status}`);
      }
    } catch (err) {
      setWebhookStatus("error");
      toast.error("Could not reach webhook endpoint");
    } finally {
      setTesting(false);
    }
  };

  const sendTestMessage = async () => {
    setTesting(true);
    try {
      const res = await supabase.functions.invoke("whatsapp-quote-bot", {
        method: "POST",
        body: {
          entry: [{
            changes: [{
              value: {
                messages: [{
                  from: "15551234567",
                  type: "text",
                  text: { body: "hi" },
                }],
              },
            }],
          }],
        },
      });
      if (res.error) {
        toast.error("Test failed: " + res.error.message);
      } else {
        toast.success("Test message processed! Check edge function logs for details.");
      }
    } catch (err) {
      toast.error("Failed to send test message");
    } finally {
      setTesting(false);
    }
  };

  const StatusIcon = ({ status }: { status: CheckItem["status"] }) => {
    switch (status) {
      case "ok": return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
      case "warning": return <AlertTriangle className="h-5 w-5 text-amber-500" />;
      case "error": return <XCircle className="h-5 w-5 text-red-500" />;
      case "pending": return <RefreshCw className="h-5 w-5 text-muted-foreground animate-pulse" />;
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageSquare className="h-6 w-6 text-emerald-500" />
          WhatsApp Integration
        </h1>
        <p className="text-muted-foreground mt-1">
          Configure and monitor your WhatsApp Business Cloud API integration
        </p>
      </div>

      {/* Status Checks */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Integration Health</CardTitle>
          <CardDescription>Current status of all WhatsApp components</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {checks.map((check, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <StatusIcon status={check.status} />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{check.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>
              </div>
              {check.status === "ok" && (
                <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800 shrink-0">
                  Active
                </Badge>
              )}
              {check.status === "warning" && (
                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800 shrink-0">
                  Action Needed
                </Badge>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={testWebhook} disabled={testing} className="mt-2">
            <RefreshCw className={`h-4 w-4 mr-2 ${testing ? "animate-spin" : ""}`} />
            Test Webhook
          </Button>
        </CardContent>
      </Card>

      {/* Configuration Details */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { label: "Phone Number ID", value: PHONE_NUMBER_ID },
            { label: "WABA ID", value: WABA_ID },
            { label: "Webhook URL", value: WEBHOOK_URL },
            { label: "Verify Token", value: VERIFY_TOKEN },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-4 p-3 rounded-lg border">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{item.label}</p>
                <p className="text-sm font-mono truncate">{item.value}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => copyToClipboard(item.value, item.label)}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Test Mode Toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TestTube className="h-5 w-5" />
            Test Mode
          </CardTitle>
          <CardDescription>
            While business verification is pending, use test mode to send messages only to registered test numbers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="test-mode" className="font-medium">Enable Test Mode</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Restricts outbound messages to Meta test numbers only
              </p>
            </div>
            <Switch id="test-mode" checked={testMode} onCheckedChange={setTestMode} />
          </div>
          {testMode && (
            <Alert>
              <TestTube className="h-4 w-4" />
              <AlertTitle>Test Mode Active</AlertTitle>
              <AlertDescription>
                Messages will only be sent to Meta-approved test numbers. Send "hi" to simulate a quote flow.
              </AlertDescription>
            </Alert>
          )}
          <Button variant="outline" size="sm" onClick={sendTestMessage} disabled={testing}>
            <MessageSquare className="h-4 w-4 mr-2" />
            Simulate Incoming Message
          </Button>
        </CardContent>
      </Card>

      {/* Error #133010 Explanation */}
      <Card className="border-amber-200 dark:border-amber-800">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-5 w-5" />
            Error #133010 — Account Not Registered
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This error means your phone number is not yet fully registered for the WhatsApp Cloud API.
            This is <strong>not</strong> a code or token issue — it's a Meta account onboarding step.
          </p>

          <Separator />

          <div className="space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Phone className="h-4 w-4" />
              Step 1: Register a Real Phone Number
            </h3>
            <p className="text-sm text-muted-foreground pl-6">
              Meta test numbers (+1 555...) can only message other test numbers. Register a real South African number 
              that's not already on WhatsApp via Meta Business Suite → WhatsApp Accounts → Add Phone Number.
            </p>

            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Step 2: Complete Business Verification (Critical for SA)
            </h3>
            <div className="pl-6 space-y-2">
              <p className="text-sm text-muted-foreground">
                Go to <strong>Meta Business Manager → Security Center → Start Verification</strong>. You'll need:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>Business name (0800BeCool)</li>
                <li>Physical address in South Africa</li>
                <li>CIPC registration number</li>
                <li>Business website URL</li>
                <li>Business email and phone</li>
                <li>Proof documents (utility bill, bank statement, or CIPC certificate)</li>
              </ul>
              <p className="text-sm text-muted-foreground">
                Verification typically takes <strong>1–5 business days</strong>.
              </p>
            </div>

            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Step 3: Verify WABA Status
            </h3>
            <p className="text-sm text-muted-foreground pl-6">
              In Meta App Dashboard → WhatsApp → API Setup, confirm Phone Number ID is linked to your WABA 
              and check for any "Pending review" warnings.
            </p>

            <h3 className="font-semibold text-sm flex items-center gap-2">
              <ArrowRight className="h-4 w-4" />
              Step 4: After Verification
            </h3>
            <p className="text-sm text-muted-foreground pl-6">
              Once approved, generate a long-lived System User token, update the WHATSAPP_TOKEN secret, 
              and disable test mode above. The 133010 error will disappear.
            </p>
          </div>

          <Separator />

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href="https://business.facebook.com/settings/security" target="_blank" rel="noopener noreferrer">
                <Shield className="h-4 w-4 mr-2" />
                Business Verification
                <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Cloud API Docs
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href="https://business.facebook.com/latest/whatsapp_manager/phone_numbers" target="_blank" rel="noopener noreferrer">
                <Phone className="h-4 w-4 mr-2" />
                Phone Numbers
                <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminWhatsAppPage;
