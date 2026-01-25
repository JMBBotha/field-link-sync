import { ReactNode } from "react";
import Footer from "./Footer";

interface LayoutProps {
  children: ReactNode;
  footerLeftContent?: ReactNode;
}

const Layout = ({ children, footerLeftContent }: LayoutProps) => {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1">
        {children}
      </main>
      <Footer leftContent={footerLeftContent} />
    </div>
  );
};

export default Layout;
