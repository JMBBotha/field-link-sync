import { Button } from "@/components/ui/button";
import { MessageCircle } from "lucide-react";

interface WhatsAppShareButtonProps {
  phone?: string | null;
  message: string;
  className?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  children?: React.ReactNode;
}

const formatPhone = (phone: string) => {
  let cleaned = phone.replace(/[\s\-()]/g, "");
  if (cleaned.startsWith("+")) cleaned = cleaned.slice(1);
  if (cleaned.startsWith("0")) cleaned = "27" + cleaned.slice(1);
  return cleaned;
};

const WhatsAppShareButton = ({
  phone,
  message,
  className = "",
  variant = "outline",
  size = "default",
  children,
}: WhatsAppShareButtonProps) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const encodedMessage = encodeURIComponent(message);
    const phoneParam = phone ? formatPhone(phone) : "";
    const url = phoneParam
      ? `https://wa.me/${phoneParam}?text=${encodedMessage}`
      : `https://wa.me/?text=${encodedMessage}`;
    window.open(url, "_blank");
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleClick}
      className={`gap-2 ${className}`}
    >
      {children || <><MessageCircle className="h-4 w-4 text-green-600" />WhatsApp</>}
    </Button>
  );
};

export default WhatsAppShareButton;
