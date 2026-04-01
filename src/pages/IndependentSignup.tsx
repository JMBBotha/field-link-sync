import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, ArrowLeft } from "lucide-react";
import logo from "@/assets/logo.png";

type ParticipantType = "independent_sales" | "independent_tech";

const IndependentSignup = () => {
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [participantType, setParticipantType] = useState<ParticipantType>("independent_sales");
  const [bio, setBio] = useState("");
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            participant_type: participantType,
          },
          emailRedirectTo: `${window.location.origin}/`,
        },
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error("User creation failed");

      // Update profile with independent agent fields
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          phone,
          skills: bio ? [bio] : [],
          participant_type: participantType,
          network_status: "pending",
        })
        .eq("id", authData.user.id);

      if (profileError) throw profileError;

      // Role assignment is handled by DB trigger (auto_assign_independent_role)

      setSubmitted(true);
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

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[hsl(204,100%,36%)] via-[hsl(204,100%,28%)] to-[hsl(216,58%,12%)] p-4">
        <img src={logo} alt="0800BeCool" className="h-24 w-auto mb-8 drop-shadow-lg" />
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="flex justify-center">
            <CheckCircle2 className="h-16 w-16 text-[hsl(25,95%,53%)]" />
          </div>
          <h1 className="text-2xl font-bold text-white">Application Submitted</h1>
          <p className="text-white/70 text-sm leading-relaxed">
            Your application is pending approval. We'll review your profile and notify you by email once you're approved to start taking jobs.
          </p>
          <p className="text-white/50 text-xs">
            Please check your email to verify your account in the meantime.
          </p>
          <Button
            variant="link"
            className="text-[hsl(25,95%,53%)] hover:text-[hsl(25,95%,63%)]"
            onClick={() => navigate("/login")}
          >
            Back to Sign In
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[hsl(204,100%,36%)] via-[hsl(204,100%,28%)] to-[hsl(216,58%,12%)] p-4">
      <img src={logo} alt="0800BeCool" className="h-24 w-auto mb-8 drop-shadow-lg" />

      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-white">Join as Independent Agent</h1>
          <p className="text-white/70 text-sm">
            Apply to join our network of independent HVAC professionals
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fullName" className="text-white/90 text-sm">Full Name</Label>
            <Input
              id="fullName"
              type="text"
              placeholder="John Doe"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-white/50 focus:ring-white/20"
            />
          </div>

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
            <Label htmlFor="phone" className="text-white/90 text-sm">Phone Number</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="082 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
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

          <div className="space-y-1.5">
            <Label className="text-white/90 text-sm">Agent Type</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setParticipantType("independent_sales")}
                className={`p-3 rounded-lg border text-sm font-medium transition-all ${
                  participantType === "independent_sales"
                    ? "bg-[hsl(25,95%,53%)]/20 border-[hsl(25,95%,53%)] text-[hsl(25,95%,53%)]"
                    : "bg-white/5 border-white/20 text-white/70 hover:border-white/40"
                }`}
              >
                Sales Agent
              </button>
              <button
                type="button"
                onClick={() => setParticipantType("independent_tech")}
                className={`p-3 rounded-lg border text-sm font-medium transition-all ${
                  participantType === "independent_tech"
                    ? "bg-[hsl(25,95%,53%)]/20 border-[hsl(25,95%,53%)] text-[hsl(25,95%,53%)]"
                    : "bg-white/5 border-white/20 text-white/70 hover:border-white/40"
                }`}
              >
                Technician
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bio" className="text-white/90 text-sm">Experience & Skills</Label>
            <Textarea
              id="bio"
              placeholder="Briefly describe your HVAC experience, certifications, and areas you serve..."
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              required
              rows={3}
              className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-white/50 focus:ring-white/20 resize-none"
            />
          </div>

          <Button
            type="submit"
            className="w-full bg-[hsl(25,95%,53%)] hover:bg-[hsl(25,95%,45%)] text-white font-semibold text-base h-11"
            disabled={loading}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit Application
          </Button>
        </form>

        <div className="text-center">
          <Button
            variant="link"
            className="text-white/70 hover:text-white"
            onClick={() => navigate("/login")}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back to Sign In
          </Button>
        </div>
      </div>
    </div>
  );
};

export default IndependentSignup;
