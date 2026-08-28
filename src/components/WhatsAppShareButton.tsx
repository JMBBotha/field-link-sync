import { Button } from "@/components/ui/button";

const WhatsAppLogo = ({ className = "" }: { className?: string }) => (
  <svg
    viewBox="0 0 32 32"
    className={`h-4 w-4 ${className}`}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <path
      fill="#25D366"
      d="M16 3C9.373 3 4 8.373 4 15c0 2.108.55 4.082 1.514 5.804L4 29l8.36-2.193A12.9 12.9 0 0 0 16 27c6.627 0 12-5.373 12-12S22.627 3 16 3z"
    />
    <path
      fill="#fff"
      d="M11.377 9.5c-.293-.654-.568-.668-.833-.68-.215-.01-.461-.01-.707-.01-.246 0-.646.092-.984.461-.338.37-1.293 1.263-1.293 3.082 0 1.819 1.324 3.577 1.508 3.823.184.246 2.586 4.062 6.348 5.688 4.443 1.925 4.443 1.283 5.252 1.203.809-.08 2.586-1.049 2.953-2.064.369-1.016.369-1.887.262-2.064-.108-.184-.385-.293-.809-.523-.424-.23-2.586-1.277-2.986-1.424-.4-.143-.691-.215-.984.246-.293.461-1.123 1.414-1.377 1.707-.246.293-.508.338-.932.107-.424-.23-1.787-.658-3.406-2.1-1.262-1.123-2.115-2.512-2.361-2.936-.246-.424-.026-.654.184-.86.19-.19.43-.498.646-.746.215-.246.293-.424.43-.707.138-.284.07-.538-.03-.761-.092-.216-.84-2.2-1.156-3.008z"
    />
  </svg>
);

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
      {children || <WhatsAppLogo />}
    </Button>
  );
};

export default WhatsAppShareButton;
