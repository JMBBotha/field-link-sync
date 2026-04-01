import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import logo from "@/assets/logo.png";

const Auth = () => {
  const [loading, setLoading] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const redirectUser = async (userId: string) => {
      // Check if onboarding is completed
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", userId)
        .maybeSingle();

      if (!profile?.onboarding_completed) {
        navigate("/onboarding");
        return;
      }

      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      const hasAdmin = roles?.some(r => ["admin", "dispatcher", "viewer"].includes(r.role));
      navigate(hasAdmin ? "/admin" : "/field");
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) redirectUser(session.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) redirectUser(session.user.id);
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast({ title: "Welcome back!", description: "You've successfully logged in." });
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: `${window.location.origin}/`,
          },
        });
        if (error) throw error;
        toast({
          title: "Account created!",
          description: "Please check your email to verify your account before signing in.",
        });
        setIsLogin(true);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[hsl(204,100%,36%)] via-[hsl(204,100%,28%)] to-[hsl(216,58%,12%)] p-4">
      {/* Logo */}
      <img src={logo} alt="0800BeCool" className="h-20 w-auto mb-8 drop-shadow-lg" />

      {/* Auth form — no card wrapper */}
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-white">
            {isLogin ? "Welcome Back" : "Create Account"}
          </h1>
          <p className="text-white/70 text-sm">
            {isLogin
              ? "Sign in to access your dashboard"
              : "Get started with your field service account"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div className="space-y-1.5">
              <Label htmlFor="fullName" className="text-white/90 text-sm">Full Name</Label>
              <Input
                id="fullName"
                type="text"
                placeholder="John Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required={!isLogin}
                className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-white/50 focus:ring-white/20"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-white/90 text-sm">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-white/50 focus:ring-white/20"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-white/90 text-sm">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-white/50 focus:ring-white/20"
            />
          </div>
          <Button
            type="submit"
            className="w-full bg-[hsl(25,95%,53%)] hover:bg-[hsl(25,95%,45%)] text-white font-semibold text-base h-11"
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isLogin ? "Sign In" : "Sign Up"}
          </Button>
        </form>

        <div className="text-center text-sm text-white/70">
          {isLogin ? "Don't have an account?" : "Already have an account?"}
          <Button
            variant="link"
            className="ml-1 text-[hsl(25,95%,53%)] hover:text-[hsl(25,95%,63%)]"
            onClick={() => setIsLogin(!isLogin)}
          >
            {isLogin ? "Sign up" : "Sign in"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Auth;
