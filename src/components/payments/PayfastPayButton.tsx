import { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { CreditCard, Loader2 } from "lucide-react";
import { useState } from "react";

interface PayfastPayButtonProps {
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  customerEmail?: string | null;
  customerName?: string;
  returnUrl?: string;
  cancelUrl?: string;
}

const PAYFAST_SANDBOX_URL = "https://sandbox.payfast.co.za/eng/process";

// These would be set from env/secrets in production
// For sandbox testing, use test credentials
const MERCHANT_ID = "10000100";
const MERCHANT_KEY = "46f0cd694581a";

const PayfastPayButton = ({
  invoiceId,
  invoiceNumber,
  amount,
  customerEmail,
  customerName,
  returnUrl,
  cancelUrl,
}: PayfastPayButtonProps) => {
  const formRef = useRef<HTMLFormElement>(null);
  const [submitting, setSubmitting] = useState(false);

  const baseUrl = window.location.origin;
  const defaultReturnUrl = returnUrl || `${baseUrl}/customer`;
  const defaultCancelUrl = cancelUrl || `${baseUrl}/customer`;
  const notifyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/payfast-itn`;

  const handlePay = () => {
    setSubmitting(true);
    // Small delay for visual feedback before form submission redirects
    setTimeout(() => {
      formRef.current?.submit();
    }, 300);
  };

  return (
    <>
      <form
        ref={formRef}
        action={PAYFAST_SANDBOX_URL}
        method="POST"
        style={{ display: "none" }}
      >
        <input type="hidden" name="merchant_id" value={MERCHANT_ID} />
        <input type="hidden" name="merchant_key" value={MERCHANT_KEY} />
        <input type="hidden" name="amount" value={amount.toFixed(2)} />
        <input type="hidden" name="item_name" value={`Invoice ${invoiceNumber}`} />
        <input type="hidden" name="item_description" value={`Payment for ${invoiceNumber} - ${customerName || "Customer"}`} />
        <input type="hidden" name="m_payment_id" value={invoiceId} />
        {customerEmail && <input type="hidden" name="email_address" value={customerEmail} />}
        {customerName && <input type="hidden" name="name_first" value={customerName.split(" ")[0]} />}
        <input type="hidden" name="return_url" value={defaultReturnUrl} />
        <input type="hidden" name="cancel_url" value={defaultCancelUrl} />
        <input type="hidden" name="notify_url" value={notifyUrl} />
        <input type="hidden" name="payment_method" value="eft" />
      </form>

      <Button
        onClick={handlePay}
        disabled={submitting}
        className="w-full h-12 rounded-xl font-semibold bg-green-600 hover:bg-green-700 text-white"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <CreditCard className="h-4 w-4 mr-2" />
        )}
        Pay Now with PayFast — R {amount.toFixed(2)}
      </Button>
    </>
  );
};

export default PayfastPayButton;
