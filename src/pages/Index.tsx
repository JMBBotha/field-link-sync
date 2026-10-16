import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { MapPin, Users, Navigation, Loader2 } from "lucide-react";
import FlAuthFrame from "@/components/auth/FlAuthFrame";
import { withTimeout } from "@/lib/withTimeout";





const Index = () => {
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;

    const checkUser = async () => {
      try {
        if (session) {
          const { data: roles, error } = await withTimeout(
            supabase.from("user_roles").select("role").eq("user_id", session.user.id),
            8000,
            "Checking your access is taking too long.",
          );
          if (error) throw error;
          // Same rule as postLoginRedirect: office roles (incl. sales reps) start in the admin layout, techs on /field.
          const hasAdminRole = roles?.some(r => ["admin", "dispatcher", "viewer"].includes(r.role));
          navigate(hasAdminRole ? "/admin" : "/field");
        }
      } catch (err) {
        console.error("Index checkUser error:", err);
      } finally {
        setLoading(false);
      }
    };

    checkUser();
  }, [session, authLoading, navigate]);

  if (loading || authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#081321]"><Loader2 className="h-8 w-8 animate-spin text-[#1AA7EC]" /></div>
    );
  }

  return (
    <FlAuthFrame wide>
      <h2>Field Service Management</h2>
      <p className="sub">Intelligent lead distribution and real-time tracking for your field operations.</p>
      <div className="feats">
        <div className="feat"><span className="ri"><MapPin size={16} /></span><div><b>Live Tracking</b><small>Monitor agents in real-time on an interactive map</small></div></div>
        <div className="feat"><span className="ri"><Navigation size={16} /></span><div><b>Smart Dispatch</b><small>Proximity-based lead routing to nearest agents</small></div></div>
        <div className="feat"><span className="ri"><Users size={16} /></span><div><b>Mobile Ready</b><small>Full-featured interface for field workers on the go</small></div></div>
      </div>
      <div className="trk"><button className="pill or" onClick={() => navigate("/login")}>Get Started</button></div>
      <div className="ft">Already have an account? <button className="lnk" onClick={() => navigate("/login")}>Sign in</button></div>
    </FlAuthFrame>
  );
};

export default Index;
