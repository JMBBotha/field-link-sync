import { useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import FlAuthFrame from "@/components/auth/FlAuthFrame";
import { supabase } from "@/integrations/supabase/client";
import { bareUuid } from "@/lib/bareLink";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const id = bareUuid(location.pathname);
  const [state, setState] = useState<"checking" | "none" | "404">(id ? "checking" : "404");
  useEffect(() => {
    if (!id) { setState("404"); console.error("404 Error: User attempted to access non-existent route:", location.pathname); return; }
    let live = true;
    setState("checking");
    (supabase.rpc as any)("resolve_public_link", { p_id: id }).then(({ data }: { data: string | null }) => {
      if (!live) return;
      if (data && data.startsWith("/")) navigate(data, { replace: true });
      else setState("none");
    }, () => live && setState("none"));
    return () => { live = false; };
  }, [id, location.pathname, navigate]);

  if (state === "checking") return <FlAuthFrame><h2>Opening your link…</h2></FlAuthFrame>;
  if (state === "none") return (
    <FlAuthFrame>
      <h2>This link has expired</h2>
      <p className="sub">This document link is no longer valid. Please contact us and we will send you a fresh link to your invoice or quote.</p>
      <div className="trk"><a href="/" className="pill">Return to Home</a></div>
    </FlAuthFrame>
  );
  return (
    <FlAuthFrame>
      <div className="big404">404</div>
      <h2>Page not found</h2>
      <p className="sub">Oops! There's nothing at <b>{location.pathname}</b>.</p>
      <div className="trk"><a href="/" className="pill">Return to Home</a></div>
    </FlAuthFrame>
  );
};

export default NotFound;
