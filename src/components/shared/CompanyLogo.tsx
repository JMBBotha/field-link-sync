import type { ImgHTMLAttributes } from "react";
import { useCompany } from "@/providers/CompanyProvider";
import logo from "@/assets/logo.png";

export default function CompanyLogo(props: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt">) {
  const { company, loading } = useCompany();
  return <img {...props} src={(!loading && company?.logo_url?.trim()) || logo} alt={company?.name || "My Company"} />;
}