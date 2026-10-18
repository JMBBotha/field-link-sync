import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/useTheme";
import {
  Loader2, Mail, Lock, User, Eye, EyeOff, Building2, Wrench, Tag, Repeat, Star, Phone, Sun, Moon,
} from "lucide-react";
import { AuthOrb, PwBars, AUTH_TITLE, AUTH_FOOT } from "@/components/auth/FlAuthFrame";
import { withTimeout } from "@/lib/withTimeout";
import { resolvePostLoginPath } from "@/lib/postLoginRedirect";
import { SIGNUP_ROLES, signupMetadata, type SignupRole } from "@/lib/signupRoles";
import "./auth.css";

const ROLE_ICONS: Record<SignupRole, typeof Building2> = {
  company_new: Building2, company_tech: Wrench, company_sales: Tag, massair_dual: Repeat, independent: Star,
};

const Auth = () => {
  const [loading, setLoading] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const redirectingRef = useRef(false);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [role, setRole] = useState<SignupRole>("company_new");
  const [indKind, setIndKind] = useState<"tech" | "sales">("tech");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawNext = searchParams.get("next") ?? "";
  // Only accept same-origin relative paths to avoid open redirects.
  const nextPath = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "";
  const { toast } = useToast();
  const { session } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const dark = resolvedTheme === "dark";

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
        if ((role === "company_tech" || role === "company_sales") && !companyName.trim()) {
          throw new Error("Enter the company you work for.");
        }
        const emailRedirectTo = nextPath
          ? `${window.location.origin}/login?next=${encodeURIComponent(nextPath)}`
          : `${window.location.origin}/`;
        const { error } = await supabase.auth.signUp({
          email: emailValue,
          password: passwordValue,
          options: {
            data: signupMetadata(role, {
              fullName: fullNameValue, companyName: companyName.trim(), phone: phone.trim(), independentKind: indKind,
            }),
            emailRedirectTo,
          },
        });
        if (error) throw error;
        toast({
          title: "Account created!",
          description: role === "independent"
            ? "Check your email to verify your address. Your application is pending approval."
            : "Check your email to verify your address. Massair CT will approve your account before you can start.",
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

  // Shared by "Forgot password?" and the invited-staff note: email a link to /set-password.
  const sendPasswordLink = async () => {
    const em = ((document.getElementById("email") as HTMLInputElement)?.value || email).trim();
    if (!em) return toast({ title: "Enter your email first", variant: "destructive" });
    const { error } = await supabase.auth.resetPasswordForEmail(em, { redirectTo: `${window.location.origin}/set-password` });
    toast(error ? { title: "Error", description: error.message, variant: "destructive" } : { title: "Check your email for a link to set a new password" });
  };

  const needsCompany = role === "company_new" || role === "company_tech" || role === "company_sales";
  const busy = loading || redirecting;

  return (
    <div className={`fl-auth ${dark ? "dark" : "light"}`} data-testid="fl-auth">
      <button type="button" className="theme" onClick={toggleTheme} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
        {dark ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <AuthOrb />

      <div className={`card ${isLogin ? "" : "wide"}`}>
        <h1 className="t">{AUTH_TITLE}</h1>
        <p className="sub">
          {isLogin
            ? "Welcome back. Sign in to your jobs, leads and team."
            : "Create your account. Pick how you'll use Field Lynk, it takes about a minute."}
        </p>

        <form onSubmit={handleSubmit}>
          {!isLogin && (
            <>
              <div className="lab" id="role-label">I'm joining as</div>
              <div className="roles" role="radiogroup" aria-labelledby="role-label">
                {SIGNUP_ROLES.map((r) => {
                  const Icon = ROLE_ICONS[r.id];
                  return (
                    <button
                      key={r.id}
                      type="button"
                      role="radio"
                      aria-checked={role === r.id}
                      data-role={r.id}
                      className={`r ${r.id === "independent" ? "w" : ""}`}
                      onClick={() => setRole(r.id)}
                    >
                      <span className="ri"><Icon size={16} /></span>
                      <div>
                        {r.title}
                        {r.badge && <span className="badge">{r.badge}</span>}
                        <small>{r.blurb}</small>
                      </div>
                    </button>
                  );
                })}
              </div>

              {role === "independent" && (
                <div className="seg">
                  <button type="button" aria-pressed={indKind === "tech"} onClick={() => setIndKind("tech")}>Technician</button>
                  <button type="button" aria-pressed={indKind === "sales"} onClick={() => setIndKind("sales")}>Sales agent</button>
                </div>
              )}

              <label className="lab" htmlFor="fullName">Full name</label>
              <div className="f">
                <User size={18} />
                <input id="fullName" name="fullName" type="text" autoComplete="name" placeholder="Your name"
                  value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>

              {needsCompany && (
                <>
                  <label className="lab" htmlFor="companyName">
                    {role === "company_new" ? "Company name" : "Company you work for"}
                  </label>
                  <div className="f">
                    <Building2 size={18} />
                    <input id="companyName" name="companyName" type="text" autoComplete="organization"
                      placeholder={role === "company_new" ? "Your AC business" : "Your employer"}
                      value={companyName} onChange={(e) => setCompanyName(e.target.value)} required={role !== "company_new"} />
                  </div>
                </>
              )}

              <label className="lab" htmlFor="phone">Mobile number <span>optional</span></label>
              <div className="f">
                <Phone size={18} />
                <input id="phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="082 000 0000"
                  value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </>
          )}

          <label className="lab" htmlFor="email">Email address</label>
          <div className="f">
            <Mail size={18} />
            <input id="email" name="email" type="email" autoComplete="username" inputMode="email"
              placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>

          <div className="lab">
            <label htmlFor="password">Password</label>
            {isLogin ? (
              <button type="button" onClick={sendPasswordLink}>Forgot?</button>
            ) : (
              <span>8+ characters</span>
            )}
          </div>
          <div className="f">
            <Lock size={18} />
            <input id="password" name="password" type={showPw ? "text" : "password"}
              autoComplete={isLogin ? "current-password" : "new-password"}
              placeholder={isLogin ? "Your password" : "Create a password"}
              value={password} onChange={(e) => setPassword(e.target.value)} required minLength={isLogin ? 6 : 8} />
            <button type="button" className="eye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? "Hide password" : "Show password"}>
              {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {!isLogin && <PwBars value={password} />}

          {!isLogin && role !== "independent" && (
            <p className="note">Sign-ups through Massair CT are approved before you can start. Already-approved companies can add their own techs and salespeople from Team.</p>
          )}

          <div className="trk">
            <button type="submit" className="pill" disabled={busy}>
              {busy ? <Loader2 size={18} className="animate-spin" /> : null}
              {redirecting ? "Signing you in..." : isLogin ? "Sign in" : "Create account"}
            </button>
          </div>
          {redirecting && <div className="st"><i />Signed in, taking you to your dashboard…</div>}
          {!isLogin && <div className="hint">We'll email you a link to confirm your address.</div>}
          {isLogin && (
            <div data-testid="invite-password-note" className="new">
              <span>👋</span>
              <span><em>Welcome!</em> New to the team, add email address, and click forgot password.</span>
            </div>
          )}
        </form>

        <div className="dv" />
        <div className="ft">
          {isLogin ? "No account yet? " : "Already have an account? "}
          <button type="button" className="lnk" onClick={() => setIsLogin(!isLogin)}>
            {isLogin ? "Create one" : "Sign in"}
          </button>
        </div>
      </div>
      <div className="foot">{AUTH_FOOT}</div>
    </div>
  );
};

export default Auth;
