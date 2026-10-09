import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Building2, Wrench } from "lucide-react";
import logo from "@/assets/logo.png";
import BackgroundVideo from "@/components/BackgroundVideo";
import { withTimeout } from "@/lib/withTimeout";
import { resolvePostLoginPath } from "@/lib/postLoginRedirect";





const Auth = () => {
  const [loading, setLoading] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const redirectingRef = useRef(false);
  const [isLogin, setIsLogin] = useState(true);
  const [showSignupChoice, setShowSignupChoice] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawNext = searchParams.get("next") ?? "";
  // Only accept same-origin relative paths to avoid open redirects.
  const nextPath = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "";
  const { toast } = useToast();
  const { session } = useAuth();

  useEffect(() => {
    if (!session) return;

    const redirectUser = async (userId: string) => {
      if (redirectingRef.current) return;
      redirectingRef.current = true;
      setRedirecting(true);

      if (nextPath) {
        window.location.replace(nextPath);
        return;
      }
      const { path, error } = await resolvePostLoginPath(userId);
      if (error) {
        toast({ title: "Couldn't load your account", description: error, variant: "destructive" });
      }
      navigate(path);
    };

    redirectUser(session.user.id);
  }, [session, navigate, nextPath]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);

    // Read straight from the DOM so password-manager autofill (which may not
    // fire React onChange) still submits the real values.
    const form = e.currentTarget;
    const emailEl = form.elements.namedItem("email") as HTMLInputElement | null;
    const passwordEl = form.elements.namedItem("password") as HTMLInputElement | null;
    const nameEl = form.elements.namedItem("fullName") as HTMLInputElement | null;
    const emailValue = (emailEl?.value ?? email).trim();
    const passwordValue = passwordEl?.value ?? password;
    const fullNameValue = (nameEl?.value ?? fullName).trim();
    if (emailValue !== email) setEmail(emailValue);
    if (passwordValue !== password) setPassword(passwordValue);

    try {
      if (isLogin) {
        const { error } = await withTimeout(
          supabase.auth.signInWithPassword({ email: emailValue, password: passwordValue }),
          12000,
          "Sign-in is taking too long. Check your connection and try again.",
        );
        if (error) throw error;
        toast({ title: "Welcome back!", description: "You've successfully logged in." });
      } else {
        const emailRedirectTo = nextPath
          ? `${window.location.origin}/login?next=${encodeURIComponent(nextPath)}`
          : `${window.location.origin}/`;
        const { error } = await supabase.auth.signUp({
          email: emailValue,
          password: passwordValue,
          options: {
            data: { full_name: fullNameValue },
            emailRedirectTo,
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

  // Signup choice screen
  if (showSignupChoice) {
    return (
      <div className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-[hsl(204,100%,36%)] via-[hsl(204,100%,28%)] to-[hsl(216,58%,12%)] p-4">
        <BackgroundVideo />
        <img src={logo} alt="0800BeCool" className="relative z-10 h-24 w-auto mb-8 drop-shadow-lg" />
        <div className="relative z-10 w-full max-w-sm space-y-6">
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold text-white">How do you want to join?</h1>
            <p className="text-white/70 text-sm">Choose the option that fits you best</p>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => { setShowSignupChoice(false); setIsLogin(false); }}
              className="w-full p-4 rounded-xl border border-white/20 bg-white/5 backdrop-blur-sm hover:bg-white/10 transition-all text-left group"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-[hsl(25,95%,53%)]/20 text-[hsl(25,95%,53%)] mt-0.5">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-white group-hover:text-[hsl(25,95%,53%)] transition-colors">
                    Sign Up as a Company
                  </div>
                  <div className="text-xs text-white/60 mt-1">
                    Register your HVAC business, manage teams, dispatch jobs, send quotes & invoices
                  </div>
                </div>
              </div>
            </button>

            <button
              onClick={() => navigate("/signup/independent")}
              className="w-full p-4 rounded-xl border border-white/20 bg-white/5 backdrop-blur-sm hover:bg-white/10 transition-all text-left group"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-[hsl(204,100%,50%)]/20 text-[hsl(204,100%,60%)] mt-0.5">
                  <Wrench className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-semibold text-white group-hover:text-[hsl(204,100%,60%)] transition-colors">
                    Join as Independent Agent
                  </div>
                  <div className="text-xs text-white/60 mt-1">
                    Apply as a freelance sales agent or technician to take jobs from companies on the network
                  </div>
                </div>
              </div>
            </button>
          </div>

          <div className="text-center">
            <Button
              variant="link"
              className="text-white/70 hover:text-white"
              onClick={() => { setShowSignupChoice(false); setIsLogin(true); }}
            >
              Already have an account? Sign in
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Shared by "Forgot password?" and the invited-staff note: email a link to /set-password.
  const sendPasswordLink = async () => {
    const em = ((document.getElementById("email") as HTMLInputElement)?.value || email).trim();
    if (!em) return toast({ title: "Enter your email first", variant: "destructive" });
    const { error } = await supabase.auth.resetPasswordForEmail(em, { redirectTo: `${window.location.origin}/set-password` });
    toast(error ? { title: "Error", description: error.message, variant: "destructive" } : { title: "Check your email for a link to set a new password" });
  };

  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-[hsl(204,100%,36%)] via-[hsl(204,100%,28%)] to-[hsl(216,58%,12%)] p-4">
      <BackgroundVideo />
      <img src={logo} alt="0800BeCool" className="relative z-10 h-24 w-auto mb-8 drop-shadow-lg" />

      <div className="relative z-10 w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-white">
            {isLogin ? "Welcome Back" : "Create Company Account"}
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
                name="fullName"
                type="text"
                autoComplete="name"
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
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
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
              name="password"
              type="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-white/50 focus:ring-white/20"
            />
          </div>
          {isLogin && (
            <button type="button" className="block ml-auto -mt-2 text-xs text-white/70 hover:text-white underline" onClick={sendPasswordLink}>Forgot password?</button>
          )}
          {isLogin && (
            <div data-testid="invite-password-note" className="rounded-md border border-[hsl(25,95%,53%)]/60 bg-[hsl(25,95%,53%)]/15 px-3 py-2 text-sm text-white">
              <strong>Invited to the team?</strong> You don't have a password yet.{" "}
              <button type="button" className="underline font-semibold text-white hover:text-white/90" onClick={sendPasswordLink}>
                Tap Forgot password
              </button>{" "}
              to get a link and set one.
            </div>
          )}
          <Button
            type="submit"
            className="w-full bg-[hsl(25,95%,53%)] hover:bg-[hsl(25,95%,45%)] text-white font-semibold text-base h-11"
            disabled={loading || redirecting}
          >
            {(loading || redirecting) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {redirecting ? "Signing you in..." : isLogin ? "Sign In" : "Sign Up"}
          </Button>
        </form>

        <div className="text-center text-sm text-white/70">
          {isLogin ? "Don't have an account?" : "Already have an account?"}
          <Button
            variant="link"
            className="ml-1 text-[hsl(25,95%,53%)] hover:text-[hsl(25,95%,63%)]"
            onClick={() => {
              if (isLogin) {
                setShowSignupChoice(true);
              } else {
                setIsLogin(true);
              }
            }}
          >
            {isLogin ? "Sign up" : "Sign in"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Auth;
