import { useState } from "react";
import { Phone, Mail, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import CallClientDrawer from "./CallClientDrawer";
import SendReminderDrawer from "./SendReminderDrawer";
import WhatsAppShareButton from "@/components/WhatsAppShareButton";

interface Props {
  leadId: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  invoiceNumber: string | null;
  invoiceAmount: number | null;
  invoiceStatus: string | null;
}

const LeadActionButtons = ({
  leadId,
  customerName,
  customerPhone,
  customerEmail,
  invoiceNumber,
  invoiceAmount,
  invoiceStatus,
}: Props) => {
  const [callOpen, setCallOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const noPhone = !customerPhone;
  const noEmail = !customerEmail;

  const whatsappMessage = invoiceStatus === "paid"
    ? `Hi ${customerName}, thank you for your payment. We appreciate your business!`
    : invoiceNumber
      ? `Hi ${customerName}, this is a friendly reminder regarding Invoice #${invoiceNumber} for R ${(invoiceAmount ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}. Please let us know if you have any questions.`
      : `Hi ${customerName}, your HVAC service has been completed. We'll be in touch with your invoice shortly.`;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {/* Call */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={noPhone}
              onClick={() => setCallOpen(true)}
            >
              <Phone className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {noPhone ? "No phone on file" : "Call Client"}
          </TooltipContent>
        </Tooltip>

        {/* Email */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={noEmail}
              onClick={() => setEmailOpen(true)}
            >
              <Mail className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            {noEmail ? "No email on file" : "Send Reminder"}
          </TooltipContent>
        </Tooltip>

        {/* WhatsApp */}
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <WhatsAppShareButton
                phone={customerPhone}
                message={whatsappMessage}
                variant="ghost"
                size="icon"
                className="h-7 w-7"
              >
                <MessageCircle className="h-3.5 w-3.5 text-green-600" />
              </WhatsAppShareButton>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">WhatsApp</TooltipContent>
        </Tooltip>

        <CallClientDrawer
          open={callOpen}
          onClose={() => setCallOpen(false)}
          leadId={leadId}
          customerPhone={customerPhone}
        />
        <SendReminderDrawer
          open={emailOpen}
          onClose={() => setEmailOpen(false)}
          leadId={leadId}
          customerEmail={customerEmail}
        />
      </div>
    </TooltipProvider>
  );
};

export default LeadActionButtons;
