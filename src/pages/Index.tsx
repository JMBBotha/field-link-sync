import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MapPin, Users, Navigation, Loader2 } from "lucide-react";
import logo from "@/assets/logo.png";

const Index = () => {
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    checkUser();
  }, []);

  const checkUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session) {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);

      const hasAdminRole = roles?.some(r => r.role === "admin");
      
      if (hasAdminRole) {
        navigate("/admin");
      } else {
        navigate("/field");
      }
    }
    
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-[hsl(204,100%,36%)] via-[hsl(204,100%,28%)] to-[hsl(216,58%,12%)]">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[hsl(204,100%,36%)] via-[hsl(204,100%,28%)] to-[hsl(216,58%,12%)] p-4">
      {/* Logo */}
      <img src={logo} alt="0800BeCool" className="h-24 w-auto mb-6 drop-shadow-lg" />

      {/* Tagline */}
      <div className="text-center mb-10 max-w-md">
        <h1 className="text-3xl font-bold text-white mb-2">
          Field Service Management
        </h1>
        <p className="text-white/70 text-sm">
          Intelligent lead distribution and real-time tracking for your field operations
        </p>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl w-full mb-10">
        <div className="p-4 rounded-xl border border-white/15 bg-white/5 backdrop-blur-sm text-center">
          <div className="mx-auto mb-3 p-2 rounded-lg bg-[hsl(25,95%,53%)]/20 text-[hsl(25,95%,53%)] w-fit">
            <MapPin className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-semibold text-white">Live Tracking</h3>
          <p className="text-xs text-white/50 mt-1">Monitor agents in real-time on an interactive map</p>
        </div>

        <div className="p-4 rounded-xl border border-white/15 bg-white/5 backdrop-blur-sm text-center">
          <div className="mx-auto mb-3 p-2 rounded-lg bg-[hsl(25,95%,53%)]/20 text-[hsl(25,95%,53%)] w-fit">
            <Navigation className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-semibold text-white">Smart Dispatch</h3>
          <p className="text-xs text-white/50 mt-1">Proximity-based lead routing to nearest agents</p>
        </div>

        <div className="p-4 rounded-xl border border-white/15 bg-white/5 backdrop-blur-sm text-center">
          <div className="mx-auto mb-3 p-2 rounded-lg bg-[hsl(25,95%,53%)]/20 text-[hsl(25,95%,53%)] w-fit">
            <Users className="h-5 w-5" />
          </div>
          <h3 className="text-sm font-semibold text-white">Mobile Ready</h3>
          <p className="text-xs text-white/50 mt-1">Full-featured interface for field workers on the go</p>
        </div>
      </div>

      {/* CTA */}
      <Button
        onClick={() => navigate("/login")}
        className="bg-[hsl(25,95%,53%)] hover:bg-[hsl(25,95%,45%)] text-white font-semibold text-base h-11 px-10"
      >
        Get Started
      </Button>

      <Button
        variant="link"
        className="mt-3 text-white/60 hover:text-white"
        onClick={() => navigate("/login")}
      >
        Already have an account? Sign in
      </Button>
    </div>
  );
};

export default Index;
