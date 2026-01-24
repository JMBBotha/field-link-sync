import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare,
  Settings,
  History,
  Send,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  AlertTriangle,
  Phone,
} from "lucide-react";
import { format } from "date-fns";

interface NotificationTemplate {
  id: string;
  setting_key: string;
  enabled: boolean;
  channels: string[];
  template_body: string;
  variables: string[];
}

interface NotificationLog {
  id: string;
  notification_type: string;
  channel: string;
  recipient: string;
  status: string;
  sent_at: string;
  error_message: string | null;
}

interface TwilioConfig {
  account_sid: string;
  auth_token: string;
  whatsapp_number: string;
  configured: boolean;
}

const NOTIFICATION_LABELS: Record<string, { label: string; description: string }> = {
  job_assigned: {
    label: "Job Assigned",
    description: "Sent when a job is assigned to a technician",
  },
  tech_en_route: {
    label: "Technician En Route",
    description: "Sent when the tech is on their way",
  },
  tech_arrived: {
    label: "Technician Arrived",
    description: "Sent when the tech arrives at the location",
  },
  job_completed: {
    label: "Job Completed",
    description: "Sent when the job is finished",
  },
  invoice_sent: {
    label: "Invoice Sent",
    description: "Sent with the invoice after job completion",
  },
  payment_received: {
    label: "Payment Received",
    description: "Sent to confirm payment",
  },
  feedback_request: {
    label: "Feedback Request",
    description: "Sent 2 hours after job completion",
  },
};

const AdminNotificationSettings = () => {
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testSending, setTestSending] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [twilioConfig, setTwilioConfig] = useState<TwilioConfig>({
    account_sid: "",
    auth_token: "",
    whatsapp_number: "",
    configured: false,
  });
  const { toast } = useToast();

  const fetchTemplates = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("notification_settings")
        .select("*")
        .order("setting_key");

      if (error) throw error;
      setTemplates(data || []);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  }, [toast]);

  const fetchLogs = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("notification_logs")
        .select("*")
        .order("sent_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      setLogs(data || []);
    } catch (err: any) {
      console.error("Error fetching logs:", err);
    }
  }, []);

  const fetchTwilioConfig = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("admin_settings")
        .select("setting_value")
        .eq("setting_key", "twilio_config")
        .single();

      if (data?.setting_value) {
        const config = data.setting_value as Record<string, unknown>;
        setTwilioConfig({
          account_sid: (config.account_sid as string) || "",
          auth_token: (config.auth_token as string) || "",
          whatsapp_number: (config.whatsapp_number as string) || "",
          configured: !!(config.account_sid && config.auth_token && config.whatsapp_number),
        });
      }
    } catch (err) {
      // Config doesn't exist yet
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchTemplates(), fetchLogs(), fetchTwilioConfig()]).finally(() =>
      setLoading(false)
    );
  }, [fetchTemplates, fetchLogs, fetchTwilioConfig]);

  const handleTemplateUpdate = async (template: NotificationTemplate) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("notification_settings")
        .update({
          enabled: template.enabled,
          template_body: template.template_body,
          updated_at: new Date().toISOString(),
        })
        .eq("id", template.id);

      if (error) throw error;
      toast({ title: "Saved", description: "Template updated successfully" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleTwilioConfigSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from("admin_settings").upsert({
        setting_key: "twilio_config",
        setting_value: {
          account_sid: twilioConfig.account_sid,
          auth_token: twilioConfig.auth_token,
          whatsapp_number: twilioConfig.whatsapp_number,
        },
        updated_at: new Date().toISOString(),
      });

      if (error) throw error;

      setTwilioConfig((prev) => ({ ...prev, configured: true }));
      toast({ title: "Saved", description: "Twilio configuration updated" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleTestSend = async (templateKey: string) => {
    if (!testPhone) {
      toast({
        title: "Phone required",
        description: "Enter a phone number to test",
        variant: "destructive",
      });
      return;
    }

    setTestSending(templateKey);
    try {
      const { data, error } = await supabase.functions.invoke("send-whatsapp-notification", {
        body: {
          notification_type: templateKey,
          test_mode: true,
          test_phone: testPhone,
        },
      });

      if (error) throw error;

      toast({
        title: "Test Sent! 📱",
        description: data?.message || "Check your WhatsApp",
      });
    } catch (err: any) {
      toast({
        title: "Send Failed",
        description: err.message || "Could not send test message",
        variant: "destructive",
      });
    } finally {
      setTestSending(null);
    }
  };

  const updateTemplate = (id: string, updates: Partial<NotificationTemplate>) => {
    setTemplates((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-green-500" />
            WhatsApp Notifications
          </h2>
          <p className="text-sm text-muted-foreground">
            Configure customer notifications via WhatsApp
          </p>
        </div>
        <Badge className={twilioConfig.configured ? "bg-green-500" : "bg-orange-500"}>
          {twilioConfig.configured ? "✓ Connected" : "⚠ Not Configured"}
        </Badge>
      </div>

      <Tabs defaultValue="templates">
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="logs">Delivery Log</TabsTrigger>
        </TabsList>

        {/* Templates Tab */}
        <TabsContent value="templates" className="space-y-4">
          {/* Test Phone Input */}
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <Label className="text-xs text-muted-foreground">Test Phone Number</Label>
                  <Input
                    placeholder="0821234567"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    className="h-8"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {templates.map((template) => {
            const meta = NOTIFICATION_LABELS[template.setting_key] || {
              label: template.setting_key,
              description: "",
            };

            return (
              <Card key={template.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base">{meta.label}</CardTitle>
                      <CardDescription>{meta.description}</CardDescription>
                    </div>
                    <Switch
                      checked={template.enabled}
                      onCheckedChange={(checked) => {
                        updateTemplate(template.id, { enabled: checked });
                        handleTemplateUpdate({ ...template, enabled: checked });
                      }}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1 block">
                      Message Template
                    </Label>
                    <Textarea
                      value={template.template_body}
                      onChange={(e) =>
                        updateTemplate(template.id, { template_body: e.target.value })
                      }
                      rows={4}
                      className="font-mono text-sm"
                    />
                  </div>

                  {template.variables.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      <span className="text-xs text-muted-foreground">Variables:</span>
                      {template.variables.map((v) => (
                        <Badge key={v} variant="outline" className="text-xs">
                          {`{${v}}`}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleTemplateUpdate(template)}
                      disabled={saving}
                    >
                      {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save Changes"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleTestSend(template.setting_key)}
                      disabled={!testPhone || !!testSending}
                    >
                      {testSending === template.setting_key ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <Send className="h-3 w-3 mr-1" />
                          Test
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Twilio WhatsApp Configuration
              </CardTitle>
              <CardDescription>
                Connect your Twilio account to send WhatsApp messages
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!twilioConfig.configured && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-orange-50 border border-orange-200">
                  <AlertTriangle className="h-5 w-5 text-orange-500 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-orange-800">Not Configured</p>
                    <p className="text-orange-600">
                      WhatsApp notifications are disabled until Twilio is configured.
                    </p>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <Label>Account SID</Label>
                  <Input
                    type="password"
                    placeholder="AC..."
                    value={twilioConfig.account_sid}
                    onChange={(e) =>
                      setTwilioConfig((prev) => ({ ...prev, account_sid: e.target.value }))
                    }
                  />
                </div>

                <div>
                  <Label>Auth Token</Label>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    value={twilioConfig.auth_token}
                    onChange={(e) =>
                      setTwilioConfig((prev) => ({ ...prev, auth_token: e.target.value }))
                    }
                  />
                </div>

                <div>
                  <Label>WhatsApp Number</Label>
                  <Input
                    placeholder="+14155238886"
                    value={twilioConfig.whatsapp_number}
                    onChange={(e) =>
                      setTwilioConfig((prev) => ({ ...prev, whatsapp_number: e.target.value }))
                    }
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Twilio sandbox: +14155238886
                  </p>
                </div>
              </div>

              <Button onClick={handleTwilioConfigSave} disabled={saving} className="w-full">
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                Save Configuration
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs Tab */}
        <TabsContent value="logs">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-4 w-4" />
                  Delivery Log
                </CardTitle>
                <CardDescription>Recent notification deliveries</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={fetchLogs}>
                <RefreshCw className="h-3 w-3 mr-1" />
                Refresh
              </Button>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-96">
                {logs.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No notifications sent yet
                  </p>
                ) : (
                  <div className="space-y-2">
                    {logs.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                      >
                        <div className="flex items-center gap-3">
                          {log.status === "sent" ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : log.status === "failed" ? (
                            <XCircle className="h-4 w-4 text-red-500" />
                          ) : (
                            <Clock className="h-4 w-4 text-yellow-500" />
                          )}
                          <div>
                            <p className="text-sm font-medium">
                              {NOTIFICATION_LABELS[log.notification_type]?.label ||
                                log.notification_type}
                            </p>
                            <p className="text-xs text-muted-foreground">{log.recipient}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge
                            variant="outline"
                            className={
                              log.status === "sent"
                                ? "border-green-500 text-green-500"
                                : log.status === "failed"
                                ? "border-red-500 text-red-500"
                                : ""
                            }
                          >
                            {log.status}
                          </Badge>
                          <p className="text-xs text-muted-foreground mt-1">
                            {format(new Date(log.sent_at), "dd MMM HH:mm")}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminNotificationSettings;
