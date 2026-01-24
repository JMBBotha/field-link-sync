import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin, Users, TrendingUp, Navigation } from "lucide-react";

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
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/10 via-background to-accent/10">
      <div className="container mx-auto px-4 py-16">
        <div className="text-center mb-16">
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="absolute inset-0 bg-primary/20 rounded-full blur-3xl animate-pulse" />
              <div className="relative p-6 bg-primary/10 rounded-full">
                <MapPin className="h-16 w-16 text-primary" />
              </div>
            </div>
          </div>
          <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Field Service Management
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
            Intelligent lead distribution and real-time tracking for your field operations
          </p>
          <Button size="lg" onClick={() => navigate("/auth")} className="text-lg px-8">
            Get Started
          </Button>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto mb-16">
          <Card className="border-primary/20 hover:border-primary/40 transition-colors">
            <CardHeader>
              <div className="p-3 rounded-lg bg-primary/10 w-fit mb-4">
                <MapPin className="h-8 w-8 text-primary" />
              </div>
              <CardTitle>Live Tracking</CardTitle>
              <CardDescription>
                Monitor all field agents in real-time on an interactive map dashboard
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              See exactly where your team is and track their progress throughout the day
            </CardContent>
          </Card>

          <Card className="border-primary/20 hover:border-primary/40 transition-colors">
            <CardHeader>
              <div className="p-3 rounded-lg bg-primary/10 w-fit mb-4">
                <Navigation className="h-8 w-8 text-primary" />
              </div>
              <CardTitle>Smart Distribution</CardTitle>
              <CardDescription>
                Intelligent lead routing to nearby agents based on proximity
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              First-to-accept assignment system ensures quick response times
            </CardContent>
          </Card>

          <Card className="border-primary/20 hover:border-primary/40 transition-colors">
            <CardHeader>
              <div className="p-3 rounded-lg bg-primary/10 w-fit mb-4">
                <Users className="h-8 w-8 text-primary" />
              </div>
              <CardTitle>Mobile Ready</CardTitle>
              <CardDescription>
                Full-featured mobile interface for field workers on the go
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Accept leads, update status, and navigate to customers seamlessly
            </CardContent>
          </Card>
        </div>

        <Card className="max-w-3xl mx-auto bg-primary/5 border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-6 w-6" />
              Key Features
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <div className="h-2 w-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                <span><strong>Real-time GPS tracking</strong> - Know where every team member is at all times</span>
              </li>
              <li className="flex items-start gap-3">
                <div className="h-2 w-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                <span><strong>Proximity-based assignment</strong> - Leads go to the nearest available agent within 20km</span>
              </li>
              <li className="flex items-start gap-3">
                <div className="h-2 w-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                <span><strong>Push notifications</strong> - Instant alerts when new leads become available</span>
              </li>
              <li className="flex items-start gap-3">
                <div className="h-2 w-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                <span><strong>Admin oversight</strong> - Complete dashboard for monitoring and reporting</span>
              </li>
              <li className="flex items-start gap-3">
                <div className="h-2 w-2 rounded-full bg-primary mt-2 flex-shrink-0" />
                <span><strong>Status tracking</strong> - Follow leads from pending to completion</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Index;