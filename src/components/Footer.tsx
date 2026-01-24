import { ReactNode } from "react";
import samsungLogo from "@/assets/samsung-logo.png";

interface FooterProps {
  leftContent?: ReactNode;
}

const Footer = ({ leftContent }: FooterProps) => {
  return (
    <footer 
      className="fixed bottom-0 left-0 right-0 z-30 px-4 py-2 flex items-center justify-between border-t"
      style={{ backgroundColor: '#0077B6', borderColor: '#006699' }}
    >
      {/* Left: Optional action content (e.g., toggle buttons) */}
      <div className="flex items-center gap-2">
        {leftContent}
      </div>

      {/* Center: Copyright - hidden on mobile, visible on tablet+ */}
      <div className="hidden md:flex flex-1 justify-center">
        <span className="text-xs text-blue-100">
          © {new Date().getFullYear()} Field Link Sync. All rights reserved.
        </span>
      </div>

      {/* Right: Samsung logo */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-blue-100 hidden sm:inline">Powered by</span>
        <img src={samsungLogo} alt="Samsung" className="h-5 w-auto" />
      </div>
    </footer>
  );
};

export default Footer;
