import { ReactNode } from "react";
import Footer from "./Footer";

interface LayoutProps {
  children: ReactNode;
  footerLeftContent?: ReactNode;
  /** Hide the footer on small screens when a bottom nav already occupies that space. */
  hideFooterOnMobile?: boolean;
}

const Layout = ({ children, footerLeftContent, hideFooterOnMobile }: LayoutProps) => {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1">
        {children}
      </main>
      <div className={hideFooterOnMobile ? "hidden md:block" : undefined}>
        <Footer leftContent={footerLeftContent} />
      </div>
    </div>
  );
};

export default Layout;
