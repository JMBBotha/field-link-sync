import { formatRand } from "@/utils/formatRand";

/**
 * Prefilled WhatsApp share URL for a deposit invoice.
 * No phone number — the client picks the contact in WhatsApp.
 * Message carries the invoice number, the SA-formatted amount and the pay link.
 */
export function buildDepositWhatsAppUrl(
  invoiceNumber: string,
  amount: number,
  payUrl: string,
): string {
  const text = `Hi, here is the deposit invoice ${invoiceNumber} for ${formatRand(amount)}. You can pay securely here: ${payUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
